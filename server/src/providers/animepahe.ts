// AnimePahe provider — streams English-subbed anime via kwik.cx
// Requires FlareSolverr running on FLARESOLVERR_URL (default http://localhost:8191)
// AnimePahe JSON APIs work directly; kwik.cx embed pages need FlareSolverr + JS unpacking.

import vm from "vm";
import type { Media, Episode, StreamResult, Provider } from "../types/media.js";
import { cache } from "../cache/index.js";
import { getScraperUrl } from "../lib/scraper-config.js";
const BASE = () => getScraperUrl("animepahe", "https://animepahe.com");
const FLARE = process.env.FLARESOLVERR_URL ?? "http://localhost:8191";

// ── Cloudflare session cache ──────────────────────────────────────────────────
// After FlareSolverr solves a challenge, we cache the cf_clearance cookie and
// User-Agent so subsequent API calls can bypass FlareSolverr entirely.

interface FlareSession { cookieHeader: string; userAgent: string; expiresAt: number }
let flareSession: FlareSession | null = null;
const SESSION_TTL = 25 * 60 * 1000; // cf_clearance typically lasts ~30 min

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function flareGet(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(`${FLARE}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 3000),
  });
  if (!res.ok) throw new Error(`FlareSolverr ${res.status}`);
  const json = (await res.json()) as {
    solution?: {
      response?: string;
      status?: number;
      cookies?: Array<{ name: string; value: string }>;
      userAgent?: string;
    };
  };
  const body = json.solution?.response ?? "";
  if (!body) throw new Error(`FlareSolverr returned empty body for ${url}`);

  // Cache session for direct reuse on subsequent requests
  const cookies = json.solution?.cookies;
  const ua = json.solution?.userAgent;
  if (cookies?.length && ua) {
    flareSession = {
      cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      userAgent: ua,
      expiresAt: Date.now() + SESSION_TTL,
    };
  }
  return body;
}

// Try direct fetch with cached Cloudflare session; fall back to FlareSolverr on failure.
async function sessionGet(url: string): Promise<string> {
  if (flareSession && Date.now() < flareSession.expiresAt) {
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: flareSession.cookieHeader,
          "User-Agent": flareSession.userAgent,
          Referer: BASE(),
          Accept: "*/*",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const text = await res.text();
        // Reject Cloudflare challenge pages
        if (text.length > 80 && !text.toLowerCase().includes("cf-browser-verification") && !text.toLowerCase().includes("just a moment")) {
          return text;
        }
      }
    } catch { /* fall through to FlareSolverr */ }
  }
  return flareGet(url);
}

// AnimePahe APIs wrap JSON in <pre> when accessed via browser
function parseJson<T>(html: string): T {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  return JSON.parse(m ? m[1] : html) as T;
}

// API JSON endpoints use sessionGet (direct if session valid, otherwise FlareSolverr)
async function apiGet<T>(path: string): Promise<T> {
  const html = await sessionGet(`${BASE()}${path}`);
  return parseJson<T>(html);
}

// ── kwik.cx unpacker ──────────────────────────────────────────────────────────

function decodeKwik(html: string): string {
  // kwik embeds HLS URL inside an eval(function(p,a,c,k,e,d){...}) packer.
  // Find the <script> block that contains the packer (the packer spans ~3KB so
  // a non-greedy regex stopping at the first "))" only captures ~71 chars).
  const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  const packerBlock = scriptBlocks.find((m) => m[1].includes("eval(function(p,a,c,k,e,d)"));
  if (!packerBlock) throw new Error("kwik: packed script not found");

  let decoded = "";
  const sandbox = { eval: (code: string) => { decoded = code; } };
  vm.runInNewContext(packerBlock[1].trim(), sandbox);

  const m3u8 = decoded.match(/https?:\/\/[^'"<>\s]+\.m3u8[^'"<>\s]*/);
  if (!m3u8) throw new Error("kwik: m3u8 URL not found in decoded script");
  return m3u8[0];
}

async function resolveKwik(kwikUrl: string): Promise<{ url: string; headers: Record<string, string> }> {
  const cached = cache.get<{ url: string; headers: Record<string, string> }>(`kwik:${kwikUrl}`);
  if (cached) return cached;
  const html = await flareGet(kwikUrl);
  const url = decodeKwik(html);
  const result = { url, headers: { Referer: "https://kwik.cx/" } };
  cache.set(`kwik:${kwikUrl}`, result, KWIK_TTL);
  return result;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaheSearchResult {
  total: number;
  data: Array<{ title: string; session: string; episodes: number; poster?: string; year?: number; status?: string }>;
}
interface PaheEpisodeList {
  total: number;
  data: Array<{ episode: number; session: string; filler: number; snapshot?: string; title?: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(animeSession: string) {
  return `animepahe:${animeSession}`;
}

function mapAnime(r: PaheSearchResult["data"][0]): Media {
  return {
    id: makeId(r.session),
    type: "anime",
    title: r.title,
    poster: r.poster ?? "",
    synopsis: "",
    year: r.year,
    genres: [],
    cast: [],
    status: r.status,
    totalEpisodes: r.episodes,
  };
}

const PER_PAGE = 30;
const EP_SESSION_TTL = 24 * 60 * 60 * 1000; // episode sessions are stable
const KWIK_TTL       = 30 * 60 * 1000;       // HLS URLs expire ~30 min

async function getEpisodePage(animeSession: string, page = 1): Promise<PaheEpisodeList> {
  return apiGet<PaheEpisodeList>(`/api?m=release&id=${animeSession}&sort=episode_asc&page=${page}`);
}

// Store every ep.session from a fetched page so future plays skip list fetching entirely.
function warmSessionCache(animeSession: string, rows: PaheEpisodeList["data"]): void {
  for (const ep of rows) {
    cache.set(`pahe-ep:${animeSession}:${ep.episode}`, ep.session, EP_SESSION_TTL);
  }
}

// Returns ep.session for a given episode number.
// Fast path: single cache lookup.
// Normal path: fetch only the one page that should contain this episode.
// Fallback: fetch all pages (handles non-sequential episode numbering).
async function getEpisodeSession(animeSession: string, episodeNum: number): Promise<string> {
  const hit = cache.get<string>(`pahe-ep:${animeSession}:${episodeNum}`);
  if (hit) return hit;

  // Fetch the page that should contain this episode
  const page = Math.max(1, Math.ceil(episodeNum / PER_PAGE));
  const data = await getEpisodePage(animeSession, page);
  warmSessionCache(animeSession, data.data ?? []);

  const ep = (data.data ?? []).find((e) => e.episode === episodeNum);
  if (ep) return ep.session;

  // Episode not on expected page (gaps in numbering) — scan all pages in parallel
  const total = data.total ?? 0;
  const pageCount = Math.min(Math.ceil(total / PER_PAGE), 10);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p !== page);
  const results = await Promise.allSettled(pages.map((p) => getEpisodePage(animeSession, p)));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    warmSessionCache(animeSession, r.value.data ?? []);
    const found = (r.value.data ?? []).find((e) => e.episode === episodeNum);
    if (found) return found.session;
  }

  throw new Error(`AnimePahe: episode ${episodeNum} not found`);
}

async function getAllEpisodes(animeSession: string, total: number): Promise<PaheEpisodeList["data"]> {
  const pageCount = Math.min(Math.ceil(total / PER_PAGE), 10);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const results = await Promise.allSettled(pages.map((p) => getEpisodePage(animeSession, p)));
  const all: PaheEpisodeList["data"] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      warmSessionCache(animeSession, r.value.data ?? []);
      all.push(...(r.value.data ?? []));
    }
  }
  return all.sort((a, b) => a.episode - b.episode);
}

// ── Provider ──────────────────────────────────────────────────────────────────

const animepahe: Provider = {
  async search(query: string): Promise<Media[]> {
    const data = await apiGet<PaheSearchResult>(`/api?m=search&q=${encodeURIComponent(query)}`);
    return (data.data ?? []).map(mapAnime);
  },

  async getDetail(externalId: string): Promise<Media> {
    // externalId is the animepahe session UUID
    const data = await apiGet<PaheSearchResult>(`/api?m=release&id=${externalId}&sort=episode_asc&page=1`);
    // session endpoint returns episode list, not anime info — reconstruct from what we have
    return {
      id: makeId(externalId),
      type: "anime",
      title: externalId, // will be overridden by cache if detail was fetched via search
      poster: "",
      synopsis: "",
      genres: [],
      cast: [],
      totalEpisodes: data.total,
    };
  },

  async getEpisodes(externalId: string): Promise<Episode[]> {
    // Fetch page 1 to get total count, then fetch remaining pages in parallel
    const first = await getEpisodePage(externalId, 1);
    warmSessionCache(externalId, first.data ?? []);
    const totalPages = Math.min(Math.ceil(first.total / PER_PAGE), 10);
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const rest = await Promise.allSettled(remaining.map((p) => getEpisodePage(externalId, p)));
    const all = [...(first.data ?? [])];
    for (const r of rest) {
      if (r.status === "fulfilled") {
        warmSessionCache(externalId, r.value.data ?? []);
        all.push(...(r.value.data ?? []));
      }
    }
    return all
      .sort((a, b) => a.episode - b.episode)
      .map((ep) => ({
        number: ep.episode,
        title: ep.title ?? `Episode ${ep.episode}`,
        thumbnail: ep.snapshot,
      }));
  },

  async getStream(externalId: string, episodeNum: number): Promise<StreamResult> {
    // 1. Get episode session — cache-first, fetches only the needed page on miss
    const epSession = await getEpisodeSession(externalId, episodeNum);

    // 2. Fetch the play page to get kwik.cx embed URL
    const playHtml = await flareGet(`${BASE()}/play/${externalId}/${epSession}`);
    const kwikMatch = playHtml.match(/let\s+url\s*=\s*["'](https?:\/\/kwik\.[^"']+)["']/);
    if (!kwikMatch) throw new Error("AnimePahe: kwik URL not found on play page");

    // 3. Resolve kwik → HLS m3u8 (cached 30 min)
    const { url, headers } = await resolveKwik(kwikMatch[1]);

    return { url, type: "hls", subtitles: [], headers };
  },
};

export default animepahe;

// Direct stream-by-title helper (for use in stream route bridge)
export async function streamAnimepahe(
  titles: string[],
  episodeNum: number
): Promise<{ stream: StreamResult; animepaheId: string }> {
  // Search all titles in parallel — first non-empty result wins
  const searches = await Promise.allSettled(titles.map((t) => animepahe.search(t)));

  for (const r of searches) {
    if (r.status !== "fulfilled" || r.value.length === 0) continue;
    const best = r.value[0];
    const externalId = best.id.replace("animepahe:", "");
    try {
      const stream = await animepahe.getStream(externalId, episodeNum);
      // Pre-warm the next episode's session in the background (no await)
      getEpisodeSession(externalId, episodeNum + 1).catch(() => {});
      return { stream, animepaheId: best.id };
    } catch { continue; }
  }
  throw new Error("AnimePahe: no stream found for the given titles");
}
