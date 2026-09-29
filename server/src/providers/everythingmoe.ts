// Ranked directory of public anime streaming sites from everythingmoe.com/simple.
// Streaming sites change domains often; the directory tracks the current address, so
// scrapers read their base URL from here instead of a hardcoded domain that goes stale.

import { cached } from "../cache/index.js";

const DIRECTORY_URL = "https://everythingmoe.com/simple";
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;

export interface StreamingSite {
  rank: number;
  slug: string; // everythingmoe's id, e.g. "anikoto"
  name: string;
  url: string;
}

// everythingmoe slugs of sites Kuro has a scraper for
export const SUPPORTED_SITE_SLUGS = new Set(["anikoto", "animepahe"]);

let latestSites: StreamingSite[] = [];

export async function getStreamingSites(): Promise<StreamingSite[]> {
  const sites = await cached("everythingmoe:anime-streaming", DIRECTORY_TTL_MS, fetchSites, (list) => list.length > 0);
  latestSites = sites;
  return sites;
}

// Current origin for a supported site, or null before the directory has loaded.
export function getSiteOrigin(slug: string): string | null {
  const site = latestSites.find((s) => s.slug === slug);
  if (!site) return null;
  try { return new URL(site.url).origin; } catch { return null; }
}

async function fetchSites(): Promise<StreamingSite[]> {
  const res = await fetch(DIRECTORY_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`everythingmoe → ${res.status}`);
  const html = await res.text();

  const start = html.indexOf('id="sec-anime"');
  if (start === -1) throw new Error("everythingmoe: anime streaming section not found");
  const end = html.indexOf('class="index-group"', start + 20);
  const section = html.slice(start, end === -1 ? undefined : end);

  const sites: StreamingSite[] = [];
  for (const m of section.matchAll(/data-rank="(\d+)"[\s\S]*?<a href="\/s\/([^"]+)" data-link="([^"]+)"[^>]*>(?:<img[^>]*>)?\s*([^<]+)<\/a>/g)) {
    sites.push({ rank: parseInt(m[1], 10), slug: m[2], url: m[3], name: m[4].trim() });
  }
  return sites;
}
