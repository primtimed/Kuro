// anikototv.to stream provider
// Uses sitemap for anime discovery and the site's own AJAX endpoints (with FlareSolverr
// Cloudflare cookies when available) for episode lists and megaplay.buzz embed URLs.

import { cache } from "../cache/index.js";
import { getSiteOrigin } from "./everythingmoe.js";
import type { StreamResult } from "../types/media.js";

// everythingmoe tracks the site's current domain; the constant covers the time before it loads.
const BASE = () => getSiteOrigin("anikoto") ?? "https://anikototv.to";
const FLARE = () => process.env.FLARESOLVERR_URL ?? "http://localhost:8191";

// ── FlareSolverr session (CF clearance cookies) ───────────────────────────────

interface FlareSession { cookieHeader: string; userAgent: string; expiresAt: number }
let _session: FlareSession | null = null;

async function getSession(): Promise<FlareSession> {
  if (_session && Date.now() < _session.expiresAt) return _session;

  const res = await fetch(`${FLARE()}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url: `${BASE()}/`, maxTimeout: 20000 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`FlareSolverr ${res.status}`);
  const json = await res.json() as {
    solution?: { cookies?: Array<{ name: string; value: string }>; userAgent?: string };
  };
  const cookies = json.solution?.cookies ?? [];
  _session = {
    cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    userAgent: json.solution?.userAgent ?? "Mozilla/5.0",
    expiresAt: Date.now() + 25 * 60 * 1000,
  };
  return _session;
}

// Cloudflare only challenges anikototv some of the time, so a missing FlareSolverr
// shouldn't stop requests that would have gone through without clearance cookies.
async function sessionOrDefault(): Promise<Pick<FlareSession, "cookieHeader" | "userAgent">> {
  try {
    return await getSession();
  } catch (err) {
    console.error("[anikoto] FlareSolverr unavailable, trying without clearance cookies:", (err as Error).message);
    return { cookieHeader: "", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" };
  }
}

async function cfGet(path: string, referer?: string): Promise<string> {
  const sess = await sessionOrDefault();
  const res = await fetch(`${BASE()}${path}`, {
    headers: {
      Cookie: sess.cookieHeader,
      "User-Agent": sess.userAgent,
      Referer: referer ?? `${BASE()}/`,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`anikototv ${path} → ${res.status}`);
  return res.text();
}

// ── Sitemap-based anime lookup ────────────────────────────────────────────────
// Sitemap is publicly accessible (no Cloudflare). Each list-N.xml has ~500 URLs.

let _sitemapMap = new Map<string, string>(); // normalizedSlug → fullSlug
let _sitemapLoadedAt = 0;
const SITEMAP_TTL = 24 * 60 * 60 * 1000;

function normSlug(title: string): string {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0)
    .join("-");
}

async function ensureSitemap(): Promise<void> {
  if (Date.now() - _sitemapLoadedAt < SITEMAP_TTL && _sitemapMap.size > 0) return;

  const indexRes = await fetch(`${BASE()}/sitemap.xml`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  const indexXml = await indexRes.text();

  const nums = [...indexXml.matchAll(/sitemap\/list-(\d+)\.xml/g)].map((m) => m[1]);

  const results = await Promise.allSettled(
    nums.map((n) =>
      fetch(`${BASE()}/sitemap/list-${n}.xml`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(15000),
      }).then((r) => r.text())
    )
  );

  const map = new Map<string, string>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const slugs = [...r.value.matchAll(/\/watch\/([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]);
    for (const slug of slugs) {
      const parts = slug.split("-");
      if (parts.length > 1 && /^[a-z0-9]{5}$/.test(parts[parts.length - 1])) {
        const titleSlug = parts.slice(0, -1).join("-");
        map.set(titleSlug, slug);
      }
    }
  }

  _sitemapMap = map;
  _sitemapLoadedAt = Date.now();
}

// Find the anikototv.to slug for an anime by trying multiple title variants
export async function findSlug(titles: string[]): Promise<string | null> {
  await ensureSitemap();

  for (const title of titles) {
    const norm = normSlug(title);
    if (_sitemapMap.has(norm)) return _sitemapMap.get(norm)!;
  }

  // Fuzzy: try partial prefix matches (handles trailing season numbers, punctuation diffs)
  for (const title of titles) {
    const norm = normSlug(title);
    for (const [key, val] of _sitemapMap) {
      if (key === norm || key.startsWith(norm + "-") || norm.startsWith(key + "-")) {
        return val;
      }
    }
  }

  return null;
}

// ── Anime numeric ID ──────────────────────────────────────────────────────────

export async function getAnimeId(slug: string): Promise<number> {
  const cacheKey = `aniko-id:${slug}`;
  const hit = cache.get<number>(cacheKey);
  if (hit) return hit;

  const html = await cfGet(`/watch/${slug}`, `${BASE()}/`);
  const m = html.match(/(?:watch-order|getinfo|episode\/list)\/(\d+)/);
  if (!m) throw new Error(`anikototv: no anime ID in page for ${slug}`);
  const id = parseInt(m[1], 10);
  cache.set(cacheKey, id, 7 * 24 * 60 * 60 * 1000); // 7 days
  return id;
}

// ── Episode list ──────────────────────────────────────────────────────────────

export interface AnikoEpisode {
  id: number;
  num: number;
  hasSub: boolean;
  hasDub: boolean;
  serverIds: string; // opaque token for /ajax/server/list
}

export async function getEpisodeList(animeId: number): Promise<AnikoEpisode[]> {
  // v2: entries now carry serverIds; older cached lists without them must not be reused
  const cacheKey = `aniko-eps-v2:${animeId}`;
  const hit = cache.get<AnikoEpisode[]>(cacheKey);
  if (hit) return hit;

  const text = await cfGet(`/ajax/episode/list/${animeId}`, `${BASE()}/`);
  const json = JSON.parse(text) as { result?: string };
  const html = json.result ?? "";

  // Attributes are read individually because their order in the markup has changed before.
  const eps: AnikoEpisode[] = [];
  for (const [tag] of html.matchAll(/<a\b[^>]*\bdata-num="[^"]*"[^>]*>/g)) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
    const num = parseInt(attr("data-num"), 10);
    if (!Number.isFinite(num)) continue;
    eps.push({
      id: parseInt(attr("data-id"), 10),
      num,
      hasSub: attr("data-sub") === "1",
      hasDub: attr("data-dub") === "1",
      serverIds: attr("data-ids"),
    });
  }

  if (eps.length > 0) cache.set(cacheKey, eps, 60 * 60 * 1000); // 1 hour
  return eps;
}

// ── Episode servers → embed URLs ─────────────────────────────────────────────
// Mirrors the site's own player: /ajax/server/list lists the sub/dub servers for an
// episode, and /ajax/server?get=<link-id> resolves one to a megaplay.buzz embed URL.

interface AnikoServer { name: string; linkId: string }

const SERVER_TTL_MS = 6 * 60 * 60 * 1000;

async function getEpisodeServers(serverIds: string): Promise<Record<"sub" | "dub", AnikoServer[]>> {
  const cacheKey = `aniko-servers:${serverIds}`;
  const hit = cache.get<Record<"sub" | "dub", AnikoServer[]>>(cacheKey);
  if (hit) return hit;

  const json = JSON.parse(await cfGet(`/ajax/server/list?servers=${encodeURIComponent(serverIds)}`)) as { result?: string };
  const html = json.result ?? "";
  const servers = { sub: [] as AnikoServer[], dub: [] as AnikoServer[] };
  for (const type of ["sub", "dub"] as const) {
    const block = html.split(`data-type="${type}"`)[1]?.split("data-type=")[0] ?? "";
    for (const m of block.matchAll(/data-link-id="([^"]+)"[^>]*>([^<]+)</g)) {
      servers[type].push({ linkId: m[1], name: m[2].trim() });
    }
  }

  if (servers.sub.length + servers.dub.length > 0) cache.set(cacheKey, servers, SERVER_TTL_MS);
  return servers;
}

async function resolveServerUrl(linkId: string): Promise<string | null> {
  const cacheKey = `aniko-server-url:${linkId}`;
  const hit = cache.get<string>(cacheKey);
  if (hit) return hit;

  const json = JSON.parse(await cfGet(`/ajax/server?get=${encodeURIComponent(linkId)}`)) as {
    status?: number;
    result?: { url?: string };
  };
  const url = json.status === 200 ? json.result?.url ?? null : null;
  if (url) cache.set(cacheKey, url, SERVER_TTL_MS);
  return url;
}

// ── Main stream function ──────────────────────────────────────────────────────

export async function streamViaAnikoto(
  titles: string[],
  episodeNum: number,
  wantDub: boolean
): Promise<StreamResult> {
  const slug = await findSlug(titles);
  if (!slug) throw new Error("Anime not found on anikototv.to — try searching by English title");

  const animeId = await getAnimeId(slug);
  const episodes = await getEpisodeList(animeId);

  const ep = episodes.find((e) => e.num === episodeNum);
  if (!ep) throw new Error(`Episode ${episodeNum} not available on anikototv.to`);

  const watchUrl = `${BASE()}/watch/${slug}/ep-${episodeNum}`;
  const servers = ep.serverIds
    ? await getEpisodeServers(ep.serverIds).catch((err: unknown) => {
        console.error(`[anikoto] server list for ${slug} ep ${episodeNum} failed:`, err);
        return { sub: [], dub: [] };
      })
    : { sub: [], dub: [] };

  const useDub = wantDub && servers.dub.length > 0;
  const candidates = useDub ? servers.dub : servers.sub;
  // Resolve every server up front so the player can switch instantly if one fails to load.
  const resolved = await Promise.all(
    candidates.map(async (s) => ({ name: s.name, url: await resolveServerUrl(s.linkId).catch(() => null) }))
  );
  const playable = resolved.filter((s): s is { name: string; url: string } => !!s.url);
  if (playable.length > 0) {
    return { url: playable[0].url, type: "embed", subtitles: [], dubbed: useDub, servers: playable };
  }

  // No server resolved — link to the episode on the site itself as a last resort
  return {
    url: watchUrl,
    type: "embed",
    subtitles: [],
    dubbed: useDub,
    watchUrl,
  };
}

// Highest episode number anikototv actually has, which runs ahead of AniList's episode
// listings for airing shows. Null when the show can't be found there.
export async function getLatestEpisode(titles: string[]): Promise<number | null> {
  const slug = await findSlug(titles);
  if (!slug) return null;
  const episodes = await getEpisodeList(await getAnimeId(slug));
  const released = episodes.filter((e) => e.hasSub || e.hasDub).map((e) => e.num);
  return released.length > 0 ? Math.max(...released) : null;
}

// ── Sub / dub catalog ─────────────────────────────────────────────────────────
// AniList has no sub/dub metadata; anikoto's /filter page lists every title it has each for.

export interface CatalogListing {
  title: string;
  romajiTitle?: string;
}

// anikoto's /filter genre IDs for the genres Browse offers (AniList genre names)
const GENRE_IDS: Record<string, string> = {
  Action: "1", Adventure: "2", Comedy: "8", Drama: "62", Ecchi: "214", Fantasy: "3",
  Horror: "222", "Mahou Shoujo": "2310", Mecha: "123", Music: "242", Mystery: "57",
  Psychological: "73", Romance: "28", "Sci-Fi": "12", "Slice of Life": "35",
  Sports: "29", Supernatural: "9", Thriller: "54",
};

export async function listByAudio(
  audio: "sub" | "dub",
  page: number,
  keyword: string,
  genre: string
): Promise<{ items: CatalogListing[]; hasNextPage: boolean }> {
  const params = new URLSearchParams({ "language[]": audio, page: String(page) });
  if (keyword) params.set("keyword", keyword);
  else params.set("sort", "most-viewed");
  if (Object.hasOwn(GENRE_IDS, genre)) params.set("genre[]", GENRE_IDS[genre]);

  const res = await fetch(`${BASE()}/filter?${params}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`anikototv /filter → ${res.status}`);
  const html = await res.text();

  const items = [...html.matchAll(/class="name d-title"[^>]*?(?:data-jp="([^"]*)")?>([^<]+)<\/a>/g)].map((m) => ({
    title: decodeHtml(m[2].trim()),
    romajiTitle: m[1] ? decodeHtml(m[1]) : undefined,
  }));
  return { items, hasNextPage: html.includes(`page=${page + 1}`) };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
