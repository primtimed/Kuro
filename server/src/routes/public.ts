import { Router } from "express";

import { cached, TTL } from "../cache/index.js";
import { anilist } from "../providers/index.js";

import type { Media } from "../types/media.js";

// Routes here are reachable without signing in, so they expose nothing about the household:
// only public cover-art URLs for the sign-in page background.
const router = Router();

const MAX_POSTERS = 30;

const al = anilist as typeof anilist & { getTrending(): Promise<Media[]> };

// GET /api/public/sign-in-art → { posters: string[] } trending cover images
router.get("/sign-in-art", async (_req, res) => {
  try {
    const posters = await cached("sign-in-art", TTL.TRENDING, async () => {
      const trending = await al.getTrending();
      return trending.map((m) => m.poster).filter((p): p is string => !!p).slice(0, MAX_POSTERS);
    }, (list) => list.length > 0);
    res.set("Cache-Control", "public, max-age=3600");
    return res.json({ posters });
  } catch (err) {
    console.error("[public] loading sign-in art failed:", err);
    return res.status(502).json({ error: { code: "ART_UNAVAILABLE", message: "Cover art is unavailable right now" } });
  }
});

export default router;
