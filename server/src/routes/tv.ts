import { Router } from "express";
import tvmaze from "../providers/tvmaze.js";
import {
  streamTVEpisode,
  streamWatchtvDirect,
  scrapeCatalog,
  getWatchtvEpisodes,
  watchtvProvider,
} from "../providers/watchtv.js";
import { cache, cached, TTL } from "../cache/index.js";
import db from "../db/client.js";
import { activeProfileId } from "../lib/auth.js";
import type { Media } from "../types/media.js";


const router = Router();

const CATALOG_SEARCH_DEADLINE_MS = 3000;

router.get("/recommendations", async (req, res) => {
  const aid = activeProfileId(req);
  try {
    // Only cache non-empty results so transient API failures don't lock out recommendations
    return res.json(await cached(`tv:recs:${aid}`, 30 * 60 * 1000, () => loadRecommendations(aid), (list) => list.length > 0));
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

async function loadRecommendations(aid: string): Promise<Media[]> {
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

  if (sourceWeightMap.size === 0) return [];

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

  if (topGenres.length === 0) return [];

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

  return [...scoreboard.values()]
    .sort((a, b) => b.score - a.score || (b.media.rating ?? 0) - (a.media.rating ?? 0))
    .slice(0, 20)
    .map((e) => e.media);
}

router.get("/trending", async (_req, res) => {
  try {
    return res.json(await cached("tv:trending", TTL.TRENDING, () => tvmaze.getTrending()));
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/onair", async (_req, res) => {
  try {
    return res.json(await cached("tv:onair", TTL.TRENDING, () => tvmaze.getOnAir()));
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/genre/:genre", async (req, res) => {
  const { genre } = req.params;
  const key = `tv:genre:${genre.toLowerCase()}`;
  try {
    return res.json(await cached(key, TTL.SEASONAL, () => tvmaze.getByGenre(genre)));
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/search", async (req, res) => {
  const q = (req.query.q as string) ?? "";
  if (!q.trim()) return res.json([]);

  const key = `tv:search:${q.toLowerCase()}`;
  const hit = cache.get<Media[]>(key);
  if (hit) return res.json(hit);

  try {
    const qLower = q.toLowerCase();

    // The catalog scrape can take over a minute; don't hold search results hostage to it.
    // It keeps running in the background, so later searches include catalog matches.
    const catalogWithDeadline = Promise.race([
      scrapeCatalog().catch(() => []),
      new Promise<[]>((resolve) => setTimeout(() => resolve([]), CATALOG_SEARCH_DEADLINE_MS)),
    ]);
    const [tvmazeOutcome, catalogItems] = await Promise.all([
      tvmaze.search(q).then(
        (results) => ({ ok: true as const, results }),
        (err: unknown) => ({ ok: false as const, err })
      ),
      catalogWithDeadline,
    ]);

    if (!tvmazeOutcome.ok && catalogItems.length === 0) {
      return res.status(502).json({ error: { code: "FETCH_ERROR", message: String(tvmazeOutcome.err) } });
    }
    const tvmazeResults = tvmazeOutcome.ok ? tvmazeOutcome.results : [];

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

    // Partial results (TVMaze down) shouldn't stick around for the full search TTL
    if (tvmazeOutcome.ok) cache.set(key, results, TTL.SEARCH);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

router.get("/watchtv/catalog", async (_req, res) => {
  // A full scrape takes over a minute (and watchtv.click is often down), so answer after the
  // deadline with whatever is cached; the scrape keeps running and fills the cache for next time.
  // An empty result is cached too (watchtv.click is gone); it is retried hourly in the background.
  const catalog = cached("tv:watchtv:catalog", 60 * 60 * 1000, loadWatchtvCatalog)
    .catch((err: unknown) => {
      console.error("[tv] watchtv catalog failed:", err);
      return [] as Media[];
    });
  const deadline = new Promise<Media[]>((resolve) => setTimeout(() => resolve([]), CATALOG_SEARCH_DEADLINE_MS));
  return res.json(await Promise.race([catalog, deadline]));
});

async function loadWatchtvCatalog(): Promise<Media[]> {
  const items = await scrapeCatalog();
  return items.map((i) => ({
    id: `watchtv:${i.type}/${i.slug}`,
    type: i.type === "movie" ? ("movie" as const) : ("series" as const),
    title: i.title,
    poster: i.poster,
    synopsis: "",
    genres: [],
    cast: [],
  }));
}

router.get("/:id/similar", async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  if (id.startsWith("watchtv:")) return res.json([]);
  if (!id.startsWith("tvmaze:")) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "TV IDs must use tvmaze: or watchtv: prefix" } });
  }
  const externalId = id.slice("tvmaze:".length);

  const key = `tv:similar:${id}`;
  try {
    return res.json(await cached(key, TTL.DETAIL, () => tvmaze.getSimilar(externalId)));
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
  try {
    return res.json(await cached(key, TTL.EPISODES, () => tvmaze.getEpisodes(externalId)));
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
    try {
      return res.json(await cached(key, TTL.DETAIL, () => watchtvProvider.getDetail(rest)));
    } catch (err) {
      return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
    }
  }

  if (!id.startsWith("tvmaze:")) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "TV IDs must use tvmaze: or watchtv: prefix" } });
  }
  const externalId = id.slice("tvmaze:".length);

  const key = `tv:detail:${id}`;
  try {
    return res.json(await cached(key, TTL.DETAIL, () => tvmaze.getDetail(externalId)));
  } catch (err) {
    return res.status(500).json({ error: { code: "FETCH_ERROR", message: String(err) } });
  }
});

export default router;
