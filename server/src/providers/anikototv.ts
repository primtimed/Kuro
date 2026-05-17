// anikototv.to stream provider
// Uses sitemap for anime discovery, FlareSolverr CF cookies for episode AJAX,
// and FlareSolverr page load to extract megaplay.buzz embed URLs.

import { cache } from "../cache/index.js";
import type { StreamResult } from "../types/media.js";

const BASE = "https://anikototv.to";
const FLARE = () => process.env.FLARESOLVERR_URL ?? "http://localhost:8191";

// ── FlareSolverr session (CF clearance cookies) ───────────────────────────────

interface FlareSession { cookieHeader: string; userAgent: string; expiresAt: number }
let _session: FlareSession | null = null;

async function getSession(): Promise<FlareSession> {
  if (_session && Date.now() < _session.expiresAt) return _session;

  const res = await fetch(`${FLARE()}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url: `${BASE}/`, maxTimeout: 20000 }),
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

async function cfGet(path: string, referer?: string): Promise<string> {
  const sess = await getSession();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Cookie: sess.cookieHeader,
      "User-Agent": sess.userAgent,
      Referer: referer ?? `${BASE}/`,
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

  const indexRes = await fetch(`${BASE}/sitemap.xml`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  const indexXml = await indexRes.text();

  const nums = [...indexXml.matchAll(/sitemap\/list-(\d+)\.xml/g)].map((m) => m[1]);

  const results = await Promise.allSettled(
    nums.map((n) =>
      fetch(`${BASE}/sitemap/list-${n}.xml`, {
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

  const html = await cfGet(`/watch/${slug}`, `${BASE}/`);
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
}

export async function getEpisodeList(animeId: number): Promise<AnikoEpisode[]> {
  const cacheKey = `aniko-eps:${animeId}`;
  const hit = cache.get<AnikoEpisode[]>(cacheKey);
  if (hit) return hit;

  const text = await cfGet(`/ajax/episode/list/${animeId}`, `${BASE}/`);
  const json = JSON.parse(text) as { result?: string };
  const html = json.result ?? "";

  const eps: AnikoEpisode[] = [];
  for (const m of html.matchAll(/data-id="(\d+)"[^>]*data-num="(\d+)"[^>]*data-sub="(\d)"[^>]*data-dub="(\d)"/g)) {
    eps.push({
      id: parseInt(m[1], 10),
      num: parseInt(m[2], 10),
      hasSub: m[3] === "1",
      hasDub: m[4] === "1",
    });
  }

  if (eps.length > 0) cache.set(cacheKey, eps, 60 * 60 * 1000); // 1 hour
  return eps;
}

// ── Megaplay embed URL ────────────────────────────────────────────────────────
// FlareSolverr loads the watch page with JS execution, extracting the megaplay iframe src.

async function getMegaplayUrl(slug: string, episodeNum: number, dub: boolean): Promise<string | null> {
  const cacheKey = `megaplay:${slug}:${episodeNum}:${dub ? "dub" : "sub"}`;
  const hit = cache.get<string>(cacheKey);
  if (hit) return hit;

  const watchUrl = `${BASE}/watch/${slug}/ep-${episodeNum}`;
  try {
    const res = await fetch(`${FLARE()}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url: watchUrl, maxTimeout: 35000 }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { solution?: { response?: string } };
    const html = json.solution?.response ?? "";
    const m = html.match(/src="(https:\/\/megaplay\.buzz\/[^"]+)"/);
    if (!m) return null;

    // Replace audio type if dub requested
    let url = m[1];
    if (dub && url.includes("/sub")) url = url.replace("/sub", "/dub");

    cache.set(cacheKey, url, 6 * 60 * 60 * 1000); // 6 hours
    return url;
  } catch {
    return null;
  }
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

  const useDub = wantDub && ep.hasDub;
  const watchUrl = `${BASE}/watch/${slug}/ep-${episodeNum}`;

  // Try to get the megaplay embed URL
  const embedUrl = await getMegaplayUrl(slug, episodeNum, useDub);
  if (embedUrl) {
    return { url: embedUrl, type: "embed", subtitles: [], dubbed: useDub };
  }

  // FlareSolverr couldn't load the watch page — return the watch URL as fallback
  return {
    url: watchUrl,
    type: "embed",
    subtitles: [],
    dubbed: useDub,
    watchUrl,
  };
}
