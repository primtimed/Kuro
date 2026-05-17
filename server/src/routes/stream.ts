import { Router } from "express";
import { getProvider } from "../providers/index.js";
import { streamViaAnikoto } from "../providers/anikototv.js";
import { cache, TTL } from "../cache/index.js";
import type { Media } from "../types/media.js";

const router = Router();

router.get("/:id/stream", async (req, res) => {
  const { id } = req.params;
  const episode = parseInt((req.query.episode as string) ?? "1", 10);
  const wantDub = req.query.dub === "1" || req.query.dub === "true";

  try {
    const cacheKey = wantDub
      ? `stream-src:${id}:${episode}:dub`
      : `stream-src:${id}:${episode}:sub`;

    // Embed URLs are stable — serve from cache
    const cached = cache.get<string>(cacheKey);
    if (cached) return res.json({ url: cached, type: "embed", subtitles: [], dubbed: wantDub });

    // Fetch media titles
    const detailKey = `detail:${id}`;
    let media = cache.get<Media>(detailKey);
    if (!media) {
      const { provider, externalId } = getProvider(id);
      media = await provider.getDetail(externalId);
      cache.set(detailKey, media, TTL.DETAIL);
    }

    const titles = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];

    const stream = await streamViaAnikoto(titles, episode, wantDub);

    // Only cache when we have an actual embed URL (not a fallback watchUrl)
    if (stream.type === "embed" && !stream.watchUrl) {
      cache.set(cacheKey, stream.url, TTL.EPISODES);
    }

    return res.json(stream);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

export default router;
