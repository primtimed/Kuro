import db from "../db/client.js";

// 30-second in-process cache so providers don't hit the DB on every episode fetch.
let cached: Record<string, string> | null = null;
let expiry = 0;

function load(): Record<string, string> {
  if (cached && Date.now() < expiry) return cached;
  try {
    const row = db.prepare("SELECT value FROM kuro_settings WHERE key = 'scraper_order'").get() as { value: string } | undefined;
    cached = row ? (JSON.parse(row.value)?.scraper_urls ?? {}) : {};
  } catch {
    cached = {};
  }
  expiry = Date.now() + 30_000;
  return cached!;
}

export function getScraperUrl(id: string, defaultUrl: string): string {
  return load()[id] ?? defaultUrl;
}

export function invalidateScraperUrlCache(): void {
  cached = null;
  expiry = 0;
}
