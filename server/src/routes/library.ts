import { Router } from "express";
import db from "../db/client.js";
import { deleteTorrentFile } from "../lib/torrent.js";
import anilist from "../providers/anilist.js";
import type { Media } from "../types/media.js";

const al = anilist as typeof anilist & {
  getRecommendations(id: string): Promise<Media[]>;
  batchGetSequels(ids: string[], fromMs: number, toMs: number): Promise<Media[]>;
};

const router = Router();

function accountId(req: import("express").Request): string {
  const id = req.headers["x-account-id"];
  return typeof id === "string" && id ? id : "1";
}

function contentTag(mediaId: string): "tv" | "anime" {
  return mediaId.startsWith("tvmaze:") || mediaId.startsWith("watchtv:") ? "tv" : "anime";
}

// --- Favorites ---

router.get("/favorites", (req, res) => {
  const aid = accountId(req);
  const rows = db
    .prepare("SELECT * FROM favorites WHERE account_id = ? ORDER BY added_at DESC")
    .all(aid);
  res.json(rows);
});

router.post("/favorites", (req, res) => {
  const aid = accountId(req);
  const { media_id, type, title, poster } = req.body as {
    media_id: string;
    type: string;
    title: string;
    poster?: string;
  };

  if (!media_id || !type || !title) {
    return res.status(400).json({ error: "media_id, type, and title are required" });
  }

  db.prepare(
    "INSERT OR REPLACE INTO favorites (media_id, account_id, type, title, poster, added_at, content_tag) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(media_id, aid, type, title, poster ?? null, Date.now(), contentTag(media_id));

  return res.json({ ok: true });
});

router.delete("/favorites/:mediaId", (req, res) => {
  const aid = accountId(req);
  db.prepare("DELETE FROM favorites WHERE media_id = ? AND account_id = ?").run(req.params.mediaId, aid);
  res.json({ ok: true });
});

router.get("/favorites/:mediaId", (req, res) => {
  const aid = accountId(req);
  const row = db
    .prepare("SELECT * FROM favorites WHERE media_id = ? AND account_id = ?")
    .get(req.params.mediaId, aid);
  res.json({ favorited: !!row });
});

// --- History / Progress ---

router.get("/history", (req, res) => {
  const aid = accountId(req);
  const rows = db
    .prepare("SELECT * FROM history WHERE account_id = ? ORDER BY last_watched DESC LIMIT 50")
    .all(aid);
  res.json(rows);
});

router.post("/progress", (req, res) => {
  const aid = accountId(req);
  const { media_id, episode_number = 0, progress_seconds, duration_seconds, is_dub } = req.body as {
    media_id: string;
    episode_number?: number;
    progress_seconds: number;
    duration_seconds?: number;
    is_dub?: boolean;
  };

  if (!media_id || progress_seconds == null) {
    return res.status(400).json({ error: "media_id and progress_seconds required" });
  }

  db.prepare(
    `INSERT INTO history (media_id, account_id, episode_number, progress_seconds, duration_seconds, last_watched, is_dub, content_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id, account_id, episode_number) DO UPDATE SET
       progress_seconds = excluded.progress_seconds,
       duration_seconds = COALESCE(excluded.duration_seconds, duration_seconds),
       last_watched = excluded.last_watched,
       is_dub = excluded.is_dub,
       content_tag = excluded.content_tag`
  ).run(media_id, aid, episode_number, progress_seconds, duration_seconds ?? null, Date.now(), is_dub ? 1 : 0, contentTag(media_id));

  if (duration_seconds && progress_seconds / duration_seconds >= 0.95) {
    deleteTorrentFile(`${media_id}:${episode_number}`);
  }

  return res.json({ ok: true });
});

router.get("/progress/:mediaId", (req, res) => {
  const aid = accountId(req);
  const rows = db
    .prepare("SELECT * FROM history WHERE media_id = ? AND account_id = ?")
    .all(req.params.mediaId, aid);
  res.json(rows);
});

router.delete("/history/:mediaId", (req, res) => {
  const aid = accountId(req);
  db.prepare("DELETE FROM history WHERE media_id = ? AND account_id = ?")
    .run(req.params.mediaId, aid);
  res.json({ ok: true });
});

// --- Likes ---

router.get("/likes", (req, res) => {
  const aid = accountId(req);
  const rows = db.prepare("SELECT * FROM likes WHERE account_id = ? ORDER BY liked_at DESC").all(aid);
  res.json(rows);
});

router.get("/likes/:mediaId", (req, res) => {
  const aid = accountId(req);
  const row = db
    .prepare("SELECT * FROM likes WHERE media_id = ? AND account_id = ?")
    .get(req.params.mediaId, aid) as { rating: number } | undefined;
  res.json({ liked: !!row, rating: row?.rating ?? null });
});

router.post("/likes", (req, res) => {
  const aid = accountId(req);
  const { media_id, rating, title, poster } = req.body as {
    media_id: string;
    rating: number;
    title: string;
    poster?: string;
  };

  if (!media_id || !title || rating == null || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "media_id, title, and rating (1–5) are required" });
  }

  db.prepare(
    "INSERT OR REPLACE INTO likes (media_id, account_id, rating, title, poster, liked_at, content_tag) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(media_id, aid, Math.round(rating), title, poster ?? null, Date.now(), contentTag(media_id));

  return res.json({ ok: true });
});

router.delete("/likes/:mediaId", (req, res) => {
  const aid = accountId(req);
  db.prepare("DELETE FROM likes WHERE media_id = ? AND account_id = ?").run(req.params.mediaId, aid);
  res.json({ ok: true });
});

// --- Favorite Series (max 10, 2× recommendation weight) ---

const MAX_FAV_SERIES = 10;

router.get("/favorite-series", (req, res) => {
  const aid = accountId(req);
  const rows = db.prepare("SELECT * FROM favorite_series WHERE account_id = ? ORDER BY added_at DESC").all(aid);
  res.json(rows);
});

router.get("/favorite-series/:mediaId", (req, res) => {
  const aid = accountId(req);
  const row = db.prepare("SELECT * FROM favorite_series WHERE media_id = ? AND account_id = ?").get(req.params.mediaId, aid);
  res.json({ isFavSeries: !!row });
});

router.post("/favorite-series", (req, res) => {
  const aid = accountId(req);
  const { media_id, title, poster } = req.body as { media_id: string; title: string; poster?: string };
  if (!media_id || !title) return res.status(400).json({ error: "media_id and title required" });
  const count = (db.prepare("SELECT COUNT(*) FROM favorite_series WHERE account_id = ?").pluck().get(aid) as number);
  if (count >= MAX_FAV_SERIES) return res.status(409).json({ error: "max_reached", count });
  db.prepare("INSERT OR REPLACE INTO favorite_series (media_id, account_id, title, poster, added_at, content_tag) VALUES (?, ?, ?, ?, ?, ?)")
    .run(media_id, aid, title, poster ?? null, Date.now(), contentTag(media_id));
  return res.json({ ok: true });
});

router.delete("/favorite-series/:mediaId", (req, res) => {
  const aid = accountId(req);
  db.prepare("DELETE FROM favorite_series WHERE media_id = ? AND account_id = ?").run(req.params.mediaId, aid);
  res.json({ ok: true });
});

// --- Manually Watched Shows ---

router.get("/manually-watched", (req, res) => {
  const aid = accountId(req);
  const rows = db.prepare("SELECT * FROM watched_shows WHERE account_id = ? ORDER BY marked_at DESC").all(aid);
  res.json(rows);
});

router.get("/manually-watched/:mediaId", (req, res) => {
  const aid = accountId(req);
  const row = db.prepare("SELECT * FROM watched_shows WHERE media_id = ? AND account_id = ?").get(req.params.mediaId, aid);
  res.json({ watched: !!row });
});

router.post("/manually-watched", (req, res) => {
  const aid = accountId(req);
  const { media_id, title, poster } = req.body as { media_id: string; title: string; poster?: string };
  if (!media_id || !title) return res.status(400).json({ error: "media_id and title required" });
  db.prepare("INSERT OR REPLACE INTO watched_shows (media_id, account_id, title, poster, marked_at, content_tag) VALUES (?, ?, ?, ?, ?, ?)")
    .run(media_id, aid, title, poster ?? null, Date.now(), contentTag(media_id));
  return res.json({ ok: true });
});

router.delete("/manually-watched/:mediaId", (req, res) => {
  const aid = accountId(req);
  db.prepare("DELETE FROM watched_shows WHERE media_id = ? AND account_id = ?").run(req.params.mediaId, aid);
  res.json({ ok: true });
});

// --- Watched Shows ---
// Returns all shows where >= 1 episode has been watched (≥90% progress),
// grouped so the client can apply the 80%-of-episodes threshold.

router.get("/watched-shows", (req, res) => {
  const aid = accountId(req);
  const fromHistory = db.prepare(`
    SELECT media_id, COUNT(*) AS watched_count, MAX(last_watched) AS last_watched, MAX(content_tag) AS content_tag
    FROM history
    WHERE account_id = ?
      AND duration_seconds IS NOT NULL AND duration_seconds > 0
      AND CAST(progress_seconds AS REAL) / duration_seconds >= 0.90
    GROUP BY media_id
    ORDER BY last_watched DESC
  `).all(aid) as { media_id: string; watched_count: number; last_watched: number; content_tag: string }[];

  // Include manually marked shows (watched_count -1 signals "manual", client handles display)
  const manual = db.prepare("SELECT media_id, -1 AS watched_count, marked_at AS last_watched, content_tag FROM watched_shows WHERE account_id = ?")
    .all(aid) as { media_id: string; watched_count: number; last_watched: number; content_tag: string }[];

  // Merge: history takes precedence over manual for the same show
  const seen = new Set(fromHistory.map((r) => r.media_id));
  const merged = [...fromHistory, ...manual.filter((r) => !seen.has(r.media_id))];
  res.json(merged);
});

// --- New Seasons ---

router.get("/new-seasons", async (req, res) => {
  const aid = accountId(req);

  const historyRows = db
    .prepare(
      "SELECT media_id FROM history WHERE account_id = ? GROUP BY media_id ORDER BY MAX(last_watched) DESC LIMIT 30"
    )
    .all(aid) as { media_id: string }[];

  const favRows = db
    .prepare("SELECT media_id FROM favorites WHERE account_id = ? ORDER BY added_at DESC")
    .all(aid) as { media_id: string }[];

  const likeRows = db
    .prepare("SELECT media_id FROM likes WHERE account_id = ? ORDER BY liked_at DESC")
    .all(aid) as { media_id: string }[];

  const allSourceIds = new Set([
    ...historyRows.map((r) => r.media_id),
    ...favRows.map((r) => r.media_id),
    ...likeRows.map((r) => r.media_id),
  ]);

  // Only history entries count as "already watched" — favorited/liked sequels should still appear
  const watchedIds = new Set(historyRows.map((r) => r.media_id));

  const anilistIds = [...allSourceIds]
    .filter((id) => id.startsWith("anilist:"))
    .map((id) => id.replace("anilist:", ""))
    .slice(0, 40);

  if (anilistIds.length === 0) return res.json([]);

  const now = Date.now();
  const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  // fromMs/toMs only used for NOT_YET_RELEASED; RELEASING anime are always included
  const sequels = await al.batchGetSequels(anilistIds, now, now + ONE_MONTH_MS).catch(() => [] as Media[]);
  const filtered = sequels.filter((m) => !watchedIds.has(m.id));

  return res.json(filtered);
});

// --- Recommendations ---

const RECS_TTL_MS = 24 * 60 * 60 * 1000;

// Weighted score for a source show. Higher = stronger recommendation signal.
// Watched base +2; star modifier: 1★=−2, 2★=−1, 3★=+1.5, 4★=+2.0, 5★=+2.5
// Favorite series: score is doubled (minimum base 2 so they always contribute positively).
function sourceWeight(inHistory: boolean, rating: number | null, isFavSeries: boolean): number {
  let score = inHistory ? 2 : 0;
  if (rating !== null) {
    if (rating === 1) score -= 2;
    else if (rating === 2) score -= 1;
    else score += rating * 0.5;
  }
  if (isFavSeries) score = Math.max(2, score) * 2;
  return score;
}

function buildExcludedSet(aid: string): Set<string> {
  const ids: string[] = [];
  for (const row of db.prepare("SELECT media_id FROM history WHERE account_id = ? GROUP BY media_id").all(aid) as { media_id: string }[]) ids.push(row.media_id);
  for (const row of db.prepare("SELECT media_id FROM likes WHERE account_id = ?").all(aid) as { media_id: string }[]) ids.push(row.media_id);
  for (const row of db.prepare("SELECT media_id FROM favorite_series WHERE account_id = ?").all(aid) as { media_id: string }[]) ids.push(row.media_id);
  for (const row of db.prepare("SELECT media_id FROM favorites WHERE account_id = ?").all(aid) as { media_id: string }[]) ids.push(row.media_id);
  for (const row of db.prepare("SELECT media_id FROM watched_shows WHERE account_id = ?").all(aid) as { media_id: string }[]) ids.push(row.media_id);
  return new Set(ids);
}

// Clear recommendation cache so next request recalculates
router.delete("/recommendations", (req, res) => {
  const aid = accountId(req);
  db.prepare("DELETE FROM recommendation_meta WHERE account_id = ?").run(aid);
  res.json({ ok: true });
});

router.get("/recommendations", async (req, res) => {
  const aid = accountId(req);

  // Return cached recommendations if still fresh (< 24h), filtered against current exclusions
  const meta = db
    .prepare("SELECT last_updated FROM recommendation_meta WHERE account_id = ?")
    .get(aid) as { last_updated: number } | undefined;

  if (meta && Date.now() - meta.last_updated < RECS_TTL_MS) {
    const excludedIds = buildExcludedSet(aid);
    const rows = db
      .prepare("SELECT media_json FROM recommendations WHERE account_id = ? AND media_json IS NOT NULL ORDER BY score DESC LIMIT 60")
      .all(aid) as { media_json: string }[];
    const filtered = rows
      .map((r) => JSON.parse(r.media_json) as Media)
      .filter((m) => !excludedIds.has(m.id))
      .slice(0, 30);
    return res.json(filtered);
  }

  // Stale or first load — recalculate
  const historyRows = db
    .prepare("SELECT media_id FROM history WHERE account_id = ? GROUP BY media_id ORDER BY MAX(last_watched) DESC LIMIT 30")
    .all(aid) as { media_id: string }[];

  const likeRows = db
    .prepare("SELECT media_id, rating FROM likes WHERE account_id = ? ORDER BY rating DESC")
    .all(aid) as { media_id: string; rating: number }[];

  const favSeriesRows = db
    .prepare("SELECT media_id FROM favorite_series WHERE account_id = ?")
    .all(aid) as { media_id: string }[];

  const favRows = db
    .prepare("SELECT media_id FROM favorites WHERE account_id = ? AND media_id LIKE 'anilist:%' ORDER BY added_at DESC LIMIT 20")
    .all(aid) as { media_id: string }[];

  const historySet = new Set(historyRows.map((r) => r.media_id));
  const likeMap = new Map(likeRows.map((r) => [r.media_id, r.rating]));
  const favSeriesSet = new Set(favSeriesRows.map((r) => r.media_id));
  const favSet = new Set(favRows.map((r) => r.media_id));

  const allSourceIds = new Set([...historySet, ...likeMap.keys(), ...favSeriesSet, ...favSet]);
  const weightedSources: { id: string; weight: number }[] = [];
  for (const mediaId of allSourceIds) {
    if (!mediaId.startsWith("anilist:")) continue;
    // to-watch items get a base weight of 1 (lower than watched/liked)
    const inHistory = historySet.has(mediaId);
    const rating = likeMap.get(mediaId) ?? null;
    const isFavSeries = favSeriesSet.has(mediaId);
    let weight = sourceWeight(inHistory, rating, isFavSeries);
    if (weight <= 0 && favSet.has(mediaId)) weight = 1;
    if (weight > 0) weightedSources.push({ id: mediaId, weight });
  }
  weightedSources.sort((a, b) => b.weight - a.weight);

  if (weightedSources.length === 0) return res.json([]);

  // Exclude everything the user has already interacted with (watched, liked, to-watch, etc.)
  const excludedIds = buildExcludedSet(aid);

  // Fetch AniList recommendations for top sources (cap at 10 to limit API calls)
  const scoreboard = new Map<string, { media: Media; score: number }>();
  await Promise.allSettled(
    weightedSources.slice(0, 10).map(async ({ id, weight }) => {
      const recs = await al.getRecommendations(id.replace("anilist:", ""));
      for (const rec of recs) {
        if (excludedIds.has(rec.id)) continue;
        const entry = scoreboard.get(rec.id);
        if (entry) entry.score += weight;
        else scoreboard.set(rec.id, { media: rec, score: weight });
      }
    })
  );

  const newRecs = Array.from(scoreboard.values())
    .sort((a, b) => b.score - a.score || (b.media.rating ?? 0) - (a.media.rating ?? 0))
    .slice(0, 50);

  // Merge into DB: upsert new recs (updates score + media), keep old ones untouched
  const upsert = db.prepare(`
    INSERT INTO recommendations (account_id, media_id, score, media_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, media_id) DO UPDATE SET
      score = excluded.score,
      media_json = excluded.media_json
  `);
  const mergeAll = db.transaction(() => {
    for (const { media, score } of newRecs) {
      upsert.run(aid, media.id, score, JSON.stringify(media));
    }
    db.prepare("INSERT OR REPLACE INTO recommendation_meta (account_id, last_updated) VALUES (?, ?)")
      .run(aid, Date.now());
  });
  mergeAll();

  // Return top 30 from DB (includes previously kept items)
  const rows = db
    .prepare("SELECT media_json FROM recommendations WHERE account_id = ? AND media_json IS NOT NULL ORDER BY score DESC LIMIT 30")
    .all(aid) as { media_json: string }[];
  return res.json(rows.map((r) => JSON.parse(r.media_json) as Media));
});

export default router;
