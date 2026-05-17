import { Router } from "express";
import { getProvider } from "../providers/index.js";
import { cache, TTL } from "../cache/index.js";
import type { Media } from "../types/media.js";
import { findTorrent, addTorrent, streamTorrentFile, getTorrentProgress, searchNyaa } from "../lib/torrent.js";
import { hasDubOnGogoanime } from "../providers/consumet.js";

async function checkDubAvailable(media: Media): Promise<boolean> {
  const titles = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];
  const isEnglishDub = (t: string) =>
    /\bdub\b|dual.?audio/i.test(t) &&
    !/[一-鿿぀-ゟ゠-ヿ]/.test(t) &&
    !/\b(?:chinese|mandarin|cantonese|french|german|spanish|italian|portuguese|korean)\s*dub/i.test(t);
  const searchQueries = titles.slice(0, 2).flatMap((t) =>
    ["dub", "dual audio", "english dub"].map((s) => `${t} ${s}`)
  );
  const [nyaaResults, gogoHasDub] = await Promise.all([
    Promise.allSettled(searchQueries.map((q) => searchNyaa(q))),
    hasDubOnGogoanime(titles).catch(() => false),
  ]);
  const nyaaHasDub = nyaaResults.some(
    (r) => r.status === "fulfilled" && r.value.some((v) => isEnglishDub(v.title))
  );
  return nyaaHasDub || (gogoHasDub as boolean);
}

const router = Router();

// GET /api/torrent/find?mediaId=<id>&episode=<n>&season=<s>&dub=<0|1>
// Finds a torrent on nyaa.si, adds it to WebTorrent, returns the stream URL.
router.get("/find", async (req, res) => {
  const mediaId = decodeURIComponent((req.query.mediaId as string) ?? "");
  const episode = parseInt((req.query.episode as string) ?? "1", 10);
  const season = parseInt((req.query.season as string) ?? "1", 10);
  const wantDub = req.query.dub === "1";

  if (!mediaId) return res.status(400).json({ error: "mediaId required" });

  const key = `${mediaId}:${episode}`;

  try {
    // Get media titles from cache or provider
    const detailKey = `detail:${mediaId}`;
    let media = cache.get<Media>(detailKey);
    if (!media) {
      const { provider, externalId } = getProvider(mediaId);
      media = await provider.getDetail(externalId);
      cache.set(detailKey, media, TTL.DETAIL);
    }

    const titles = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];
    const result = await findTorrent(titles, episode, season, wantDub);

    // Add to WebTorrent (non-blocking metadata fetch)
    const info = await addTorrent(key, result.magnet);

    return res.json({
      streamUrl: `/api/torrent/stream?key=${encodeURIComponent(key)}`,
      title: result.title,
      fileName: info.fileName,
      fileSize: info.fileSize,
      dubbed: wantDub,
    });
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/torrent/stream?key=<mediaId:episode>
// Streams the torrent video file with range request support.
router.get("/stream", (req, res) => {
  const key = decodeURIComponent((req.query.key as string) ?? "");
  if (!key) return res.status(400).json({ error: "key required" });

  const served = streamTorrentFile(key, req, res);
  if (!served) {
    return res.status(404).json({ error: "Torrent not found — call /find first" });
  }
});

// GET /api/torrent/progress?key=<mediaId:episode>
// Returns download progress 0–100.
router.get("/progress", (req, res) => {
  const key = decodeURIComponent((req.query.key as string) ?? "");
  const pct = getTorrentProgress(key);
  if (pct === null) return res.status(404).json({ error: "not found" });
  return res.json({ progress: pct });
});

// GET /api/torrent/dub-available?mediaId=<id>
// Checks nyaa.si for dub releases. Cached 6h. Used by client to show/hide the DUB toggle.
router.get("/dub-available", async (req, res) => {
  const mediaId = decodeURIComponent((req.query.mediaId as string) ?? "");
  if (!mediaId) return res.status(400).json({ error: "mediaId required" });

  const cacheKey = `dub-check:${mediaId}`;
  const cached = cache.get<boolean>(cacheKey);
  if (cached !== null) return res.json({ dubAvailable: cached });

  try {
    const detailKey = `detail:${mediaId}`;
    let media = cache.get<Media>(detailKey);
    if (!media) {
      const { provider, externalId } = getProvider(mediaId);
      media = await provider.getDetail(externalId);
      cache.set(detailKey, media, TTL.DETAIL);
    }

    const dubAvailable = await checkDubAvailable(media);

    cache.set(cacheKey, dubAvailable, 6 * 60 * 60 * 1000); // 6 hours
    return res.json({ dubAvailable });
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/torrent/dub-available-batch?ids=id1,id2,...
// Returns { [mediaId]: boolean } for up to 50 IDs in one request.
// Hits the 6-hour server cache per ID — uncached IDs run concurrently.
router.get("/dub-available-batch", async (req, res) => {
  const raw = (req.query.ids as string) ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length === 0) return res.json({});

  const results = await Promise.allSettled(
    ids.map(async (mediaId) => {
      const cacheKey = `dub-check:${mediaId}`;
      const hit = cache.get<boolean>(cacheKey);
      if (hit !== null) return { mediaId, dubAvailable: hit };

      const detailKey = `detail:${mediaId}`;
      let media = cache.get<Media>(detailKey);
      if (!media) {
        const { provider, externalId } = getProvider(mediaId);
        media = await provider.getDetail(externalId);
        cache.set(detailKey, media, TTL.DETAIL);
      }

      const dubAvailable = await checkDubAvailable(media);
      cache.set(cacheKey, dubAvailable, 6 * 60 * 60 * 1000);
      return { mediaId, dubAvailable };
    })
  );

  const out: Record<string, boolean> = {};
  for (const r of results) {
    if (r.status === "fulfilled") out[r.value.mediaId] = r.value.dubAvailable;
  }
  return res.json(out);
});

export default router;
