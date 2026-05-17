import { Router } from "express";
import tvmaze from "../providers/tvmaze.js";
import {
  streamTVEpisode,
  streamWatchtvDirect,
  scrapeCatalog,
  getWatchtvEpisodes,
  watchtvProvider,
} from "../providers/watchtv.js";
import { cache, TTL } from "../cache/index.js";
import db from "../db/client.js";
import type { Media } from "../types/media.js";

function accountId(req: import("express").Request): string {
  const id = req.headers["x-account-id"];
  return typeof id === "string" && id ? id : "1";
}

const router = Router();

router.get("/recommendations", async (req, res) => {
  const aid = accountId(req);
  const cacheKey = `tv:recs:${aid}`;
  const cached = cache.get<Media[]>(cacheKey);
  if (cached) return res.json(cached);

  // Weight sources: history (3) > watched (2) > favorites/to-watch (2) > likes (1)
  const historyRows = db.prepare("SELECT media_id FROM history WHERE account_id = ? AND media_id LIKE 'tvmaze:%' GROUP BY media_id ORDER BY MAX(last_watched) DESC LIMIT 10").all(aid) as { media_id: string }[];
  const watchedRows = db.prepare("SELECT media_id FROM watched_shows WHERE account_id = ? AND media_id LIKE 'tvmaze:%' ORDER BY marked_at DESC LIMIT 10").all(aid) as { media_id: string }[];
  const favRows = db.prepare("SELECT media_id FROM favorites WHERE account_id = ? AND media_id LIKE 'tvmaze:%' ORDER BY added_at DESC LIMIT 10").all(aid) as { media_id: string }[];
  const likeRows = db.prepare("SELECT media_id FROM likes WHERE account_id = ? AND media_id LIKE 'tvmaze:%' ORDER BY liked_at DESC LIMIT 10").all(aid) as { media_id: string }[];

  const excludedIds = new Set<string>();
  for (const r of [...historyRows, ...watchedRows, ...favRows, ...likeRows]) excludedIds.add(r.media_id);

  const sourceWeightMap = new Map<string, number>();
  for (const r of historyRows) sourceWeightMap.set(r.media_id, (sourceWeightMap.get(r.media_id) ?? 0) + 3);
  for (const r of watchedRows) sourceWeightMap.set(r.media_id, (sourceWeightMap.get(r.media_id) ?? 0) + 2);
  for (const r of favRows) sourceWeightMap.set(r.media_id, (sourceWeightMap.get(r.media_id) ?? 0) + 2);
  for (const r of likeRows) sourceWeightMap.set(r.media_id, (sourceWeightMap.get(r.media_id) ?? 0) + 1);

  if (sourceWeightMap.size === 0) return res.json([]);

  const topSources = [...sourceWeightMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  // Collect genre frequencies from source shows, weighted by interaction type
  const genreCounts = new Map<string, number>();
  await Promise.allSettled(
    topSources.map(async (id) => {
      const show = await tvmaze.getDetail(id.slice("tvmaze:".length));
      const w = sourceWeightMap.get(id) ?? 1;
      for (const genre of show.genres) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + w);
      }
    })
  );

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => genre);

  if (topGenres.length === 0) return res.json([]);

  // Score shows from top genres, exclude already-seen
  const scoreboard = new Map<string, { media: Media; score: number }>();
  await Promise.allSettled(
    topGenres.map(async (genre, i) => {
      const shows = await tvmaze.getByGenre(genre);
      const weight = topGenres.length - i;
      for (const show of shows) {
        if (excludedIds.has(show.id)) continue;
        const entry = scoreboard.get(show.id);
        if (entry) entry.score += weight;
        else scoreboard.set(show.id, { media: show, score: weight });
      }
    })
  );

  const result = [...scoreboard.values()]
    .sort((a, b) => b.score - a.score || (b.media.rating ?? 0) - (a.media.rating ?? 0))
    .slice(0, 20)
    .map((e) => e.media);

  // Only cache non-empty results so transient API failures don't lock out recommendations
  if (result.length > 0) cache.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

router.get("/trending", async (_req, res) => {
  const cached = cache.get<Media[]>("tv:trending");
  if (cached) return res.json(cached);
  try {
    const results = await tvmaze.getTrending();
    cache.set("tv:trending", results, TTL.TRENDING);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/onair", async (_req, res) => {
  const cached = cache.get<Media[]>("tv:onair");
  if (cached) return res.json(cached);
  try {
    const results = await tvmaze.getOnAir();
    cache.set("tv:onair", results, TTL.TRENDING);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/genre/:genre", async (req, res) => {
  const { genre } = req.params;
  const key = `tv:genre:${genre.toLowerCase()}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);
  try {
    const results = await tvmaze.getByGenre(genre);
    cache.set(key, results, TTL.SEASONAL);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/search", async (req, res) => {
  const q = (req.query.q as string) ?? "";
  if (!q.trim()) return res.json([]);

  const key = `tv:search:${q.toLowerCase()}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    const qLower = q.toLowerCase();

    // Run TVMaze search and watchtv catalog filter in parallel
    const [tvmazeResults, catalogItems] = await Promise.all([
      tvmaze.search(q).catch(() => [] as Media[]),
      scrapeCatalog().catch(() => []),
    ]);

    // Filter catalog by query
    const catalogMatches: Media[] = catalogItems
      .filter((i) => i.title.toLowerCase().includes(qLower))
      .map((i) => ({
        id: `watchtv:${i.type}/${i.slug}`,
        type: i.type === "movie" ? ("movie" as const) : ("series" as const),
        title: i.title,
        poster: i.poster,
        synopsis: "",
        genres: [],
        cast: [],
      }));

    // Merge: TVMaze first; skip watchtv entries whose title is already represented
    const tvmazeTitles = new Set(tvmazeResults.map((m) => m.title.toLowerCase()));
    const uniqueCatalog = catalogMatches.filter((m) => !tvmazeTitles.has(m.title.toLowerCase()));
    const results = [...tvmazeResults, ...uniqueCatalog];

    cache.set(key, results, TTL.SEARCH);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/watchtv/catalog", async (_req, res) => {
  const key = "tv:watchtv:catalog";
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);
  try {
    const items = await scrapeCatalog();
    const medias: Media[] = items.map((i) => ({
      id: `watchtv:${i.type}/${i.slug}`,
      type: i.type === "movie" ? ("movie" as const) : ("series" as const),
      title: i.title,
      poster: i.poster,
      synopsis: "",
      genres: [],
      cast: [],
    }));
    cache.set(key, medias, 6 * 60 * 60 * 1000);
    return res.json(medias);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/:id/similar", async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  if (id.startsWith("watchtv:")) return res.json([]);
  if (!id.startsWith("tvmaze:")) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "TV IDs must use tvmaze: or watchtv: prefix" } });
  }
  const externalId = id.slice("tvmaze:".length);

  const key = `tv:similar:${id}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    const results = await tvmaze.getSimilar(externalId);
    cache.set(key, results, TTL.DETAIL);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/:id/episodes", async (req, res) => {
  const id = decodeURIComponent(req.params.id);

  if (id.startsWith("watchtv:")) {
    const rest = id.slice("watchtv:".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid watchtv ID" } });
    const type = rest.slice(0, slashIdx);
    const slug = rest.slice(slashIdx + 1);
    try {
      if (type === "movie") return res.json([{ number: 1, title: "Movie", seasonNumber: 1, episodeInSeason: 1 }]);
      const episodes = await getWatchtvEpisodes(slug);
      return res.json(episodes);
    } catch (err) {
      return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
    }
  }

  if (!id.startsWith("tvmaze:")) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "TV IDs must use tvmaze: or watchtv: prefix" } });
  }
  const externalId = id.slice("tvmaze:".length);

  const key = `tv:episodes:${id}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const episodes = await tvmaze.getEpisodes(externalId);
    cache.set(key, episodes, TTL.EPISODES);
    return res.json(episodes);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/:id/stream", async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const season = parseInt((req.query.season as string) ?? "1", 10);
  const episode = parseInt((req.query.episode as string) ?? "1", 10);

  if (isNaN(season) || season < 1 || isNaN(episode) || episode < 1) {
    return res.status(400).json({ error: { code: "INVALID_PARAMS", message: "season and episode must be positive integers" } });
  }

  if (id.startsWith("watchtv:")) {
    const rest = id.slice("watchtv:".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid watchtv ID" } });
    const type = rest.slice(0, slashIdx) as "series" | "movie";
    const slug = rest.slice(slashIdx + 1);
    try {
      const stream = await streamWatchtvDirect(type, slug, season, episode);
      return res.json(stream);
    } catch (err) {
      return res.status(502).json({ error: { code: "STREAM_ERROR", message: String(err) } });
    }
  }

  if (!id.startsWith("tvmaze:")) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "TV IDs must use tvmaze: or watchtv: prefix" } });
  }

  const externalId = id.slice("tvmaze:".length);
  try {
    const stream = await streamTVEpisode(externalId, season, episode);
    return res.json(stream);
  } catch (err) {
    return res.status(502).json({ error: { code: "STREAM_ERROR", message: String(err) } });
  }
});

router.get("/:id", async (req, res) => {
  const id = decodeURIComponent(req.params.id);

  if (id.startsWith("watchtv:")) {
    const rest = id.slice("watchtv:".length);
    if (rest.indexOf("/") === -1) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid watchtv ID" } });
    const key = `tv:detail:${id}`;
    const cached = cache.get<Media>(key);
    if (cached) return res.json(cached);
    try {
      const media = await watchtvProvider.getDetail(rest);
      cache.set(key, media, TTL.DETAIL);
      return res.json(media);
    } catch (err) {
      return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
    }
  }

  if (!id.startsWith("tvmaze:")) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "TV IDs must use tvmaze: or watchtv: prefix" } });
  }
  const externalId = id.slice("tvmaze:".length);

  const key = `tv:detail:${id}`;
  const cached = cache.get<Media>(key);
  if (cached) return res.json(cached);

  try {
    const media = await tvmaze.getDetail(externalId);
    cache.set(key, media, TTL.DETAIL);
    return res.json(media);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

export default router;
