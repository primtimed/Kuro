import type { Media, Episode, StreamResult, Provider, CastMember } from "../types/media.js";

const ENDPOINT = "https://graphql.anilist.co";

// Server-side response cache — avoids hammering AniList on every page load.
const gqlCache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function gql<T>(query: string, variables: Record<string, unknown>, attempt = 0): Promise<T> {
  const key = JSON.stringify({ query, variables });
  const hit = gqlCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data as T;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429 && attempt < 3) {
    const retryAfter = res.headers.get("Retry-After");
    const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delay));
    return gql<T>(query, variables, attempt + 1);
  }

  if (!res.ok) throw new Error(`AniList GraphQL → ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);

  gqlCache.set(key, { data: json.data, expires: Date.now() + CACHE_TTL });
  return json.data;
}

// Full fields — used for detail pages and search.
const MEDIA_FIELDS = `
  id
  format
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  description(asHtml: false)
  startDate { year month day }
  endDate { year month day }
  averageScore
  popularity
  genres
  status
  episodes
  duration
  season
  seasonYear
  countryOfOrigin
  idMal
  siteUrl
  nextAiringEpisode { airingAt episode }
  studios { nodes { name isAnimationStudio } }
  trailer { id site }
  characters(sort: ROLE, perPage: 20) {
    edges {
      role
      node { name { full } image { medium } }
    }
  }
`;

// Slim fields — used for card rows where cast isn't needed.
const CARD_FIELDS = `
  id
  format
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  description(asHtml: false)
  startDate { year month day }
  averageScore
  genres
  status
  episodes
  trailer { id site }
`;

const COUNTRY_NAMES: Record<string, string> = { JP: "Japan", CN: "China", KR: "South Korea", TW: "Taiwan" };

function formatFuzzyDate(d: { year?: number; month?: number; day?: number } | null | undefined): string | undefined {
  if (!d?.year) return undefined;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (d.month && d.day) return `${months[d.month - 1]} ${d.day}, ${d.year}`;
  if (d.month) return `${months[d.month - 1]} ${d.year}`;
  return String(d.year);
}

function broadcastFromTimestamp(airingAt: number): string {
  const d = new Date((airingAt + 9 * 3600) * 1000);
  const days = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} at ${hh}:${mm} JST`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMedia(a: any): Media {
  const cast: CastMember[] = (a.characters?.edges ?? []).map(
    (e: { role: string; node: { name: { full: string }; image: { medium: string } } }): CastMember => ({
      name: e.node.name.full,
      role: e.role === "MAIN" ? "Main" : "Supporting",
      image: e.node.image?.medium,
    })
  );

  const studioNodes: Array<{ name: string; isAnimationStudio: boolean }> = a.studios?.nodes ?? [];
  const studios = studioNodes.filter((s) => s.isAnimationStudio).map((s) => s.name);
  const producers = studioNodes.filter((s) => !s.isAnimationStudio).map((s) => s.name);
  const airedFrom = formatFuzzyDate(a.startDate);
  const airedTo = formatFuzzyDate(a.endDate) ?? (a.status === "RELEASING" ? "?" : undefined);

  return {
    id: `anilist:${a.id}`,
    type: "anime",
    title: a.title.english ?? a.title.romaji,
    altTitles: [a.title.romaji, a.title.native].filter(Boolean),
    poster: a.coverImage?.extraLarge ?? a.coverImage?.large ?? "",
    banner: a.bannerImage ?? undefined,
    synopsis: (a.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim(),
    year: a.startDate?.year,
    rating: a.averageScore ? a.averageScore / 10 : undefined,
    popularity: a.popularity ?? undefined,
    genres: a.genres ?? [],
    status: a.status,
    cast,
    totalEpisodes: a.episodes ?? undefined,
    trailer: a.trailer?.id ? { site: a.trailer.site ?? "youtube", id: a.trailer.id } : undefined,
    country: a.countryOfOrigin ? (COUNTRY_NAMES[a.countryOfOrigin as string] ?? a.countryOfOrigin) : undefined,
    premiered: a.season && a.seasonYear ? `${a.season[0]}${a.season.slice(1).toLowerCase()} ${a.seasonYear}` : undefined,
    airedFrom,
    airedTo,
    broadcast: a.nextAiringEpisode?.airingAt ? broadcastFromTimestamp(a.nextAiringEpisode.airingAt) : undefined,
    duration: a.duration ?? undefined,
    studios: studios.length ? studios : undefined,
    producers: producers.length ? producers : undefined,
    malId: a.idMal ?? undefined,
    siteUrl: a.siteUrl ?? undefined,
    mediaFormat: a.format ?? undefined,
  };
}

const anilist: Provider = {
  async search(query: string): Promise<Media[]> {
    const data = await gql<{ Page: { media: unknown[] } }>(
      `query ($q: String) {
        Page(perPage: 20) {
          media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { q: query }
    );
    return (data.Page.media ?? []).map(mapMedia);
  },

  async getDetail(externalId: string): Promise<Media> {
    const data = await gql<{ Media: unknown }>(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }`,
      { id: parseInt(externalId, 10) }
    );
    return mapMedia(data.Media);
  },

  async getEpisodes(externalId: string): Promise<Episode[]> {
    const data = await gql<{ Media: { duration?: number | null; streamingEpisodes?: { title?: string; thumbnail?: string }[] } }>(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          duration
          streamingEpisodes { title thumbnail }
        }
      }`,
      { id: parseInt(externalId, 10) }
    );
    const episodeDuration = data.Media.duration ?? undefined;
    const streaming = data.Media.streamingEpisodes ?? [];
    if (streaming.length === 0) return [];

    // AniList may list the same episode multiple times (one per streaming platform) — dedupe by episode number.
    const epMap = new Map<number, Episode>();
    for (const ep of streaming) {
      const m = ep.title?.match(/^Episode\s+(\d+)/i);
      if (!m) continue; // skip trailers/specials with no episode number
      const num = parseInt(m[1], 10);
      if (!epMap.has(num)) {
        epMap.set(num, {
          number: num,
          title: ep.title?.replace(/^Episode\s+\d+\s*[-–]\s*/i, "") ?? `Episode ${num}`,
          thumbnail: ep.thumbnail ?? undefined,
          duration: episodeDuration,
        });
      }
    }
    const episodes = Array.from(epMap.values()).sort((a, b) => a.number - b.number);

    // Streaming platforms (e.g. Crunchyroll) sometimes number episodes globally across seasons.
    // If episode 1 is absent the list is offset — discard it so Jikan gives correct per-season numbers.
    if (!epMap.has(1)) return [];

    return episodes;
  },

  async getStream(_externalId: string, _episode: number): Promise<StreamResult> {
    throw new Error("AniList does not provide stream URLs. Use Consumet.");
  },

  async getTrending(): Promise<Media[]> {
    const data = await gql<{ Page: { media: unknown[] } }>(
      `query {
        Page(perPage: 20) {
          media(type: ANIME, sort: TRENDING_DESC) {
            ${CARD_FIELDS}
          }
        }
      }`,
      {}
    );
    return (data.Page.media ?? []).map(mapMedia);
  },

  async getRecommendations(externalId: string): Promise<Media[]> {
    const data = await gql<{
      Media: { recommendations: { nodes: { mediaRecommendation: unknown }[] } };
    }>(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          recommendations(sort: RATING_DESC, perPage: 8) {
            nodes {
              mediaRecommendation {
                ${CARD_FIELDS}
              }
            }
          }
        }
      }`,
      { id: parseInt(externalId, 10) }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.Media.recommendations?.nodes ?? []).map((n: any) => n.mediaRecommendation).filter(Boolean).map(mapMedia);
  },

  // Fetches SEQUEL relations for multiple IDs, chunked to stay within AniList's complexity limit.
  // Returns sequels that are currently RELEASING or whose startDate falls within [fromMs, toMs].
  async batchGetSequels(externalIds: string[], fromMs: number, toMs: number): Promise<Media[]> {
    if (externalIds.length === 0) return [];

    const CHUNK = 5;
    const seen = new Set<string>();
    const results: Media[] = [];

    for (let i = 0; i < externalIds.length; i += CHUNK) {
      const chunk = externalIds.slice(i, i + CHUNK);
      const aliases = chunk
        .map((id, j) => `m${j}: Media(id: ${id}, type: ANIME) {
          relations { edges { relationType node { ${CARD_FIELDS} } } }
        }`)
        .join("\n");

      const data = await gql<Record<string, { relations: { edges: Array<{ relationType: string; node: unknown }> } }>>(
        `query { ${aliases} }`,
        {}
      ).catch(() => ({} as Record<string, never>));

      for (const key of Object.keys(data)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const edge of (data[key]?.relations?.edges ?? []) as any[]) {
          if (edge.relationType !== "SEQUEL") continue;
          const node = edge.node;
          const status: string = node?.status ?? "";
          const { year, month, day } = node?.startDate ?? {};

          const isReleasing = status === "RELEASING";
          if (!isReleasing) {
            if (!year) continue;
            const t = new Date(year, (month ?? 1) - 1, day ?? 1).getTime();
            if (t < fromMs || t > toMs) continue;
          }

          const m = mapMedia(node);
          if (!seen.has(m.id)) {
            seen.add(m.id);
            results.push(m);
          }
        }
      }
    }

    return results;
  },

  async getByGenre(genre: string): Promise<Media[]> {
    const data = await gql<{ Page: { media: unknown[] } }>(
      `query ($genre: String) {
        Page(perPage: 30) {
          media(type: ANIME, genre_in: [$genre], sort: POPULARITY_DESC) {
            ${CARD_FIELDS}
          }
        }
      }`,
      { genre }
    );
    return (data.Page.media ?? []).map(mapMedia);
  },

  async getSeasonal(): Promise<Media[]> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const season =
      month <= 3 ? "WINTER" : month <= 6 ? "SPRING" : month <= 9 ? "SUMMER" : "FALL";

    const data = await gql<{ Page: { media: unknown[] } }>(
      `query ($season: MediaSeason, $year: Int) {
        Page(perPage: 20) {
          media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) {
            ${CARD_FIELDS}
          }
        }
      }`,
      { season, year }
    );
    return (data.Page.media ?? []).map(mapMedia);
  },

  async getRelations(externalId: string): Promise<{ relationType: string; media: Media }[]> {
    const INCLUDE = new Set(["SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE"]);
    const SEASON_TYPES = new Set(["SEQUEL", "PREQUEL"]);

    type Edge = { relationType: string; node: Record<string, unknown> };

    const data = await gql<{
      Media: { relations: { edges: Edge[] } };
    }>(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          relations {
            edges {
              relationType
              node {
                type
                id
                ${CARD_FIELDS}
              }
            }
          }
        }
      }`,
      { id: parseInt(externalId, 10) }
    );

    const directEdges = (data.Media.relations?.edges ?? [])
      .filter((e) => INCLUDE.has(e.relationType) && e.node?.type === "ANIME");

    const seen = new Set<string>([`anilist:${externalId}`]);
    const result: { relationType: string; media: Media }[] = [];

    for (const e of directEdges) {
      const m = mapMedia(e.node);
      if (!seen.has(m.id)) { seen.add(m.id); result.push({ relationType: e.relationType, media: m }); }
    }

    // Traverse one level deeper through the PREQUEL/SEQUEL chain to surface non-adjacent seasons.
    // AniList relations are pairwise, so S3 only directly knows S2 and S4 — this reveals S1 and S5.
    const seasonNodeIds = directEdges
      .filter((e) => SEASON_TYPES.has(e.relationType))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e) => (e.node as any).id as number)
      .filter(Boolean);

    if (seasonNodeIds.length > 0) {
      const aliases = seasonNodeIds
        .map((id, j) => `m${j}: Media(id: ${id}, type: ANIME) {
          relations { edges { relationType node { type id ${CARD_FIELDS} } } }
        }`)
        .join("\n");

      const deep = await gql<Record<string, { relations: { edges: Edge[] } }>>(
        `query { ${aliases} }`,
        {}
      ).catch(() => ({} as Record<string, never>));

      for (const key of Object.keys(deep)) {
        for (const e of (deep[key]?.relations?.edges ?? []) as Edge[]) {
          if (!SEASON_TYPES.has(e.relationType) || e.node?.type !== "ANIME") continue;
          const m = mapMedia(e.node);
          if (!seen.has(m.id)) { seen.add(m.id); result.push({ relationType: e.relationType, media: m }); }
        }
      }
    }

    return result;
  },
  async searchFiltered(query: string, format?: string): Promise<Media[]> {
    const hasQuery = !!query.trim();
    const hasFormat = !!format;
    if (!hasQuery && !hasFormat) return [];

    // Build variables and args dynamically so GraphQL never gets a null search
    const varDefs: string[] = [];
    const mediaArgs: string[] = ["type: ANIME"];
    const params: Record<string, unknown> = {};

    if (hasQuery) { varDefs.push("$q: String"); mediaArgs.push("search: $q"); params.q = query; }
    if (hasFormat) { varDefs.push("$format: [MediaFormat]"); mediaArgs.push("format_in: $format"); params.format = [format]; }
    mediaArgs.push(`sort: ${hasQuery ? "SEARCH_MATCH" : "POPULARITY_DESC"}`);

    const varStr = varDefs.length ? `(${varDefs.join(", ")})` : "";
    const data = await gql<{ Page: { media: unknown[] } }>(
      `query ${varStr} {
        Page(perPage: 20) {
          media(${mediaArgs.join(", ")}) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      params
    );
    return (data.Page.media ?? []).map(mapMedia);
  },
} as Provider & {
  getTrending(): Promise<Media[]>;
  getSeasonal(): Promise<Media[]>;
  getRecommendations(id: string): Promise<Media[]>;
  getByGenre(genre: string): Promise<Media[]>;
  batchGetSequels(ids: string[], fromMs: number, toMs: number): Promise<Media[]>;
  getRelations(externalId: string): Promise<{ relationType: string; media: Media }[]>;
  searchFiltered(query: string, format?: string): Promise<Media[]>;
};

export default anilist;
