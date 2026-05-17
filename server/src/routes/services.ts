import { Router } from "express";
import db from "../db/client.js";
import { cache } from "../cache/index.js";
import { invalidateScraperUrlCache } from "../lib/scraper-config.js";

const router = Router();

// ─── Scraper catalog ──────────────────────────────────────────────────────────
// All scrapers Kuro knows how to use. `audio` says which order lists it belongs in.
// `knownDomains` is used to match a URL the user types to a scraper ID.

export const SCRAPER_CATALOG = [
  {
    id: "animepahe",
    name: "AnimePahe",
    defaultUrl: "https://animepahe.com",
    note: "Sub only · Fast HLS",
    audio: ["sub"] as ("sub" | "dub")[],
    knownDomains: ["animepahe.com", "animepahe.ru", "animepahe.org", "animepahe.net"],
  },
  {
    id: "gogoanime",
    name: "Gogoanime",
    defaultUrl: "https://gogoanime.gg",
    note: "Sub + Dub · Via Consumet",
    audio: ["sub", "dub"] as ("sub" | "dub")[],
    knownDomains: ["gogoanime.gg", "gogoanime.by", "gogoanime.cm", "gogoanime.pe", "anitaku.to"],
  },
  {
    id: "zoro",
    name: "Zoro / Aniwatch",
    defaultUrl: "https://aniwatch.to",
    note: "Sub + Dub · Via Consumet",
    audio: ["sub", "dub"] as ("sub" | "dub")[],
    knownDomains: ["zoro.to", "aniwatch.to", "aniwatchtv.to", "hianime.to"],
  },
  {
    id: "torrent",
    name: "Nyaa Torrents",
    defaultUrl: "https://nyaa.si",
    note: "Last resort · Best coverage",
    audio: ["sub", "dub"] as ("sub" | "dub")[],
    knownDomains: ["nyaa.si", "nyaa.land"],
  },
] as const;

export type ScraperId = (typeof SCRAPER_CATALOG)[number]["id"];

// GET /api/services/scrapers
// Returns the full catalog — client uses this to render the add/remove UI.
router.get("/scrapers", (_req, res) => {
  res.json(SCRAPER_CATALOG);
});

// GET /api/services/scrapers/test?source=anikototv
// Checks whether a Consumet source name is valid by doing a test search.
router.get("/scrapers/test", async (req, res) => {
  const source = (req.query.source as string ?? "").trim();
  if (!source) return res.status(400).json({ ok: false, error: "source required" });

  const base = process.env.CONSUMET_BASE_URL ?? "https://api.consumet.org";
  try {
    const r = await fetch(
      `${base}/anime/${encodeURIComponent(source)}/naruto?page=1`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!r.ok) return res.json({ ok: false, error: `Consumet returned HTTP ${r.status} for source "${source}"` });
    const data = (await r.json()) as { results?: unknown[] };
    const count = data.results?.length ?? 0;
    if (count === 0) return res.json({ ok: false, error: `Source "${source}" returned no results — it may not be supported by Consumet` });
    return res.json({ ok: true, count });
  } catch (err) {
    return res.json({ ok: false, error: String(err) });
  }
});

// ─── Scraper settings (global) ────────────────────────────────────────────────

export type CustomScraper = {
  id: string;       // unique slug, e.g. "anikototv"
  name: string;     // display name, e.g. "AnikotoTV"
  url: string;      // website URL, e.g. "https://anikototv.to"
  source: string;   // Consumet source name, e.g. "anikototv"
  audio: ("sub" | "dub")[];
};

const CATALOG_IDS = new Set<string>(SCRAPER_CATALOG.map((s) => s.id));

function isCustomScraperValid(c: unknown): c is CustomScraper {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.id === "string" && /^[a-z0-9_-]+$/.test(o.id) && !CATALOG_IDS.has(o.id) &&
    typeof o.name === "string" && o.name.length > 0 &&
    typeof o.url === "string" && o.url.startsWith("http") &&
    typeof o.source === "string" && o.source.length > 0 &&
    Array.isArray(o.audio) && (o.audio as string[]).every((a) => a === "sub" || a === "dub")
  );
}

type Settings = {
  sub_order: string[];
  dub_order: string[];
  scraper_urls: Record<string, string>;
  custom_scrapers: CustomScraper[];
};

function loadSettings(): Settings {
  const defaults: Settings = {
    sub_order: ["animepahe", "gogoanime", "zoro", "torrent"],
    dub_order: ["gogoanime", "zoro", "animepahe", "torrent"],
    scraper_urls: {},
    custom_scrapers: [],
  };
  const row = db.prepare("SELECT value FROM kuro_settings WHERE key = 'scraper_order'").get() as { value: string } | undefined;
  if (!row) return defaults;
  try {
    const p = JSON.parse(row.value);
    const customs: CustomScraper[] = Array.isArray(p.custom_scrapers)
      ? (p.custom_scrapers as unknown[]).filter(isCustomScraperValid)
      : [];
    const customIds = new Set(customs.map((c) => c.id));
    const validId = (s: string) => CATALOG_IDS.has(s) || customIds.has(s);
    return {
      sub_order: Array.isArray(p.sub_order) ? (p.sub_order as string[]).filter(validId) : defaults.sub_order,
      dub_order: Array.isArray(p.dub_order) ? (p.dub_order as string[]).filter(validId) : defaults.dub_order,
      scraper_urls: (p.scraper_urls && typeof p.scraper_urls === "object") ? p.scraper_urls : {},
      custom_scrapers: customs,
    };
  } catch {
    return defaults;
  }
}

// GET /api/services/settings
router.get("/settings", (_req, res) => {
  res.json(loadSettings());
});

// PUT /api/services/settings
router.put("/settings", (req, res) => {
  const { sub_order, dub_order, scraper_urls, custom_scrapers } = req.body as {
    sub_order?: string[];
    dub_order?: string[];
    scraper_urls?: Record<string, string>;
    custom_scrapers?: unknown[];
  };

  const current = loadSettings();

  const incomingCustoms: CustomScraper[] = Array.isArray(custom_scrapers)
    ? custom_scrapers.filter(isCustomScraperValid)
    : current.custom_scrapers;
  const customIds = new Set(incomingCustoms.map((c) => c.id));
  const validId = (s: string) => CATALOG_IDS.has(s) || customIds.has(s);
  const validList = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((s) => typeof s === "string" && validId(s));

  const validUrls = (obj: unknown): obj is Record<string, string> => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    return Object.entries(obj).every(
      ([k, v]) => (CATALOG_IDS.has(k) || customIds.has(k)) && typeof v === "string" && (v === "" || v.startsWith("http"))
    );
  };

  const updated: Settings = {
    sub_order: validList(sub_order) ? sub_order : current.sub_order,
    dub_order: validList(dub_order) ? dub_order : current.dub_order,
    scraper_urls: validUrls(scraper_urls) ? scraper_urls : current.scraper_urls,
    custom_scrapers: incomingCustoms,
  };

  db.prepare(`
    INSERT INTO kuro_settings (key, value, updated_at) VALUES ('scraper_order', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(updated), Date.now());

  cache.delete("scraper_order");
  invalidateScraperUrlCache();

  return res.json({ ok: true, settings: updated });
});

// ─── Stream extractor ─────────────────────────────────────────────────────────
// Fetches an anime episode webpage and extracts the HLS/MP4 stream URL.
// Tries direct fetch first; falls back to FlareSolverr for Cloudflare-protected sites.

const FLARE_URL = () => process.env.FLARESOLVERR_URL ?? "http://localhost:8191";

async function fetchHtml(url: string, referer?: string): Promise<string> {
  const ref = referer ?? (new URL(url).origin + "/");
  // Try direct fetch first (fast, works for non-Cloudflare sites)
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: ref,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const text = await res.text();
      if (!text.toLowerCase().includes("just a moment") && !text.toLowerCase().includes("cf-browser-verification")) {
        return text;
      }
    }
  } catch { /* fall through to FlareSolverr */ }

  // Cloudflare detected — use FlareSolverr
  const flareRes = await fetch(`${FLARE_URL()}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 20000 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!flareRes.ok) throw new Error(`FlareSolverr ${flareRes.status}`);
  const json = await flareRes.json() as { solution?: { response?: string } };
  const body = json.solution?.response ?? "";
  if (!body) throw new Error("FlareSolverr returned empty body");
  return body;
}

function extractStreamUrl(html: string): { url: string; type: "hls" | "mp4" } | null {
  // Direct .m3u8 reference
  const m3u8 = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/);
  if (m3u8) return { url: m3u8[1], type: "hls" };

  // Common player config patterns: file: "...", src: "...", source: "..."
  const srcPatterns = [
    /['"](https?:\/\/[^'"]+\.mp4[^'"]*)['"]/,
    /file\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/,
    /src\s*:\s*["'`](https?:\/\/[^"'`]+\.mp4[^"'`]*)["'`]/,
  ];
  for (const pat of srcPatterns) {
    const m = html.match(pat);
    if (m) return { url: m[1], type: "mp4" };
  }

  return null;
}

function extractIframeSrc(html: string, baseUrl: string): string | null {
  // Common video host domains used by anime sites
  const VIDEO_HOSTS = ["filemoon", "vidhide", "streamwish", "doodstream", "mp4upload",
    "mixdrop", "upstream", "streamlare", "kwik", "embtaku", "gogoplayer", "megaplay.buzz",
    "mewcdn", "allanime", "vidstream", "mycloud", "rapid-cloud", "megacloud"];
  const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)];
  for (const m of iframes) {
    const src = m[1].startsWith("http") ? m[1] : new URL(m[1], baseUrl).href;
    if (VIDEO_HOSTS.some((h) => src.includes(h))) return src;
  }
  // Fall back to first iframe with an http src (skip ads/tracking iframes)
  for (const m of iframes) {
    const src = m[1].startsWith("http") ? m[1] : new URL(m[1], baseUrl).href;
    if (src.startsWith("http") && !src.includes("google") && !src.includes("ad") && !src.includes("pagead")) return src;
  }
  return null;
}

// GET /api/services/extract-stream?url=https://anikototv.to/watch/...
router.get("/extract-stream", async (req, res) => {
  const rawUrl = (req.query.url as string ?? "").trim();
  if (!rawUrl.startsWith("http")) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    // 1. Fetch the episode page
    const html = await fetchHtml(rawUrl);

    // 2. Look for stream URL directly in page
    const direct = extractStreamUrl(html);
    if (direct) return res.json(direct);

    // 3. Follow the video iframe one level (pass parent page as Referer)
    const iframeSrc = extractIframeSrc(html, rawUrl);
    if (iframeSrc) {
      try {
        const iframeHtml = await fetchHtml(iframeSrc, rawUrl);
        const fromIframe = extractStreamUrl(iframeHtml);
        if (fromIframe) return res.json(fromIframe);
      } catch { /* iframe fetch failed */ }
    }

    return res.status(404).json({ error: "Stream URL not found — the player likely loads via JavaScript. Open the video in your browser, then right-click the video → Copy video address, and paste it here." });
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// ─── Launch redirect ──────────────────────────────────────────────────────────

router.get("/launch", (req, res) => {
  const raw = (req.query.target as string) ?? "";
  const target = raw.startsWith("http") ? raw : decodeURIComponent(raw);
  if (!target.startsWith("https://")) return res.redirect("/");
  return res.redirect(target);
});

export default router;
