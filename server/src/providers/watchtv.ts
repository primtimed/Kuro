import type { StreamResult, Episode, Media, Provider } from "../types/media.js";
import { cache } from "../cache/index.js";
import tvmaze, { toSlug } from "./tvmaze.js";

// watchtv.click died in 2026-09 and came back as watchtv.gd: a TMDB-keyed index that embeds
// third-party players. Its domain can vanish again, so the players (which only need a TMDB or
// IMDb ID) are the real backups — Kuro builds their URLs itself instead of scraping them.
// NOTE: add a new mirror here when the domain moves; they're tried in order.
const SITE_BASES = ["https://watchtv.gd"];

// Ordered by reliability when last checked; the Player lets the viewer switch when one stalls.
const TMDB_PLAYERS: { name: string; tv: (id: string, s: number, e: number) => string; movie: (id: string) => string }[] = [
  {
    name: "VidFast",
    tv: (id, s, e) => `https://vidfast.vc/tv/${id}/${s}/${e}?autoPlay=true&title=true&poster=true&nextButton=true&autoNext=true`,
    movie: (id) => `https://vidfast.vc/movie/${id}?autoPlay=true&title=true`,
  },
  {
    name: "VidLink",
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}?autoplay=true&title=true`,
    movie: (id) => `https://vidlink.pro/movie/${id}?autoplay=true&title=true`,
  },
  { name: "Videasy", tv: (id, s, e) => `https://player.videasy.to/tv/${id}/${s}/${e}`, movie: (id) => `https://player.videasy.to/movie/${id}` },
  { name: "VidRock", tv: (id, s, e) => `https://vidrock.net/tv/${id}/${s}/${e}`, movie: (id) => `https://vidrock.net/movie/${id}` },
  { name: "VidNest", tv: (id, s, e) => `https://vidnest.fun/tv/${id}/${s}/${e}`, movie: (id) => `https://vidnest.fun/movie/${id}` },
  { name: "2Embed", tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`, movie: (id) => `https://www.2embed.cc/embed/${id}` },
  { name: "VidSrc", tv: (id, s, e) => `https://vidsrc.mov/embed/tv/${id}/${s}/${e}`, movie: (id) => `https://vidsrc.mov/embed/movie/${id}` },
  { name: "Peachify", tv: (id, s, e) => `https://peachify.top/embed/tv/${id}/${s}/${e}`, movie: (id) => `https://peachify.top/embed/movie/${id}` },
  { name: "VidUp", tv: (id, s, e) => `https://vidup.to/tv/${id}/${s}/${e}?autoPlay=true`, movie: (id) => `https://vidup.to/movie/${id}?autoPlay=true` },
];

// Players that also accept IMDb IDs, so TVMaze shows stay playable while every site mirror is down.
const IMDB_TV_PLAYERS: { name: string; tv: (imdbId: string, s: number, e: number) => string }[] = [
  { name: "VidFast", tv: (id, s, e) => `https://vidfast.vc/tv/${id}/${s}/${e}?autoPlay=true&title=true&nextButton=true&autoNext=true` },
  { name: "2Embed", tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
  { name: "VidSrc", tv: (id, s, e) => `https://vidsrc.mov/embed/tv/${id}/${s}/${e}` },
];

type Kind = "tv" | "movie";
interface WatchtvRef { kind: Kind; tmdbId: string }

// A dead mirror costs seconds of DNS/connect timeout per attempt and ties up threads other
// lookups need, so skip it for a while after it fails.
const SITE_DOWN_BACKOFF_MS = 10 * 60 * 1000;
const siteDownUntil = new Map<string, number>();

export class WatchtvError extends Error {
  constructor(readonly code: "SITE_UNREACHABLE" | "NOT_FOUND" | "INVALID_ID", message: string) {
    super(message);
  }
}

async function fetchPage(path: string): Promise<string> {
  let lastError: unknown = new WatchtvError("SITE_UNREACHABLE", "every watchtv mirror is paused after failing");
  for (const base of SITE_BASES) {
    if (Date.now() < (siteDownUntil.get(base) ?? 0)) continue;
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,*/*",
          Referer: base,
          // The site serves a JS cookie check instead of content until this cookie is set.
          Cookie: "hv=1",
        },
        signal: AbortSignal.timeout(12000),
      });
    } catch (err) {
      siteDownUntil.set(base, Date.now() + SITE_DOWN_BACKOFF_MS);
      console.error(`[watchtv] ${base} unreachable, pausing it for ${SITE_DOWN_BACKOFF_MS / 60_000} min:`, (err as Error).message);
      lastError = err;
      continue;
    }
    if (res.status === 404) throw new WatchtvError("NOT_FOUND", `watchtv page not found: ${path}`);
    if (!res.ok) {
      lastError = new Error(`HTTP ${res.status} from ${base}${path}`);
      continue;
    }
    return res.text();
  }
  throw lastError;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ── Catalog / search cards ────────────────────────────────────────────────────

export interface WatchtvCatalogItem {
  kind: Kind;
  tmdbId: string;
  title: string;
  year?: number;
  poster: string;
}

// Every card carries toggleWatchlist('tv',1396,'Breaking Bad','<poster>') plus an
// alt="Watch Breaking Bad (2008) online free…" image.
function parseCards(html: string): WatchtvCatalogItem[] {
  const items: WatchtvCatalogItem[] = [];
  const cardRe = /toggleWatchlist\('(tv|movie)',(\d+),'((?:[^'\\]|\\.)*)','([^']*)'\)[\s\S]*?alt="Watch [^"]*?\((\d{4})\)/g;
  for (const m of html.matchAll(cardRe)) {
    items.push({
      kind: m[1] as Kind,
      tmdbId: m[2],
      title: decodeEntities(m[3].replace(/\\(.)/g, "$1")),
      poster: m[4],
      year: parseInt(m[5], 10),
    });
  }
  return items;
}

export function toMediaStub(i: WatchtvCatalogItem): Media {
  return {
    id: `watchtv:${i.kind}/${i.tmdbId}`,
    type: i.kind === "movie" ? "movie" : "series",
    title: i.title,
    poster: i.poster,
    year: i.year,
    synopsis: "",
    genres: [],
    cast: [],
  };
}

let _catalog: WatchtvCatalogItem[] = [];
let _catalogAt = 0;
let _catalogInFlight: Promise<WatchtvCatalogItem[]> | null = null;
const CATALOG_TTL = 6 * 60 * 60 * 1000;
// A failed scrape is slow when the site is down — don't repeat it on every request.
const EMPTY_CATALOG_RETRY_MS = 10 * 60 * 1000;

export async function scrapeCatalog(tvPages = 10, moviePages = 5): Promise<WatchtvCatalogItem[]> {
  const ttl = _catalog.length > 0 ? CATALOG_TTL : EMPTY_CATALOG_RETRY_MS;
  if (_catalogAt > 0 && Date.now() - _catalogAt < ttl) return _catalog;
  // Deduplicate: if a scrape is already in-flight, wait for it instead of launching another.
  if (_catalogInFlight) return _catalogInFlight;

  _catalogInFlight = (async () => {
    const paths: string[] = [];
    for (let p = 1; p <= tvPages; p++) paths.push(`/tv?page=${p}`);
    for (let p = 1; p <= moviePages; p++) paths.push(`/movies?page=${p}`);

    // A few pages at a time so the site doesn't rate-limit us
    const BATCH = 4;
    const seen = new Set<string>();
    const items: WatchtvCatalogItem[] = [];
    for (let i = 0; i < paths.length; i += BATCH) {
      const results = await Promise.allSettled(paths.slice(i, i + BATCH).map((p) => fetchPage(p).then(parseCards)));
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const item of r.value) {
          const key = `${item.kind}:${item.tmdbId}`;
          if (!seen.has(key)) { seen.add(key); items.push(item); }
        }
      }
      if (i + BATCH < paths.length) await new Promise((res) => setTimeout(res, 300));
    }

    _catalog = items;
    _catalogAt = Date.now();
    return items;
  })().finally(() => { _catalogInFlight = null; });

  return _catalogInFlight;
}

export async function searchWatchtv(query: string): Promise<WatchtvCatalogItem[]> {
  const key = `watchtv-search:${query.toLowerCase()}`;
  const hit = cache.get<WatchtvCatalogItem[]>(key);
  if (hit) return hit;
  const items = parseCards(await fetchPage(`/search?q=${encodeURIComponent(query)}`));
  cache.set(key, items, CATALOG_TTL);
  return items;
}

// ── TMDB ID resolution ────────────────────────────────────────────────────────

const TMDB_ID_TTL = 30 * 24 * 60 * 60 * 1000;

async function findTmdbId(kind: Kind, title: string, year?: number): Promise<string | null> {
  const key = `watchtv-tmdb:${kind}:${toSlug(title)}:${year ?? ""}`;
  const hit = cache.get<string>(key);
  if (hit) return hit;

  const wanted = toSlug(title);
  const matches = (await searchWatchtv(title)).filter((i) => i.kind === kind && toSlug(i.title) === wanted);
  // Remakes share titles, so trust the year when we have one.
  const best = (year ? matches.find((i) => i.year !== undefined && Math.abs(i.year - year) <= 1) : undefined) ?? matches[0];
  if (!best) return null;
  cache.set(key, best.tmdbId, TMDB_ID_TTL);
  return best.tmdbId;
}

// IDs are watchtv:tv/{tmdbId} or watchtv:movie/{tmdbId}. Library rows saved before the domain
// moved hold watchtv.click slugs (series/{slug}, movie/{slug}); those are looked up by title.
async function resolveRef(externalId: string): Promise<WatchtvRef> {
  const slashIdx = externalId.indexOf("/");
  if (slashIdx === -1) throw new WatchtvError("INVALID_ID", `invalid watchtv ID: ${externalId}`);
  const type = externalId.slice(0, slashIdx);
  const rest = externalId.slice(slashIdx + 1);
  const kind: Kind = type === "movie" ? "movie" : "tv";
  if (/^\d+$/.test(rest)) return { kind, tmdbId: rest };
  if (type !== "series" && type !== "movie") throw new WatchtvError("INVALID_ID", `invalid watchtv ID: ${externalId}`);

  const tmdbId = await findTmdbId(kind, rest.replace(/-/g, " "));
  if (!tmdbId) throw new WatchtvError("NOT_FOUND", `no watchtv match for legacy ID ${externalId}`);
  return { kind, tmdbId };
}

// ── Detail & episodes ─────────────────────────────────────────────────────────

interface JsonLdPerson { name?: string }
interface JsonLdTitle {
  "@type": string;
  name?: string;
  description?: string;
  datePublished?: string;
  image?: string;
  genre?: string[];
  aggregateRating?: { ratingValue?: number };
  actor?: JsonLdPerson[];
  director?: JsonLdPerson | JsonLdPerson[];
  creator?: JsonLdPerson[];
}

function parseJsonLd(html: string): JsonLdTitle | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]) as JsonLdTitle;
      if (data["@type"] === "TVSeries" || data["@type"] === "Movie") return data;
    } catch {
      // Other ld+json blocks (breadcrumbs, org) aren't needed; a malformed one just gets skipped.
    }
  }
  return null;
}

// Season cards: <a href="/watch/tv/1396/2/1">…<h3>Season 2</h3><p>13 Episodes</p></a>
function parseEpisodes(tmdbId: string, html: string): Episode[] {
  const seasonRe = new RegExp(`/watch/tv/${tmdbId}/(\\d+)/1"[\\s\\S]*?(\\d+) Episodes?<`, "g");
  const perSeason = new Map<number, number>();
  for (const m of html.matchAll(seasonRe)) {
    const season = parseInt(m[1], 10);
    if (season >= 1) perSeason.set(season, parseInt(m[2], 10));
  }
  const episodes: Episode[] = [];
  let globalNum = 0;
  for (const season of [...perSeason.keys()].sort((a, b) => a - b)) {
    for (let ep = 1; ep <= perSeason.get(season)!; ep++) {
      globalNum++;
      episodes.push({ number: globalNum, episodeInSeason: ep, seasonNumber: season, title: `Episode ${ep}` });
    }
  }
  return episodes;
}

async function getDetailPage(ref: WatchtvRef): Promise<string> {
  return fetchPage(`/${ref.kind}/${ref.tmdbId}`);
}

export async function getWatchtvEpisodes(externalId: string): Promise<Episode[]> {
  const ref = await resolveRef(externalId);
  if (ref.kind === "movie") return [{ number: 1, title: "Movie", seasonNumber: 1, episodeInSeason: 1 }];
  const key = `watchtv-eps:tv/${ref.tmdbId}`;
  const hit = cache.get<Episode[]>(key);
  if (hit) return hit;
  const episodes = parseEpisodes(ref.tmdbId, await getDetailPage(ref));
  if (episodes.length > 0) cache.set(key, episodes, CATALOG_TTL);
  return episodes;
}

async function getWatchtvDetail(externalId: string): Promise<Media> {
  const ref = await resolveRef(externalId);
  const key = `watchtv-detail:${ref.kind}/${ref.tmdbId}`;
  const hit = cache.get<Media>(key);
  if (hit) return hit;

  const html = await getDetailPage(ref);
  const ld = parseJsonLd(html);
  const ogTitle = html.match(/og:title" content="Watch (.+?) \(\d{4}\)/)?.[1];
  const title = decodeEntities(ld?.name ?? ogTitle ?? `TMDB ${ref.tmdbId}`);
  const backdrop = html.match(/image\.tmdb\.org\/t\/p\/w1280\/[A-Za-z0-9]+\.jpg/)?.[0];
  const directors = ld?.director ? [ld.director].flat() : ld?.creator ?? [];

  if (ref.kind === "tv") {
    const eps = parseEpisodes(ref.tmdbId, html);
    if (eps.length > 0) cache.set(`watchtv-eps:tv/${ref.tmdbId}`, eps, CATALOG_TTL);
  }

  const media: Media = {
    id: `watchtv:${ref.kind}/${ref.tmdbId}`,
    type: ref.kind === "movie" ? "movie" : "series",
    title,
    poster: ld?.image ?? "",
    banner: backdrop ? `https://${backdrop}` : undefined,
    synopsis: decodeEntities(ld?.description ?? ""),
    genres: ld?.genre ?? [],
    cast: [
      ...directors.slice(0, 2).map((p) => ({ name: p.name ?? "", role: ref.kind === "movie" ? "Director" : "Creator" })),
      ...(ld?.actor ?? []).slice(0, 20).map((p) => ({ name: p.name ?? "", role: "" })),
    ].filter((c) => c.name),
    rating: ld?.aggregateRating?.ratingValue !== undefined ? Math.round(ld.aggregateRating.ratingValue * 10) / 10 : undefined,
    year: ld?.datePublished ? parseInt(ld.datePublished.slice(0, 4), 10) : undefined,
  };

  cache.set(key, media, 24 * 60 * 60 * 1000);
  return media;
}

// ── Streams ───────────────────────────────────────────────────────────────────

function toStream(servers: { name: string; url: string }[]): StreamResult {
  return { url: servers[0].url, type: "embed", subtitles: [], servers };
}

function tmdbServers(ref: WatchtvRef, season: number, episode: number): StreamResult {
  return toStream(TMDB_PLAYERS.map((p) => ({
    name: p.name,
    url: ref.kind === "movie" ? p.movie(ref.tmdbId) : p.tv(ref.tmdbId, season, episode),
  })));
}

export async function streamWatchtvDirect(externalId: string, season: number, episode: number): Promise<StreamResult> {
  return tmdbServers(await resolveRef(externalId), season, episode);
}

export async function streamTVEpisode(tvmazeId: string, season: number, episode: number): Promise<StreamResult> {
  const media = await tvmaze.getDetail(tvmazeId);

  let tmdbId: string | null = null;
  try {
    tmdbId = await findTmdbId("tv", media.title, media.year);
  } catch (err) {
    console.error(`[watchtv] TMDB lookup for tvmaze:${tvmazeId} failed, trying IMDb players:`, (err as Error).message);
  }
  if (tmdbId) return tmdbServers({ kind: "tv", tmdbId }, season, episode);

  if (media.imdbId) {
    const imdbId = media.imdbId;
    return toStream(IMDB_TV_PLAYERS.map((p) => ({ name: p.name, url: p.tv(imdbId, season, episode) })));
  }
  throw new WatchtvError("NOT_FOUND", `no TMDB or IMDb ID found for "${media.title}"`);
}

// ── Provider interface ────────────────────────────────────────────────────────
// Registered under the "watchtv" prefix so /api/media/:id routes work
// for watchtv:tv/{tmdbId} and watchtv:movie/{tmdbId} IDs.

export const watchtvProvider: Provider = {
  async search(query: string): Promise<Media[]> {
    try {
      return (await searchWatchtv(query)).slice(0, 20).map(toMediaStub);
    } catch (err) {
      console.error("[watchtv] search failed:", (err as Error).message);
      return [];
    }
  },

  getDetail: getWatchtvDetail,

  getEpisodes: getWatchtvEpisodes,

  async getStream(externalId: string, episode: number): Promise<StreamResult> {
    return streamWatchtvDirect(externalId, 1, episode);
  },
};
