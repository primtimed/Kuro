import { Router } from "express";
import { getStreamingSites, SUPPORTED_SITE_SLUGS } from "../providers/everythingmoe.js";

const router = Router();

// Load the streaming-site directory at startup and keep it current, so scrapers follow
// domain changes even when nobody opens Settings.
const DIRECTORY_REFRESH_MS = 6 * 60 * 60 * 1000;
const refreshDirectory = () =>
  getStreamingSites().catch((err: unknown) => console.error("[services] streaming site directory failed:", err));
void refreshDirectory();
setInterval(refreshDirectory, DIRECTORY_REFRESH_MS).unref();

// GET /api/services/directory
// Ranked public anime streaming sites (everythingmoe.com), flagged by whether Kuro can play them.
router.get("/directory", async (_req, res) => {
  try {
    const sites = await getStreamingSites();
    return res.json(sites.map((s) => ({ ...s, isSupported: SUPPORTED_SITE_SLUGS.has(s.slug) })));
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
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
