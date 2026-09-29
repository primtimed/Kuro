import { Router } from "express";
import { getMediaDetail } from "../providers/index.js";
import { streamViaAnikoto } from "../providers/anikototv.js";
import { cached, TTL } from "../cache/index.js";

const router = Router();

router.get("/:id/stream", async (req, res) => {
  const { id } = req.params;
  const episode = parseInt((req.query.episode as string) ?? "1", 10);
  const wantDub = req.query.dub === "1" || req.query.dub === "true";

  try {
    const stream = await cached(
      `stream:${id}:${episode}:${wantDub ? "dub" : "sub"}`,
      TTL.EPISODES,
      async () => {
        const media = await getMediaDetail(id);
        const titles = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];
        return streamViaAnikoto(titles, episode, wantDub);
      },
      // The watch-page link is a last-resort fallback; retry for a real embed next time
      (s) => s.type === "embed" && !s.watchUrl
    );
    return res.json(stream);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

export default router;
