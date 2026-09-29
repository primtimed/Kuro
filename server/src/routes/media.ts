import { Router } from "express";
import { cache, cached, TTL } from "../cache/index.js";
import { getProvider, getMediaDetail, anilist, jikan, animepahe } from "../providers/index.js";
import { findSlug, getAnimeId, getEpisodeList, getLatestEpisode, listByAudio, type CatalogListing } from "../providers/anikototv.js";
import { searchNyaa } from "../lib/torrent.js";
import type { Episode, Media } from "../types/media.js";

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

// AniList IDs cost one request per 50, so libraries larger than the old cap of 50 fit.
const MAX_BATCH_IDS = 200;

const al = anilist as typeof anilist & {
  getTrending(): Promise<Media[]>;
  getSeasonal(): Promise<Media[]>;
  getRecommendations(id: string): Promise<Media[]>;
  getByGenre(genre: string): Promise<Media[]>;
  getCardsByIds(externalIds: string[]): Promise<Media[]>;
  matchTitles(titles: string[]): Promise<(Media | null)[]>;
  getRelations(externalId: string): Promise<{ relationType: string; media: Media }[]>;
  searchFiltered(query: string, format?: string, genre?: string, page?: number): Promise<{ items: Media[]; hasNextPage: boolean }>;
};

router.get("/trending", async (req, res) => {
  const type = (req.query.type as string) ?? "anime";

  try {
    const results = await cached(`trending:${type}`, TTL.TRENDING, async () => {
      // Start Jikan in parallel but only await it if AniList comes up short.
      const jikanPromise = jikan.search("").catch(() => [] as Media[]);
      const primary = await al.getTrending().catch(() => [] as Media[]);
      if (primary.length >= 15) return primary;

      const secondary = await jikanPromise;
      const titles = new Set(primary.map((m) => m.title.toLowerCase()));
      return [
        ...primary,
        ...secondary.filter((m) => !titles.has(m.title.toLowerCase())),
      ].slice(0, 30);
    }, (list) => list.length > 0);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/seasonal", async (req, res) => {
  const type = (req.query.type as string) ?? "anime";

  try {
    return res.json(await cached(`seasonal:${type}`, TTL.SEASONAL, () => al.getSeasonal()));
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/search", async (req, res) => {
  const q = (req.query.q as string) ?? "";
  const format = (req.query.format as string) ?? "";
  const genre = ((req.query.genre as string) ?? "").slice(0, 40);
  const page = Math.min(Math.max(parseInt((req.query.page as string) ?? "1", 10) || 1, 1), 200);

  // Require at least a query, a format or a genre filter
  if (!q.trim() && !format && !genre) return res.json({ items: [], hasNextPage: false });

  // Anime search via AniList + Jikan
  const key = `search:anime:${q.toLowerCase()}:${format.toLowerCase()}:${genre.toLowerCase()}:${page}`;
  const hit = cache.get<{ items: Media[]; hasNextPage: boolean }>(key);
  if (hit) return res.json(hit);

  try {
    const [alResults, jikanResults] = await Promise.allSettled([
      al.searchFiltered(q, format || undefined, genre || undefined, page),
      // Jikan can't apply these filters or page, so its results would leak past them / repeat
      format || genre || page > 1 ? Promise.resolve([] as Media[]) : jikan.search(q),
    ]);

    if (alResults.status === "rejected" && jikanResults.status === "rejected") {
      return res.status(502).json({ error: String(alResults.reason) });
    }

    const primary: Media[] = alResults.status === "fulfilled" ? alResults.value.items : [];
    const hasNextPage = alResults.status === "fulfilled" && alResults.value.hasNextPage;
    const secondary: Media[] = jikanResults.status === "fulfilled" ? jikanResults.value : [];

    const titles = new Set(primary.map((m) => m.title.toLowerCase()));
    const merged = [
      ...primary,
      ...secondary.filter((m) => !titles.has(m.title.toLowerCase())),
    ];

    // Jikan-only fallback results are a stopgap while AniList is rate-limited — don't pin them
    const body = { items: merged, hasNextPage };
    if (alResults.status === "fulfilled") cache.set(key, body, TTL.SEARCH);
    return res.json(body);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/media/by-audio?audio=sub|dub&q=&genre=&format=&page=
// anikoto's sub or dub catalog (most viewed first, or keyword-matched), mapped to AniList entries.
router.get("/by-audio", async (req, res) => {
  const audio = req.query.audio === "sub" ? "sub" : "dub";
  const genre = ((req.query.genre as string) ?? "").slice(0, 40);
  const q = ((req.query.q as string) ?? "").trim().slice(0, 100);
  const format = ((req.query.format as string) ?? "").toUpperCase();
  const page = Math.min(Math.max(parseInt((req.query.page as string) ?? "1", 10) || 1, 1), 200);

  try {
    const result = await cached(`by-audio:${audio}:${genre.toLowerCase()}:${q.toLowerCase()}:${page}`, TTL.TRENDING, async () => {
      const { items, hasNextPage } = await listByAudio(audio, page, q, genre);
      // AniList search is strict, and anikoto names movies/OVAs differently ("Naruto the Movie 3:
      // Guardians of…"), so misses are retried with the English title, then the subtitle alone.
      const titleVariants: ((i: CatalogListing) => string | undefined)[] = [
        (i) => i.romajiTitle ?? i.title,
        (i) => (i.romajiTitle ? i.title : undefined),
        (i) => {
          const subtitle = i.title.includes(":") ? i.title.slice(i.title.lastIndexOf(":") + 1).trim() : "";
          return subtitle.split(/\s+/).length >= 2 ? subtitle : undefined;
        },
      ];
      const matches: (Media | null)[] = items.map(() => null);
      for (const toTitle of titleVariants) {
        const pending = items
          .map((item, i) => ({ i, title: matches[i] ? undefined : toTitle(item) }))
          .filter((p): p is { i: number; title: string } => !!p.title);
        if (pending.length === 0) continue;
        const found = await al.matchTitles(pending.map((p) => p.title));
        pending.forEach(({ i }, k) => { matches[i] = found[k]; });
      }
      const seen = new Set<string>();
      const media = matches.filter((m): m is Media => !!m && !seen.has(m.id) && !!seen.add(m.id));
      return { items: media, hasNextPage };
    }, (r) => r.items.length > 0);
    const isFormatMatch = (m: Media) =>
      format === "TV" ? m.mediaFormat === "TV" || m.mediaFormat === "TV_SHORT" : m.mediaFormat === format;
    const items = format ? result.items.filter(isFormatMatch) : result.items;
    return res.json({ items, hasNextPage: result.hasNextPage });
  } catch (err) {
    console.error(`[media] ${audio} catalog failed:`, (err as Error).message);
    return res.status(502).json({ error: String(err) });
  }
});

router.get("/genre/:genre", async (req, res) => {
  const { genre } = req.params;

  try {
    return res.json(await cached(`genre:${genre.toLowerCase()}`, TTL.SEASONAL, () => al.getByGenre(genre)));
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/batch", async (req, res) => {
  const raw = (req.query.ids as string) ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_BATCH_IDS);
  if (ids.length === 0) return res.json([]);

  const found = new Map<string, Media>();
  const missing: string[] = [];
  const stale: string[] = [];
  for (const id of ids) {
    const hit = cache.getWithAge<Media>(`detail:${id}`) ?? cache.getWithAge<Media>(`card:${id}`);
    if (!hit) { missing.push(id); continue; }
    found.set(id, hit.value);
    if (hit.isStale) stale.push(id);
  }

  // Outdated cards are shown as-is and refreshed for the next visit.
  if (stale.length > 0) void fetchCards(stale, new Map());
  await fetchCards(missing, found);

  return res.json(ids.map((id) => found.get(id)).filter((m): m is Media => !!m));
});

async function fetchCards(ids: string[], found: Map<string, Media>): Promise<void> {
  // Card data lacks cast etc., so it's cached under its own key and never served as a detail page.
  const anilistIds = ids.filter((id) => id.startsWith("anilist:"));
  if (anilistIds.length > 0) {
    try {
      const cards = await al.getCardsByIds(anilistIds.map((id) => id.slice("anilist:".length)));
      for (const card of cards) {
        cache.set(`card:${card.id}`, card, TTL.DETAIL);
        found.set(card.id, card);
      }
    } catch (err) {
      console.error(`[media/batch] AniList lookup for ${anilistIds.length} ids failed:`, err);
    }
  }

  await Promise.allSettled(
    ids
      .filter((id) => !id.startsWith("anilist:"))
      .map(async (id) => found.set(id, await getMediaDetail(id)))
  );
}

router.get("/:id", async (req, res) => {
  try {
    return res.json(await getMediaDetail(req.params.id));
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/:id/episodes", async (req, res) => {
  const { id } = req.params;

  try {
    const episodes = await cached(`episodes:${id}`, TTL.EPISODES, () => loadEpisodes(id), (list) => list.length > 0);
    return res.json(episodes);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

async function loadEpisodes(id: string): Promise<Episode[]> {
  const { provider, externalId } = getProvider(id);
  let episodes = await provider.getEpisodes(externalId);

  // AniList returns empty or globally-offset episodes — fall back to Jikan
  if (episodes.length === 0) {
    const media = await getMediaDetail(id).catch(() => null);

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

  return withNewestEpisodes(id, episodes);
}

// AniList and Jikan list new episodes days after they air, while anikototv has them within
// hours. Append those so the newest episode is playable as soon as it is out.
const LATEST_EPISODE_TIMEOUT_MS = 5_000;

async function withNewestEpisodes(id: string, episodes: Episode[]): Promise<Episode[]> {
  const media = await getMediaDetail(id).catch(() => null);
  if (media?.type !== "anime") return episodes;

  const titles = [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[];
  const latest = await Promise.race([
    getLatestEpisode(titles).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LATEST_EPISODE_TIMEOUT_MS)),
  ]);
  if (!latest) return episodes;

  // A known total guards against a fuzzy title match landing on a longer, different season
  const last = media.totalEpisodes ? Math.min(latest, media.totalEpisodes) : latest;
  const highestListed = episodes.reduce((max, e) => Math.max(max, e.number), 0);
  const added: Episode[] = [];
  for (let n = highestListed + 1; n <= last; n++) {
    added.push({ number: n, title: `Episode ${n}`, duration: episodes[0]?.duration });
  }
  return added.length > 0 ? [...episodes, ...added] : episodes;
}

// GET /:id/availability
// Returns per-episode { hasSub, hasDub } using anikototv.to as the primary source
// (per-episode data), with AnimePahe (sub) and Nyaa torrents (dub) as fallbacks.
router.get("/:id/availability", async (req, res) => {
  const { id } = req.params;

  try {
    return res.json(await cached(`availability:${id}`, TTL.EPISODES, () => loadAvailability(id)));
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

async function loadAvailability(id: string): Promise<{ episodes: Record<number, { hasSub: boolean; hasDub: boolean }> }> {
  const { externalId } = getProvider(id);
  const media = await getMediaDetail(id);

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

  return { episodes };
}


router.get("/:id/relations", async (req, res) => {
  const { id } = req.params;
  if (!id.startsWith("anilist:")) return res.json([]);

  try {
    const externalId = id.slice("anilist:".length);
    return res.json(await cached(`relations:${id}`, TTL.DETAIL, () => al.getRelations(externalId)));
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/:id/similar", async (req, res) => {
  const { id } = req.params;

  try {
    return res.json(await cached(`similar:${id}`, TTL.DETAIL, () => loadSimilar(id), (list) => list.length > 0));
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

async function loadSimilar(id: string): Promise<Media[]> {
  const seenIds = new Set<string>([id]);

  // Anime recommendations via AniList
  let animeResults: Media[] = [];
  if (id.startsWith("anilist:")) {
    const externalId = id.slice("anilist:".length);
    animeResults = await al.getRecommendations(externalId).catch(() => []);
  } else {
    const media = await getMediaDetail(id).catch(() => null);
    if (media?.genres?.length) {
      animeResults = await anilist.search(media.genres[0]).catch(() => []);
      animeResults = animeResults.filter((m) => m.id !== id);
    }
  }

  return animeResults.filter((m) => !seenIds.has(m.id)).slice(0, 16);
}

export default router;
