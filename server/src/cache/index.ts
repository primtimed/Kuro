import db from "../db/client.js";

// Two-level cache: an in-memory map in front of SQLite, so cached upstream data survives
// server restarts instead of every page starting cold after a deploy.
// Expired entries are kept for STALE_MAX_MS so `cached()` can serve them while refreshing.
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const readRow = db.prepare("SELECT value, expires_at FROM api_cache WHERE key = ?");
const writeRow = db.prepare(
  "INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at"
);
const deleteRow = db.prepare("DELETE FROM api_cache WHERE key = ?");
const deleteOldRows = db.prepare("DELETE FROM api_cache WHERE expires_at < ?");

class PersistentCache {
  private store = new Map<string, CacheEntry>();

  set<T>(key: string, value: T, ttlMs: number): void {
    const entry = { value, expiresAt: Date.now() + ttlMs };
    this.store.set(key, entry);
    try {
      writeRow.run(key, JSON.stringify(value), entry.expiresAt);
    } catch (err) {
      console.error(`[cache] persisting "${key}" failed:`, err);
    }
  }

  // Fresh values only — existing callers treat null as "go fetch".
  get<T>(key: string): T | null {
    const entry = this.entry(key);
    return entry && Date.now() <= entry.expiresAt ? (entry.value as T) : null;
  }

  // Any value younger than STALE_MAX_MS, with whether it has passed its TTL.
  getWithAge<T>(key: string): { value: T; isStale: boolean } | null {
    const entry = this.entry(key);
    if (!entry || Date.now() - entry.expiresAt > STALE_MAX_MS) return null;
    return { value: entry.value as T, isStale: Date.now() > entry.expiresAt };
  }

  delete(key: string): void {
    this.store.delete(key);
    deleteRow.run(key);
  }

  sweep(): void {
    const cutoff = Date.now() - STALE_MAX_MS;
    for (const [key, entry] of this.store) if (entry.expiresAt < cutoff) this.store.delete(key);
    deleteOldRows.run(cutoff);
  }

  private entry(key: string): CacheEntry | null {
    const hit = this.store.get(key);
    if (hit) return hit;
    const row = readRow.get(key) as { value: string; expires_at: number } | undefined;
    if (!row) return null;
    try {
      const entry = { value: JSON.parse(row.value) as unknown, expiresAt: row.expires_at };
      this.store.set(key, entry);
      return entry;
    } catch {
      deleteRow.run(key);
      return null;
    }
  }
}

export const cache = new PersistentCache();
setInterval(() => cache.sweep(), SWEEP_INTERVAL_MS).unref();

const inFlight = new Map<string, Promise<unknown>>();

// Stale-while-revalidate: answers from cache whenever any copy exists — refreshing expired
// copies in the background — so pages only wait on upstream APIs the very first time.
// Concurrent requests for the same key share one upstream fetch.
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<T> {
  const hit = cache.getWithAge<T>(key);
  if (hit && !hit.isStale) return hit.value;

  let refresh = inFlight.get(key) as Promise<T> | undefined;
  if (!refresh) {
    refresh = fetcher()
      .then((value) => {
        if (shouldCache(value)) cache.set(key, value, ttlMs);
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, refresh);
  }

  if (hit) {
    refresh.catch((err: unknown) => console.error(`[cache] background refresh of "${key}" failed:`, err));
    return hit.value;
  }
  return refresh;
}

export const TTL = {
  TRENDING: 60 * 60 * 1000,        // 1 hour
  SEASONAL: 60 * 60 * 1000,        // 1 hour
  SEARCH: 10 * 60 * 1000,          // 10 minutes
  DETAIL: 60 * 60 * 1000,           // 1 hour
  EPISODES: 60 * 60 * 1000,        // 1 hour
};
