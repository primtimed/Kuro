import type { StreamResult, Episode, Media, Provider } from "../types/media.js";
import { cache } from "../cache/index.js";
import tvmaze, { toSlug } from "./tvmaze.js";

const BASE = "https://www.watchtv.click";

// TVMaze show types treated as movies (single playable page instead of episode URLs)
const MOVIE_TYPES = new Set(["Documentary"]);

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,*/*",
      Referer: BASE,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// The /render/ iframe src is in the static HTML — no JS execution needed.
// Pattern: /render/?type=1&s=1&e=1&id=76479
// The TMDB ID is the `id` query param.
function extractTmdbId(html: string): string | null {
  const m = html.match(/\/render\/\?[^"']*[?&]id=(\d+)/);
  return m?.[1] ?? null;
}

export async function streamTVEpisode(
  tvmazeId: string,
  season: number,
  episode: number
): Promise<StreamResult> {
  const [media, episodes] = await Promise.all([
    tvmaze.getDetail(tvmazeId),
    tvmaze.getEpisodes(tvmazeId).catch(() => [] as Episode[]),
  ]);

  const slug = toSlug(media.title);
  const isMovie =
    episodes.length <= 1 &&
    MOVIE_TYPES.has(String((media as { mediaFormat?: string }).mediaFormat ?? ""));

  const episodePageUrl = isMovie
    ? `${BASE}/movie/${slug}/`
    : `${BASE}/episode/${slug}-${season}x${episode}/`;

  // Step 1 — fetch the static episode page to find the TMDB ID
  try {
    const html = await fetchPage(episodePageUrl);
    const tmdbId = extractTmdbId(html);

    if (tmdbId) {
      // Step 2 — embed vidfast.pro directly: pure video player, no site chrome
      const playerUrl = isMovie
        ? `https://vidfast.pro/movie/${tmdbId}?autoPlay=true&title=true`
        : `https://vidfast.pro/tv/${tmdbId}/${season}/${episode}?autoPlay=true&title=true&poster=true&nextButton=true&autoNext=true`;
      return { url: playerUrl, type: "embed", subtitles: [] };
    }

    // Step 2 fallback — embed the render page (still much cleaner than the full site)
    const renderMatch = html.match(/src="(\/render\/[^"]+)"/);
    if (renderMatch) {
      return { url: `${BASE}${renderMatch[1]}`, type: "embed", subtitles: [] };
    }
  } catch {
    // Network error — fall through to last-resort fallback
  }

  // Last resort: full episode page in iframe
  return { url: episodePageUrl, type: "embed", subtitles: [] };
}

// ── Catalog scraping ──────────────────────────────────────────────────────────

export interface WatchtvCatalogItem {
  slug: string;
  title: string;
  type: "series" | "movie";
  poster: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCards(html: string, type: "series" | "movie"): WatchtvCatalogItem[] {
  const items: WatchtvCatalogItem[] = [];
  for (const m of html.matchAll(/<article class="TPost B">([\s\S]*?)<\/article>/g)) {
    const card = m[1];
    const slugM = card.match(new RegExp(`\\/${type}\\/([a-z0-9][a-z0-9-]*)\\/`));
    const imgM = card.match(/(?:data-src|src)="(\/\/image\.tmdb\.org[^"]+)"/);
    const titleM = card.match(/alt="Image ([^"]+)"/);
    if (!slugM) continue;
    const slug = slugM[1];
    const rawImg = imgM?.[1] ?? "";
    const poster = rawImg ? `https:${rawImg.replace("/w185/", "/w342/")}` : "";
    const title = titleM?.[1] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    items.push({ slug, title, type, poster });
  }
  return items;
}

function parseEpisodesFromHtml(slug: string, html: string): Episode[] {
  const pattern = new RegExp(`/episode/${escapeRegex(slug)}-(\\d+)x(\\d+)/`, "g");
  const bySeason = new Map<number, Set<number>>();
  for (const m of html.matchAll(pattern)) {
    const season = parseInt(m[1], 10);
    const ep = parseInt(m[2], 10);
    if (!bySeason.has(season)) bySeason.set(season, new Set());
    bySeason.get(season)!.add(ep);
  }
  const episodes: Episode[] = [];
  let globalNum = 0;
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    for (const ep of [...bySeason.get(season)!].sort((a, b) => a - b)) {
      globalNum++;
      episodes.push({ number: globalNum, episodeInSeason: ep, seasonNumber: season, title: `Episode ${ep}` });
    }
  }
  return episodes;
}

let _catalog: WatchtvCatalogItem[] = [];
let _catalogAt = 0;
let _catalogInFlight: Promise<WatchtvCatalogItem[]> | null = null;
const CATALOG_TTL = 6 * 60 * 60 * 1000;

export async function scrapeCatalog(seriesPages = 15, moviePages = 10): Promise<WatchtvCatalogItem[]> {
  if (Date.now() - _catalogAt < CATALOG_TTL && _catalog.length > 0) return _catalog;
  // Deduplicate: if a scrape is already in-flight, wait for it instead of launching another.
  if (_catalogInFlight) return _catalogInFlight;

  _catalogInFlight = (async () => {
  const urls: { url: string; type: "series" | "movie" }[] = [];
  for (let p = 1; p <= seriesPages; p++)
    urls.push({ url: p === 1 ? `${BASE}/series/` : `${BASE}/series/page/${p}/`, type: "series" });
  for (let p = 1; p <= moviePages; p++)
    urls.push({ url: p === 1 ? `${BASE}/movie/` : `${BASE}/movie/page/${p}/`, type: "movie" });

  // Fetch pages 4 at a time to avoid triggering watchtv.click rate limits
  const BATCH = 4;
  const seen = new Set<string>();
  const items: WatchtvCatalogItem[] = [];

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(({ url, type }) => fetchPage(url).then((html) => parseCards(html, type)))
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const item of r.value) {
        const key = `${item.type}:${item.slug}`;
        if (!seen.has(key)) { seen.add(key); items.push(item); }
      }
    }
    // Small pause between batches so we don't hammer the server
    if (i + BATCH < urls.length) await new Promise((res) => setTimeout(res, 300));
  }

  _catalog = items;
  _catalogAt = Date.now();
  return items;
  })().finally(() => { _catalogInFlight = null; });

  return _catalogInFlight;
}

export async function getWatchtvEpisodes(slug: string): Promise<Episode[]> {
  const key = `watchtv-eps:${slug}`;
  const hit = cache.get<Episode[]>(key);
  if (hit) return hit;
  const html = await fetchPage(`${BASE}/series/${slug}/`);
  const episodes = parseEpisodesFromHtml(slug, html);
  if (episodes.length > 0) cache.set(key, episodes, CATALOG_TTL);
  return episodes;
}

function slugToName(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getWatchtvDetail(type: "series" | "movie", slug: string): Promise<Media> {
  const key = `watchtv-detail:${type}/${slug}`;
  const hit = cache.get<Media>(key);
  if (hit) return hit;

  const pageUrl = type === "series" ? `${BASE}/series/${slug}/` : `${BASE}/movie/${slug}/`;
  const html = await fetchPage(pageUrl);

  // Series: "Watch {Title} tv show Online Free..."
  // Movie:  "Watch {Title} movie Free Online..."
  const titleM =
    html.match(/og:title content="Watch (.+?) (?:tv show|movie|film|series|show) (?:Online Free|Free Online)/i) ??
    html.match(/og:title content="Watch (.+?) (?:Online Free|Free Online)/i);
  const rawTitle = titleM?.[1] ?? slugToName(slug);

  // Banner: the TPostBg element is always the backdrop/background image (landscape).
  // Both series and movie pages use class=TPostBg (sometimes quoted, sometimes not).
  const tpostBgM = html.match(/class=["']?TPostBg["']?\s+src="(\/\/image\.tmdb\.org[^"]+)"/);
  const bannerRaw = tpostBgM?.[1] ?? "";
  const banner = bannerRaw ? `https:${bannerRaw}` : undefined;

  // Poster: og:image on the detail page is page-specific and guaranteed to be the
  // correct movie's portrait. The catalog thumbnail can misassign slugs, so we
  // prefer og:image and only fall back to the catalog entry when it's missing.
  const ogImageM = html.match(/property=["']og:image["']\s+content=["']((?:https?:)?\/\/image\.tmdb\.org[^"']+)["']/i)
                ?? html.match(/content=["']((?:https?:)?\/\/image\.tmdb\.org[^"']+)["']\s+property=["']og:image["']/i);
  const ogPoster = ogImageM?.[1]
    ? (ogImageM[1].startsWith("//") ? `https:${ogImageM[1]}` : ogImageM[1])
    : "";

  if (_catalog.length === 0) await scrapeCatalog();
  const catalogEntry = _catalog.find((i) => i.type === type && i.slug === slug);
  const poster = ogPoster || catalogEntry?.poster || "";

  // Synopsis from first substantial <p> that isn't site boilerplate
  const pageSynopsis = [...html.matchAll(/<p[^>]*>([^<]{40,})<\/p>/g)]
    .map((m) => m[1].trim())
    .find((p) => !p.toLowerCase().includes("watch tv") && !p.toLowerCase().includes("does not host")) ?? "";

  // Genres from /category/{slug}/ links
  const pageGenres = [...new Set(
    [...html.matchAll(/\/category\/([a-z0-9-]+)\//g)].map((m) => slugToName(m[1]))
  )].slice(0, 5);

  // Year from datePublished
  const yearM = html.match(/"datePublished":"(\d{4})/);
  const pageYear = yearM ? parseInt(yearM[1], 10) : undefined;

  // Cast from /cast_tv/{slug}/ links (present on series pages and some movie pages)
  const castSlugs = [...new Set([...html.matchAll(/\/cast_tv\/([a-z0-9-]+)\//g)].map((m) => m[1]))];
  const directorSlugs = [...new Set([...html.matchAll(/\/director_tv\/([a-z0-9-]+)\//g)].map((m) => m[1]))];
  const pageCast: import("../types/media.js").CastMember[] = [
    ...directorSlugs.slice(0, 2).map((s) => ({ name: slugToName(s), role: "Director" })),
    ...castSlugs.slice(0, 20).map((s) => ({ name: slugToName(s), role: "" })),
  ];

  // Cache episodes while we have the series HTML to avoid a second fetch
  if (type === "series") {
    const eps = parseEpisodesFromHtml(slug, html);
    if (eps.length > 0) cache.set(`watchtv-eps:${slug}`, eps, CATALOG_TTL);
  }

  // TVMaze enrichment for series: use getDetail (not search result) to get cast
  let extra: Partial<Media> = {};
  if (type === "series") {
    try {
      const results = await tvmaze.search(rawTitle);
      if (results.length > 0) {
        const tvmazeId = results[0].id.replace("tvmaze:", "");
        const detail = await tvmaze.getDetail(tvmazeId);
        extra = {
          synopsis: detail.synopsis,
          genres: detail.genres,
          rating: detail.rating,
          cast: detail.cast,
          year: detail.year,
          status: detail.status,
          country: detail.country,
          studios: detail.studios,
        };
      }
    } catch { /* ignore */ }
  }

  const media: Media = {
    id: `watchtv:${type}/${slug}`,
    type: type === "movie" ? "movie" : "series",
    title: rawTitle,
    poster,
    banner,
    synopsis: extra.synopsis || pageSynopsis,
    genres: extra.genres?.length ? extra.genres : pageGenres,
    cast: extra.cast?.length ? extra.cast : pageCast,
    rating: extra.rating,
    year: extra.year ?? pageYear,
    status: extra.status,
    country: extra.country,
    studios: extra.studios,
  };

  cache.set(key, media, 24 * 60 * 60 * 1000);
  return media;
}

export async function streamWatchtvDirect(
  type: "series" | "movie",
  slug: string,
  season: number,
  episode: number
): Promise<StreamResult> {
  const pageUrl =
    type === "movie"
      ? `${BASE}/movie/${slug}/`
      : `${BASE}/episode/${slug}-${season}x${episode}/`;

  try {
    const html = await fetchPage(pageUrl);

    // For movies, prefer the watchtv render URL directly — it's the same player
    // the site uses and avoids constructing a vidfast.pro movie URL that may not exist.
    if (type === "movie") {
      const renderMatch = html.match(/src="(\/render\/\?[^"]+)"/);
      if (renderMatch) return { url: `${BASE}${renderMatch[1]}`, type: "embed", subtitles: [] };
    }

    const tmdbId = extractTmdbId(html);
    if (tmdbId) {
      const playerUrl = `https://vidfast.pro/tv/${tmdbId}/${season}/${episode}?autoPlay=true&title=true&poster=true&nextButton=true&autoNext=true`;
      return { url: playerUrl, type: "embed", subtitles: [] };
    }
    const renderMatch = html.match(/src="(\/render\/[^"]+)"/);
    if (renderMatch) return { url: `${BASE}${renderMatch[1]}`, type: "embed", subtitles: [] };
  } catch { /* network error */ }

  return { url: pageUrl, type: "embed", subtitles: [] };
}

// ── Provider interface ────────────────────────────────────────────────────────
// Registered under the "watchtv" prefix so /api/media/:id routes work
// for watchtv:series/{slug} and watchtv:movie/{slug} IDs.

export const watchtvProvider: Provider = {
  async search(query: string): Promise<Media[]> {
    try {
      const q = query.toLowerCase();
      const items = await scrapeCatalog();
      return items
        .filter((i) => i.title.toLowerCase().includes(q))
        .slice(0, 20)
        .map((i) => ({
          id: `watchtv:${i.type}/${i.slug}`,
          type: i.type === "movie" ? ("movie" as const) : ("series" as const),
          title: i.title,
          poster: i.poster,
          synopsis: "",
          genres: [],
          cast: [],
        }));
    } catch {
      return [];
    }
  },

  async getDetail(externalId: string): Promise<Media> {
    const slashIdx = externalId.indexOf("/");
    const type = externalId.slice(0, slashIdx) as "series" | "movie";
    const slug = externalId.slice(slashIdx + 1);
    return getWatchtvDetail(type, slug);
  },

  async getEpisodes(externalId: string): Promise<Episode[]> {
    const slashIdx = externalId.indexOf("/");
    const type = externalId.slice(0, slashIdx);
    const slug = externalId.slice(slashIdx + 1);
    if (type === "movie") return [{ number: 1, title: "Movie", seasonNumber: 1, episodeInSeason: 1 }];
    return getWatchtvEpisodes(slug);
  },

  async getStream(externalId: string, episode: number): Promise<StreamResult> {
    const slashIdx = externalId.indexOf("/");
    const type = externalId.slice(0, slashIdx) as "series" | "movie";
    const slug = externalId.slice(slashIdx + 1);
    return streamWatchtvDirect(type, slug, 1, episode);
  },
};
