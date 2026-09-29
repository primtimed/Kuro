import { Router } from "express";
import db from "../db/client.js";
import { activeProfileId, ignoreGuestWrites } from "../lib/auth.js";
import { getLiveCatalog, type LiveChannel } from "../providers/iptv.js";

const router = Router();

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;
const MAX_QUERY_LENGTH = 100;
const MAX_CHANNEL_ID_LENGTH = 120;


function getFavoriteIds(aid: string): string[] {
  return db
    .prepare("SELECT channel_id FROM live_favorites WHERE account_id = ? ORDER BY added_at DESC")
    .pluck()
    .all(aid) as string[];
}

// Warm the catalog at startup so the first Live TV visit doesn't wait for a ~25 MB download.
getLiveCatalog().catch((err: unknown) => console.error("[live] initial catalog load failed:", err));

function queryString(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_QUERY_LENGTH) : "";
}

function queryInt(value: unknown, fallback: number, max: number): number {
  const n = parseInt(typeof value === "string" ? value : "", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

function catalogUnavailable(res: import("express").Response, err: unknown) {
  return res.status(503).json({ error: { code: "CATALOG_UNAVAILABLE", message: `Live TV directory unavailable: ${String(err)}` } });
}

// GET /api/live/filters → genres, languages and countries with channel counts
router.get("/filters", async (_req, res) => {
  let catalog;
  try { catalog = await getLiveCatalog(); } catch (err) { return catalogUnavailable(res, err); }

  const countBy = (pick: (c: LiveChannel) => (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const c of catalog.channels) for (const key of pick(c)) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const categoryCounts = countBy((c) => c.categories);
  const languageCounts = countBy((c) => c.languages);
  const countryCounts = countBy((c) => [c.country]);

  return res.json({
    total: catalog.channels.length,
    updatedAt: catalog.updatedAt,
    categories: catalog.categories
      .map((c) => ({ ...c, count: categoryCounts.get(c.id) ?? 0 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count),
    languages: catalog.languages
      .map((l) => ({ ...l, count: languageCounts.get(l.code) ?? 0 }))
      .sort((a, b) => b.count - a.count),
    countries: catalog.countries
      .map((c) => ({ ...c, count: countryCounts.get(c.code) ?? 0 }))
      .sort((a, b) => b.count - a.count),
  });
});

// GET /api/live/favorites → favourite channel ids for the current profile, newest first
router.get("/favorites", (req, res) => {
  res.json(getFavoriteIds(activeProfileId(req)));
});

// POST /api/live/favorites { channel_id }
router.post("/favorites", ignoreGuestWrites, (req, res) => {
  const { channel_id } = (req.body ?? {}) as { channel_id?: unknown };
  if (typeof channel_id !== "string" || !channel_id || channel_id.length > MAX_CHANNEL_ID_LENGTH) {
    return res.status(400).json({ error: { code: "INVALID_CHANNEL_ID", message: "channel_id is required" } });
  }
  db.prepare("INSERT OR IGNORE INTO live_favorites (account_id, channel_id, added_at) VALUES (?, ?, ?)")
    .run(activeProfileId(req), channel_id, Date.now());
  return res.json({ ok: true });
});

// DELETE /api/live/favorites/:channelId
router.delete("/favorites/:channelId", ignoreGuestWrites, (req, res) => {
  db.prepare("DELETE FROM live_favorites WHERE account_id = ? AND channel_id = ?")
    .run(activeProfileId(req), req.params.channelId);
  res.json({ ok: true });
});

// GET /api/live/channels?category=&language=&country=&q=&favorites=1&offset=&limit=
router.get("/channels", async (req, res) => {
  let catalog;
  try { catalog = await getLiveCatalog(); } catch (err) { return catalogUnavailable(res, err); }

  const category = queryString(req.query.category);
  const language = queryString(req.query.language);
  const country = queryString(req.query.country);
  const q = queryString(req.query.q).toLowerCase();
  const offset = queryInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
  const limit = queryInt(req.query.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
  const favoriteIds = req.query.favorites === "1" ? new Set(getFavoriteIds(activeProfileId(req))) : null;

  const matches = catalog.channels.filter(
    (c) =>
      (!favoriteIds || favoriteIds.has(c.id)) &&
      (!category || c.categories.includes(category)) &&
      (!language || c.languages.includes(language)) &&
      (!country || c.country === country) &&
      (!q || c.name.toLowerCase().includes(q))
  );

  return res.json({
    total: matches.length,
    channels: matches.slice(offset, offset + limit).map(({ streams, ...rest }) => ({ ...rest, streamCount: streams.length })),
  });
});

// GET /api/live/channels/:id → one channel including all its stream URLs
router.get("/channels/:id", async (req, res) => {
  let catalog;
  try { catalog = await getLiveCatalog(); } catch (err) { return catalogUnavailable(res, err); }

  const channel = catalog.channels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  return res.json(channel);
});

export default router;
