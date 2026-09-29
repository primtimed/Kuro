import { Router } from "express";
import { getMediaDetail } from "../providers/index.js";
import { cache } from "../cache/index.js";
import type { Media } from "../types/media.js";
import { searchNyaa } from "../lib/torrent.js";
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

// GET /api/torrent/dub-available?mediaId=<id>
// Checks nyaa.si for dub releases. Cached 6h. Used by client to show/hide the DUB toggle.
router.get("/dub-available", async (req, res) => {
  const mediaId = decodeURIComponent((req.query.mediaId as string) ?? "");
  if (!mediaId) return res.status(400).json({ error: "mediaId required" });

  const cacheKey = `dub-check:${mediaId}`;
  const cached = cache.get<boolean>(cacheKey);
  if (cached !== null) return res.json({ dubAvailable: cached });

  try {
    const media = await getMediaDetail(mediaId);

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

      const media = await getMediaDetail(mediaId);

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
