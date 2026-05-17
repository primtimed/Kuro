import { Router } from "express";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const router = Router();

// Proxies HLS streams server-side so the browser never touches CDN directly.
// Required because: (1) Referer is a forbidden header in browser XHR/fetch,
// (2) CDN hosts like uwucdn.top have CORS restrictions on direct browser requests.
//
// GET /api/proxy/hls?url=<encoded-url>&ref=<encoded-referer>
router.get("/hls", async (req, res) => {
  const url = decodeURIComponent((req.query.url as string) ?? "");
  const referer = decodeURIComponent((req.query.ref as string) ?? "");

  if (!url.startsWith("http")) {
    return res.status(400).json({ error: "invalid url" });
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (referer) headers["Referer"] = referer;

    const upstream = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
    }

    const ct = upstream.headers.get("content-type") ?? "";
    const isM3u8 = url.split("?")[0].endsWith(".m3u8") || ct.includes("mpegurl");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    if (isM3u8) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      const text = await upstream.text();
      const base = new URL(url);
      const refParam = referer ? `&ref=${encodeURIComponent(referer)}` : "";

      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          // Rewrite URI="..." inside tag lines (e.g. EXT-X-KEY, EXT-X-MAP)
          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
              const abs = uri.startsWith("http") ? uri : new URL(uri, base).toString();
              return `URI="/api/proxy/hls?url=${encodeURIComponent(abs)}${refParam}"`;
            });
          }

          // URL line (segment or sub-manifest)
          const abs = trimmed.startsWith("http") ? trimmed : new URL(trimmed, base).toString();
          return `/api/proxy/hls?url=${encodeURIComponent(abs)}${refParam}`;
        })
        .join("\n");

      return res.send(rewritten);
    }

    // Force video/mp2t for segment files — CDNs often disguise TS segments with
    // image extensions (.jpg etc.) which confuses HLS.js codec detection.
    // AES-128 key files are raw bytes; HLS.js ignores their content-type anyway.
    const isFakeImage = /image\//i.test(ct);
    res.setHeader("Content-Type", isFakeImage ? "video/mp2t" : (ct || "video/mp2t"));
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res);
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: String(err) });
    }
  }
});

export default router;
