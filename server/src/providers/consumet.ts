import type { Media, Episode, StreamResult, Provider } from "../types/media.js";
import { cache } from "../cache/index.js";

const BASE = () => process.env.CONSUMET_BASE_URL ?? "https://api.consumet.org";
const SOURCES = ["zoro", "gogoanime"] as const;
type Source = (typeof SOURCES)[number];

// Consumet is unreliable — enforce a tight timeout so broken providers fail fast
async function apiFetch<T>(path: string, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Consumet ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

interface ConsumetResult {
  id: string;
  title: string | { english?: string; romaji?: string };
  image?: string;
  cover?: string;
  description?: string;
  releaseDate?: string | number;
  rating?: number;
  genres?: string[];
  status?: string;
  totalEpisodes?: number;
  episodes?: ConsumetEpisode[];
}

interface ConsumetEpisode {
  id: string;
  number: number;
  title?: string;
  image?: string;
  description?: string;
}

interface ConsumetSource {
  url: string;
  isM3U8: boolean;
  quality?: string;
}

interface ConsumetStreamData {
  sources: ConsumetSource[];
  subtitles?: Array<{ url: string; lang: string }>;
  headers?: Record<string, string>;
}

function titleStr(t: ConsumetResult["title"]): string {
  if (typeof t === "string") return t;
  return t?.english ?? t?.romaji ?? String(t);
}

// ID format: "consumet:zoro/actual-anime-id"
// Registry key: "consumet"
// externalId (after registry split): "zoro/actual-anime-id"
function makeId(source: string, animeId: string): string {
  return `consumet:${source}/${animeId}`;
}

function mapResult(r: ConsumetResult, source: string): Media {
  return {
    id: makeId(source, r.id),
    type: "anime",
    title: titleStr(r.title),
    poster: r.image ?? "",
    banner: r.cover,
    synopsis: r.description ?? "",
    year: r.releaseDate ? parseInt(String(r.releaseDate), 10) : undefined,
    rating: r.rating,
    genres: r.genres ?? [],
    status: r.status,
    cast: [],
    totalEpisodes: r.totalEpisodes,
  };
}

// externalId is always "source/animeId"
function splitExternal(externalId: string): { source: string; animeId: string } {
  const slash = externalId.indexOf("/");
  if (slash === -1) throw new Error(`Invalid consumet externalId "${externalId}" — expected "source/id"`);
  return { source: externalId.slice(0, slash), animeId: externalId.slice(slash + 1) };
}

async function searchSource(source: Source, query: string): Promise<Media[]> {
  const data = await apiFetch<{ results: ConsumetResult[] }>(
    `/anime/${source}/${encodeURIComponent(query)}`
  );
  return (data.results ?? []).map((r) => mapResult(r, source));
}

async function getEpisodesFromSource(source: string, animeId: string): Promise<Episode[]> {
  const key = `consumet-eps:${source}:${animeId}`;
  const hit = cache.get<Episode[]>(key);
  if (hit) return hit;
  const data = await apiFetch<ConsumetResult>(`/anime/${source}/info/${encodeURIComponent(animeId)}`);
  const eps = (data.episodes ?? []).map((ep) => ({
    number: ep.number,
    title: ep.title ?? `Episode ${ep.number}`,
    thumbnail: ep.image,
    description: ep.description,
    _consumetId: ep.id,
  })) as Episode[];
  if (eps.length > 0) cache.set(key, eps, 60 * 60 * 1000); // 1 hour
  return eps;
}

async function getStreamFromSource(source: string, episodeId: string): Promise<StreamResult> {
  const data = await apiFetch<ConsumetStreamData>(
    `/anime/${source}/watch/${encodeURIComponent(episodeId)}`
  );

  const hls = data.sources.find((s) => s.isM3U8);
  const mp4 =
    data.sources.find((s) => !s.isM3U8 && s.quality === "1080p") ??
    data.sources.find((s) => !s.isM3U8);

  const chosen = hls ?? mp4;
  if (!chosen) throw new Error("No playable source found in Consumet response");

  return {
    url: chosen.url,
    type: chosen.isM3U8 ? "hls" : "mp4",
    subtitles: (data.subtitles ?? []).map((s) => ({
      url: s.url,
      lang: s.lang,
      label: s.lang,
    })),
    headers: data.headers,
  };
}

const consumet: Provider = {
  async search(query: string): Promise<Media[]> {
    for (const source of SOURCES) {
      try {
        const results = await searchSource(source, query);
        if (results.length > 0) return results;
      } catch {
        // try next source
      }
    }
    return [];
  },

  async getDetail(externalId: string): Promise<Media> {
    const { source, animeId } = splitExternal(externalId);
    const data = await apiFetch<ConsumetResult>(`/anime/${source}/info/${encodeURIComponent(animeId)}`);
    return mapResult(data, source);
  },

  async getEpisodes(externalId: string): Promise<Episode[]> {
    const { source, animeId } = splitExternal(externalId);
    return getEpisodesFromSource(source, animeId);
  },

  async getStream(externalId: string, episode: number): Promise<StreamResult> {
    const { source, animeId } = splitExternal(externalId);
    const episodes = await getEpisodesFromSource(source, animeId);
    const ep = episodes.find((e) => e.number === episode);
    if (!ep) throw new Error(`Episode ${episode} not found on source "${source}"`);

    const consumetEp = ep as Episode & { _consumetId?: string };
    const epId = consumetEp._consumetId ?? String(episode);
    return getStreamFromSource(source, epId);
  },
};

export default consumet;

// Direct helper used by the stream route to search-then-stream by title
export async function streamByTitle(
  titles: string[],
  episode: number
): Promise<{ stream: StreamResult; consumetId: string }> {
  for (const source of SOURCES) {
    for (const title of titles) {
      let results: Media[] = [];
      try {
        results = await searchSource(source, title);
      } catch {
        continue;
      }
      if (results.length === 0) continue;

      const best = results[0];
      const { animeId } = splitExternal(best.id.slice(best.id.indexOf(":") + 1));
      try {
        const stream = await getStreamFromSource(
          source,
          await getEpisodeId(source, animeId, episode)
        );
        return { stream, consumetId: best.id };
      } catch {
        continue;
      }
    }
  }
  throw new Error(
    "No stream source found. Self-host Consumet (github.com/consumet/consumet.ts) and set CONSUMET_BASE_URL."
  );
}

async function getEpisodeId(source: string, animeId: string, episode: number): Promise<string> {
  const episodes = await getEpisodesFromSource(source, animeId);
  const ep = episodes.find((e) => e.number === episode);
  if (!ep) throw new Error(`Episode ${episode} not found`);
  return (ep as Episode & { _consumetId?: string })._consumetId ?? String(episode);
}

// Tries an arbitrary Consumet source name — used for user-added custom scrapers.
export async function streamViaCustomSource(
  source: string,
  titles: string[],
  episode: number
): Promise<{ stream: StreamResult; consumetId: string } | null> {
  for (const title of titles.slice(0, 2)) {
    let results: ConsumetResult[] = [];
    try {
      const data = await apiFetch<{ results?: ConsumetResult[] }>(
        `/anime/${encodeURIComponent(source)}/${encodeURIComponent(title)}`
      );
      results = data.results ?? [];
    } catch { continue; }
    if (results.length === 0) continue;

    const best = results[0];
    try {
      const epId = await getEpisodeId(source, best.id, episode);
      const stream = await getStreamFromSource(source, epId);
      return { stream, consumetId: `consumet:${source}/${best.id}` };
    } catch { continue; }
  }
  return null;
}

// Gogoanime dub entries have IDs ending in "-dub"
const isDubId = (id: string) => /-dub(?:bed)?$/i.test(id);

// Streams a sub from any named Consumet source (gogoanime, zoro, etc.).
// Skips dub entries so the result is always a sub stream.
export async function streamSubViaConsumet(
  source: string,
  titles: string[],
  episode: number
): Promise<{ stream: StreamResult; consumetId: string } | null> {
  const searches = await Promise.allSettled(titles.slice(0, 2).map((t) => searchSource(source as Source, t)));
  for (const r of searches) {
    if (r.status !== "fulfilled" || r.value.length === 0) continue;
    // Prefer non-dub entry; fall back to first result if all are dub-tagged
    const subEntry = r.value.find((x) => !isDubId(x.id)) ?? r.value[0];
    const { animeId } = splitExternal(subEntry.id.slice(subEntry.id.indexOf(":") + 1));
    try {
      const epId = await getEpisodeId(source, animeId, episode);
      const stream = await getStreamFromSource(source, epId);
      return { stream: { ...stream, dubbed: false }, consumetId: subEntry.id };
    } catch { continue; }
  }
  return null;
}

// Finds and streams a dub via Gogoanime ("-dub" entries in Consumet)
export async function findDubViaGogoanime(
  titles: string[],
  episode: number
): Promise<{ stream: StreamResult; consumetId: string } | null> {
  const searches = await Promise.allSettled(titles.map((t) => searchSource("gogoanime", t)));
  for (const r of searches) {
    if (r.status !== "fulfilled") continue;
    const dubEntry = r.value.find((x) => isDubId(x.id));
    if (!dubEntry) continue;
    const { animeId } = splitExternal(dubEntry.id.slice(dubEntry.id.indexOf(":") + 1));
    try {
      const epId = await getEpisodeId("gogoanime", animeId, episode);
      const stream = await getStreamFromSource("gogoanime", epId);
      return { stream: { ...stream, dubbed: true }, consumetId: dubEntry.id };
    } catch { continue; }
  }
  return null;
}

// Zoro/aniwatch supports dub via category=dub on multiple servers — broader coverage than Gogoanime
const ZORO_SERVERS = ["vidstreaming", "vidcloud", "streamsb", "streamtape"] as const;

export async function findDubViaZoro(
  titles: string[],
  episode: number
): Promise<{ stream: StreamResult; consumetId: string } | null> {
  const searches = await Promise.allSettled(titles.map((t) => searchSource("zoro", t)));
  const firstResult = searches.find((r) => r.status === "fulfilled" && r.value.length > 0);
  if (!firstResult || firstResult.status !== "fulfilled") return null;
  {
    const results = firstResult.value;
    const best = results[0];
    const { animeId } = splitExternal(best.id.slice(best.id.indexOf(":") + 1));

    let epId: string;
    try { epId = await getEpisodeId("zoro", animeId, episode); } catch { return null; }

    for (const server of ZORO_SERVERS) {
      try {
        const data = await apiFetch<ConsumetStreamData>(
          `/anime/zoro/watch?episodeId=${encodeURIComponent(epId)}&server=${server}&category=dub`
        );
        const hls = data.sources?.find((s) => s.isM3U8);
        const mp4 = data.sources?.find((s) => !s.isM3U8);
        const chosen = hls ?? mp4;
        if (!chosen) continue;
        return {
          stream: {
            url: chosen.url,
            type: chosen.isM3U8 ? "hls" : "mp4",
            subtitles: (data.subtitles ?? []).map((s) => ({ url: s.url, lang: s.lang, label: s.lang })),
            headers: data.headers,
            dubbed: true,
          },
          consumetId: `consumet:zoro/${animeId}`,
        };
      } catch { continue; }
    }
  }
  return null;
}

// Returns true if Gogoanime has a dub entry for any of the given titles
export async function hasDubOnGogoanime(titles: string[]): Promise<boolean> {
  const results = await Promise.allSettled(
    titles.slice(0, 2).map((t) => searchSource("gogoanime", t))
  );
  return results.some(
    (r) => r.status === "fulfilled" && r.value.some((m) => isDubId(m.id))
  );
}
