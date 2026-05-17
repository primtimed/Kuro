import { Router } from "express";
import { cache, TTL } from "../cache/index.js";
import { getProvider, anilist, jikan, animepahe } from "../providers/index.js";
import { findSlug, getAnimeId, getEpisodeList } from "../providers/anikototv.js";
import { searchNyaa } from "../lib/torrent.js";
import type { Media } from "../types/media.js";

// Returns true if the torrent title contains enough words from at least one anime title.
function torrentMatchesAnime(torrentTitle: string, animeTitles: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const t = norm(torrentTitle);
  return animeTitles.some((title) => {
    const words = norm(title).split(" ").filter((w) => w.length >= 4);
    if (!words.length) return false;
    const matched = words.filter((w) => t.includes(w));
    return matched.length >= Math.ceil(words.length * 0.5);
  });
}

// Parse which episode numbers a nyaa torrent title covers.
// Returns a range if one is found, a single episode if found, or [] if nothing matches.
// The "batch = all episodes" fallback only fires for confirmed batch titles with active seeders.
function parseEpisodeRange(title: string, total: number, seeders: number): number[] {
  const rm = title.match(/(?:[Ee(]|\s)0*(\d{1,4})\s*[-~]\s*[Ee]?0*(\d{1,4})(?:[)\s\[]|$)/);
  if (rm) {
    const a = parseInt(rm[1], 10), b = parseInt(rm[2], 10);
    if (a >= 1 && b > a && b <= 2000) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  const em = title.match(/\bE0*(\d{1,4})\b/i);
  if (em) { const n = parseInt(em[1], 10); if (n >= 1 && n <= 2000) return [n]; }
  const dm = title.match(/(?:^|\s)-\s+0*(\d{1,3})(?:\s|\[|\(|$)/);
  if (dm) { const n = parseInt(dm[1], 10); if (n >= 1) return [n]; }
  // No episode number — only treat as a full batch if the title explicitly says so,
  // to avoid marking all episodes as dubbed from a torrent that covers an unknown range.
  if (total > 0 && seeders > 0 && /\bbatch\b|complete\s+series|\bS\d{2}\b/i.test(title)) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  return [];
}

const router = Router();

const al = anilist as typeof anilist & {
  getTrending(): Promise<Media[]>;
  getSeasonal(): Promise<Media[]>;
  getRecommendations(id: string): Promise<Media[]>;
  getByGenre(genre: string): Promise<Media[]>;
  getRelations(externalId: string): Promise<{ relationType: string; media: Media }[]>;
  searchFiltered(query: string, format?: string): Promise<Media[]>;
};

router.get("/trending", async (req, res) => {
  const type = (req.query.type as string) ?? "anime";
  const key = `trending:${type}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    // Start Jikan in parallel but only await it if AniList comes up short.
    const jikanPromise = jikan.search("").catch(() => [] as Media[]);
    const primary = await al.getTrending().catch(() => [] as Media[]);

    if (primary.length >= 15) {
      cache.set(key, primary, TTL.TRENDING);
      return res.json(primary);
    }

    // AniList returned fewer than 15 — supplement with Jikan (already running).
    const secondary = await jikanPromise;
    const titles = new Set(primary.map((m) => m.title.toLowerCase()));
    const merged = [
      ...primary,
      ...secondary.filter((m) => !titles.has(m.title.toLowerCase())),
    ].slice(0, 30);

    cache.set(key, merged, TTL.TRENDING);
    return res.json(merged);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/seasonal", async (req, res) => {
  const type = (req.query.type as string) ?? "anime";
  const key = `seasonal:${type}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    const results = await al.getSeasonal();
    cache.set(key, results, TTL.SEASONAL);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/search", async (req, res) => {
  const q = (req.query.q as string) ?? "";
  const format = (req.query.format as string) ?? "";

  // Require at least a query or a format filter
  if (!q.trim() && !format) return res.json([]);

  // Anime search via AniList + Jikan
  const key = `search:anime:${q.toLowerCase()}:${format.toLowerCase()}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    const [alResults, jikanResults] = await Promise.allSettled([
      al.searchFiltered(q, format || undefined),
      format ? Promise.resolve([] as Media[]) : jikan.search(q),
    ]);

    const primary: Media[] = alResults.status === "fulfilled" ? alResults.value : [];
    const secondary: Media[] = jikanResults.status === "fulfilled" ? jikanResults.value : [];

    const titles = new Set(primary.map((m) => m.title.toLowerCase()));
    const merged = [
      ...primary,
      ...secondary.filter((m) => !titles.has(m.title.toLowerCase())),
    ];

    cache.set(key, merged, TTL.SEARCH);
    return res.json(merged);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/genre/:genre", async (req, res) => {
  const { genre } = req.params;
  const key = `genre:${genre.toLowerCase()}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    const results = await al.getByGenre(genre);
    cache.set(key, results, TTL.SEASONAL);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/batch", async (req, res) => {
  const raw = (req.query.ids as string) ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length === 0) return res.json([]);

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const hit = cache.get<Media>(`detail:${id}`);
      if (hit) return hit;
      const { provider, externalId } = getProvider(id);
      const media = await provider.getDetail(externalId);
      cache.set(`detail:${id}`, media, TTL.DETAIL);
      return media;
    })
  );

  return res.json(
    results
      .filter((r): r is PromiseFulfilledResult<Media> => r.status === "fulfilled")
      .map((r) => r.value)
  );
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const key = `detail:${id}`;
  const cached = cache.get<Media>(key);
  if (cached) return res.json(cached);

  try {
    const { provider, externalId } = getProvider(id);
    const media = await provider.getDetail(externalId);
    cache.set(key, media, TTL.DETAIL);
    return res.json(media);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/:id/episodes", async (req, res) => {
  const { id } = req.params;
  const key = `episodes:${id}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const { provider, externalId } = getProvider(id);
    let episodes = await provider.getEpisodes(externalId);

    // AniList returns empty or globally-offset episodes — fall back to Jikan
    if (episodes.length === 0) {
      let media = cache.get<Media>(`detail:${id}`);
      if (!media) {
        try { media = await provider.getDetail(externalId); } catch { /* ignore */ }
      }

      if (media) {
        // 1. Direct Jikan lookup via malId — guaranteed to match the right season
        if (media.malId) {
          try {
            const jikanEps = await jikan.getEpisodes(String(media.malId));
            if (jikanEps.length > 0) episodes = jikanEps;
          } catch { /* fall through */ }
        }

        // 2. Search by title (only if malId lookup failed)
        if (episodes.length === 0) {
          const queries = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];
          for (const q of queries.slice(0, 2)) {
            try {
              const results = await jikan.search(q);
              if (results.length === 0) continue;
              const jikanEps = await jikan.getEpisodes(results[0].id.replace("jikan:", ""));
              if (jikanEps.length > 0) { episodes = jikanEps; break; }
            } catch { /* try next query */ }
          }
        }

        // 3. Synthetic list from totalEpisodes count
        if (episodes.length === 0 && media.totalEpisodes) {
          episodes = Array.from({ length: media.totalEpisodes }, (_, i) => ({
            number: i + 1,
            title: `Episode ${i + 1}`,
          }));
        }
      }
    }

    cache.set(key, episodes, TTL.EPISODES);
    return res.json(episodes);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /:id/availability
// Returns per-episode { hasSub, hasDub } using anikototv.to as the primary source
// (per-episode data), with AnimePahe (sub) and Nyaa torrents (dub) as fallbacks.
router.get("/:id/availability", async (req, res) => {
  const { id } = req.params;
  const cacheKey = `availability:${id}`;
  const cached = cache.get<{ episodes: Record<number, { hasSub: boolean; hasDub: boolean }> }>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { provider, externalId } = getProvider(id);

    let media = cache.get<Media>(`detail:${id}`);
    if (!media) {
      media = await provider.getDetail(externalId);
      cache.set(`detail:${id}`, media, TTL.DETAIL);
    }

    const titles = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];
    const total = media.totalEpisodes ?? 0;

    // Primary: anikototv.to provides authoritative per-episode sub/dub flags
    const subEps = new Set<number>();
    const dubEps = new Set<number>();
    let usedAnikoto = false;
    try {
      const slug = await findSlug(titles);
      if (slug) {
        const animeId = await getAnimeId(slug);
        const eps = await getEpisodeList(animeId);
        for (const ep of eps) {
          if (ep.hasSub) subEps.add(ep.num);
          if (ep.hasDub) dubEps.add(ep.num);
        }
        usedAnikoto = eps.length > 0;
      }
    } catch { /* anikototv unavailable */ }

    // Fallback for sub: AnimePahe (only if anikototv had no data)
    if (!usedAnikoto) {
      try {
        let paheSession: string | null = null;
        if (id.startsWith("animepahe:")) {
          paheSession = externalId;
        } else {
          for (const title of titles.slice(0, 2)) {
            const results = await animepahe.search(title);
            if (results.length > 0) { paheSession = results[0].id.replace("animepahe:", ""); break; }
          }
        }
        if (paheSession) {
          const eps = await animepahe.getEpisodes(paheSession);
          eps.forEach((ep) => subEps.add(ep.number));
        }
      } catch { /* AnimePahe unavailable */ }
    }

    // Fallback for dub: Nyaa torrents (only if anikototv had no dub data)
    if (!usedAnikoto || dubEps.size === 0) {
      const isDubRelease = (t: string) => /\bdub\b|dual.?audio/i.test(t);
      try {
        for (const title of titles.slice(0, 2)) {
          const results = await searchNyaa(`${title} dub`);
          const dubResults = results.filter(
            (r) => r.seeders > 0 && isDubRelease(r.title) && torrentMatchesAnime(r.title, titles)
          );
          for (const r of dubResults) {
            parseEpisodeRange(r.title, total, r.seeders).forEach((n) => dubEps.add(n));
          }
          if (dubEps.size > 0) break;
        }
      } catch { /* nyaa unavailable */ }
    }

    // Build map over all known episode numbers
    const allNums = new Set<number>([...subEps, ...dubEps]);
    if (total > 0) for (let i = 1; i <= total; i++) allNums.add(i);

    const episodes: Record<number, { hasSub: boolean; hasDub: boolean }> = {};
    for (const n of allNums) episodes[n] = { hasSub: subEps.has(n), hasDub: dubEps.has(n) };

    const result = { episodes };
    cache.set(cacheKey, result, TTL.EPISODES);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});


router.get("/:id/relations", async (req, res) => {
  const { id } = req.params;
  if (!id.startsWith("anilist:")) return res.json([]);

  const key = `relations:${id}`;
  const cached = cache.get<{ relationType: string; media: Media }[]>(key);
  if (cached) return res.json(cached);

  try {
    const externalId = id.slice("anilist:".length);
    const relations = await al.getRelations(externalId).catch(() => []);
    cache.set(key, relations, TTL.DETAIL);
    return res.json(relations);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/:id/similar", async (req, res) => {
  const { id } = req.params;
  const key = `similar:${id}`;
  const cached = cache.get<Media[]>(key);
  if (cached) return res.json(cached);

  try {
    const seenIds = new Set<string>([id]);

    // Anime recommendations via AniList
    let animeResults: Media[] = [];
    if (id.startsWith("anilist:")) {
      const externalId = id.slice("anilist:".length);
      animeResults = await al.getRecommendations(externalId).catch(() => []);
    } else {
      const media = cache.get<Media>(`detail:${id}`);
      if (media?.genres?.length) {
        animeResults = await anilist.search(media.genres[0]).catch(() => []);
        animeResults = animeResults.filter((m) => m.id !== id);
      }
    }

    const results = animeResults.filter((m) => !seenIds.has(m.id)).slice(0, 16);

    cache.set(key, results, TTL.DETAIL);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
