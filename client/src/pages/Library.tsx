import React, { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookMarked, History, Star, Eye, Heart, LayoutGrid, Search, X } from "lucide-react";
import type { FavoriteEntry, HistoryEntry, LikeEntry, Media } from "../lib/types";
import { api } from "../lib/api";
import { progressPercent, toFormatLabel } from "../lib/utils";
import { useAccount } from "../context/AccountContext";
import { useMediaMode } from "../context/MediaModeContext";
import { AnimeCover } from "../lib/procedural";
import { useIsMobile } from "../hooks/useIsMobile";
import { lcGet, lcSet } from "../lib/localCache";

function resolveTag(contentTag: string | undefined, mediaId: string): string {
  return contentTag ?? (mediaId.startsWith("tvmaze:") ? "tv" : "anime");
}

type Tab = "overview" | "favorites" | "history" | "liked" | "watched" | "fav-series";
type AudioFilter = "all" | "sub" | "dub";

type WatchedGroup = {
  media_id: string;
  watched_count: number;
  last_watched: number;
  media: Media | null;
  content_tag: string;
};

type HistoryGroup = {
  media_id: string;
  entry: HistoryEntry;
  media: Media | null;
};

interface LibraryCache {
  favorites: FavoriteEntry[];
  likes: LikeEntry[];
  favSeries: { media_id: string; title: string; poster?: string; added_at: number; content_tag?: string }[];
  history: HistoryGroup[];
  watched: WatchedGroup[];
  bannerMap: Record<string, string>;
  posterMap: Record<string, string>;
}

const LIBRARY_CACHE_TTL = 3 * 60 * 1000;

function resumeEpisode(g: HistoryGroup): number {
  if (!g.entry.duration_seconds) return g.entry.episode_number;
  const pct = g.entry.progress_seconds / g.entry.duration_seconds;
  if (pct >= 0.90 && g.media?.totalEpisodes && g.entry.episode_number < g.media.totalEpisodes) {
    return g.entry.episode_number + 1;
  }
  return g.entry.episode_number;
}

function isCompleted(g: HistoryGroup): boolean {
  if (!g.entry.duration_seconds) return false;
  const pct = g.entry.progress_seconds / g.entry.duration_seconds;
  if (pct < 0.90) return false;
  if (!g.media?.totalEpisodes) return false;
  return g.entry.episode_number >= g.media.totalEpisodes;
}

export function Library() {
  const { account } = useAccount();
  const { mode } = useMediaMode();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [history, setHistory] = useState<HistoryGroup[]>([]);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [watched, setWatched] = useState<WatchedGroup[]>([]);
  const [favSeries, setFavSeries] = useState<{ media_id: string; title: string; poster?: string; added_at: number }[]>([]);
  const [bannerMap, setBannerMap] = useState<Map<string, string>>(new Map());
  const [posterMap, setPosterMap] = useState<Map<string, string>>(new Map());
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [watchedLoading, setWatchedLoading] = useState(true);
  const [audioFilter, setAudioFilter] = useState<AudioFilter>("all");
  const [dubIds, setDubIds] = useState<Set<string> | null>(null);
  const [dubChecking, setDubChecking] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");

  useEffect(() => {
    setHistoryLoading(true);
    setWatchedLoading(true);
    setDubIds(null);
    setAudioFilter("all");

    // Show cached data instantly while fresh data loads in background
    const cacheKey = `library:${account?.id ?? "anon"}`;
    const hit = lcGet<LibraryCache>(cacheKey);
    if (hit) {
      setFavorites(hit.favorites);
      setLikes(hit.likes);
      setFavSeries(hit.favSeries);
      setHistory(hit.history);
      setWatched(hit.watched);
      setBannerMap(new Map(Object.entries(hit.bannerMap)));
      setPosterMap(new Map(Object.entries(hit.posterMap ?? {})));
      setHistoryLoading(false);
      setWatchedLoading(false);
    }

    Promise.all([
      api.library.favorites(),
      api.library.history(),
      api.library.likes(),
      api.library.watchedShows(),
      api.library.favoriteSeries(),
    ])
      .then(async ([favs, hist, lks, watchedRows, favSeriesRows]) => {
        // Favorites, liked, fav-series render immediately from DB data — no getMedia needed.
        setFavorites(favs);
        setLikes(lks);
        setFavSeries(favSeriesRows);

        // Group history by media_id, keep most-recent entry per show
        const grouped = new Map<string, HistoryEntry>();
        for (const e of hist) {
          const existing = grouped.get(e.media_id);
          if (!existing || e.last_watched > existing.last_watched) grouped.set(e.media_id, e);
        }
        const historyGroups = [...grouped.entries()].map(
          ([media_id, entry]): HistoryGroup => ({ media_id, entry, media: null })
        );

        // Single batch for ALL media IDs across every tab — replaces three sequential waves.
        const allIds = [
          ...new Set([
            ...historyGroups.map((g) => g.media_id),
            ...watchedRows.map((r) => r.media_id),
            ...favs.map((f) => f.media_id),
            ...lks.map((l) => l.media_id),
            ...favSeriesRows.map((f) => f.media_id),
          ]),
        ];
        const medias = await api.getMediaBatch(allIds);
        const mediaMap = new Map(medias.map((m) => [m.id, m]));

        // Resolve history — filter completed shows
        const resolvedHistory = historyGroups
          .map((g) => ({ ...g, media: mediaMap.get(g.media_id) ?? null }))
          .filter((g) => !isCompleted(g));
        setHistory(resolvedHistory);
        setHistoryLoading(false);

        // Resolve watched from history rows (now has totalEpisodes for filtering)
        const watchedFromHistory = watchedRows
          .map((r) => ({
            media_id: r.media_id,
            watched_count: r.watched_count,
            last_watched: r.last_watched,
            media: mediaMap.get(r.media_id) ?? null,
            content_tag: resolveTag((r as { content_tag?: string }).content_tag, r.media_id),
          }))
          .filter((g) => {
            if (g.watched_count === -1) return true;
            if (!g.media?.totalEpisodes) return false;
            return g.watched_count / g.media.totalEpisodes >= 0.80;
          });

        const watchedIds = new Set(watchedFromHistory.map((g) => g.media_id));

        const watchedFromLikes: WatchedGroup[] = lks
          .filter((l) => !watchedIds.has(l.media_id))
          .map((l) => ({
            media_id: l.media_id,
            watched_count: 0,
            last_watched: l.liked_at,
            content_tag: resolveTag(l.content_tag, l.media_id),
            media: mediaMap.get(l.media_id) ?? {
              id: l.media_id,
              type: (resolveTag(l.content_tag, l.media_id) === "tv" ? "series" : "anime") as Media["type"],
              title: l.title,
              poster: l.poster ?? "",
              synopsis: "",
              genres: [],
              cast: [],
            },
          }));

        const resolvedWatched = [...watchedFromHistory, ...watchedFromLikes];
        setWatched(resolvedWatched);
        setWatchedLoading(false);

        // Build poster and banner maps from the same batch — no extra round-trip.
        // posterMap has the authoritative portrait (og:image from the detail page).
        // bannerMap has the landscape backdrop (for hero/wide contexts only).
        const newBannerMap = new Map<string, string>();
        const newPosterMap = new Map<string, string>();
        for (const m of medias) {
          if (m.banner) newBannerMap.set(m.id, m.banner);
          if (m.poster) newPosterMap.set(m.id, m.poster);
        }
        setBannerMap(newBannerMap);
        setPosterMap(newPosterMap);

        // Cache resolved state for instant render on next visit
        lcSet<LibraryCache>(
          cacheKey,
          {
            favorites: favs,
            likes: lks,
            favSeries: favSeriesRows as LibraryCache["favSeries"],
            history: resolvedHistory,
            watched: resolvedWatched,
            bannerMap: Object.fromEntries(newBannerMap),
            posterMap: Object.fromEntries(newPosterMap),
          },
          LIBRARY_CACHE_TTL
        );
      })
      .catch(() => {
        setHistoryLoading(false);
        setWatchedLoading(false);
      });
  }, [account?.id]);

  async function handleAudioFilter(next: AudioFilter) {
    setAudioFilter(next);
    if (next !== "all" && dubIds === null && !dubChecking) {
      setDubChecking(true);
      const allIds = [
        ...new Set([
          ...favorites.map((f) => f.media_id),
          ...likes.map((l) => l.media_id),
          ...history.map((h) => h.media_id),
        ]),
      ];
      const result = await api.torrent
        .dubAvailableBatch(allIds)
        .catch(() => ({} as Record<string, boolean>));
      setDubIds(new Set(Object.entries(result).filter(([, ok]) => ok).map(([id]) => id)));
      setDubChecking(false);
    }
  }

  async function removeFavorite(mediaId: string) {
    await api.library.removeFavorite(mediaId);
    setFavorites((f) => f.filter((x) => x.media_id !== mediaId));
  }

  async function removeHistoryEntry(mediaId: string) {
    await api.library.removeHistory(mediaId);
    setHistory((h) => h.filter((g) => g.media_id !== mediaId));
  }

  function applyAudioFilter<T extends { media_id: string }>(items: T[]): T[] {
    if (audioFilter === "dub" && dubIds && !dubChecking) return items.filter((i) => dubIds.has(i.media_id));
    return items;
  }

  const activeTag = mode === "tv" ? "tv" : "anime";

  function applyModeFilter<T extends { media_id: string; content_tag?: string }>(items: T[]): T[] {
    return items.filter((i) => resolveTag(i.content_tag, i.media_id) === activeTag);
  }

  const filteredFavorites = applyAudioFilter(applyModeFilter(favorites));
  const filteredLikes = applyAudioFilter(applyModeFilter(likes));
  const filteredHistory = applyAudioFilter(
    history.filter((g) => resolveTag(g.entry.content_tag, g.media_id) === activeTag)
  );
  const filteredWatched = watched.filter((g) => g.content_tag === activeTag);
  const filteredFavSeries = applyModeFilter(
    favSeries.map((f) => ({ ...f, content_tag: resolveTag((f as { content_tag?: string }).content_tag, f.media_id) }))
  );

  // Library search applies to every list, including the Overview shelves.
  const query = libraryQuery.trim().toLowerCase();
  const matchesQuery = (title: string | undefined) => !query || (title ?? "").toLowerCase().includes(query);

  const toWatchItems = sortItems(
    filteredFavorites.filter((f) => matchesQuery(f.title)),
    sortKey, (f) => f.title, (f) => f.added_at,
  );
  const likedAll = filteredLikes.filter((l) => matchesQuery(l.title));
  const likedItems = sortItems(
    starFilter === null ? likedAll : likedAll.filter((l) => l.rating === starFilter),
    sortKey, (l) => l.title, (l) => l.liked_at, (l) => l.rating,
  );
  const continueItems = sortItems(
    filteredHistory.filter((g) => matchesQuery(g.media?.title)),
    sortKey, (g) => g.media?.title ?? "", (g) => g.entry.last_watched,
  );
  const watchedItems = sortItems(
    filteredWatched.filter((g) => matchesQuery(g.media?.title)),
    sortKey, (g) => g.media?.title ?? "", (g) => g.last_watched,
  );
  // Favourites keep the order they were added in; it doubles as the Top 10 ranking.
  const favItems = filteredFavSeries.filter((f) => matchesQuery(f.title));

  const avgRating = filteredLikes.length > 0
    ? filteredLikes.reduce((sum, l) => sum + l.rating, 0) / filteredLikes.length
    : null;
  const starCounts = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: likedAll.filter((l) => l.rating === n).length }));
  const heroPosters = [...filteredHistory.map((g) => g.media?.poster), ...filteredFavorites.map((f) => posterMap.get(f.media_id) ?? f.poster)]
    .filter((p): p is string => !!p)
    .slice(0, HERO_POSTER_COUNT);

  const TABS: { id: Tab; label: string; icon: React.ReactNode; count?: string }[] = [
    { id: "overview", label: "Overview", icon: <LayoutGrid size={15} /> },
    { id: "favorites", label: "To Watch", icon: <BookMarked size={15} />, count: String(filteredFavorites.length) },
    { id: "history", label: "Continue", icon: <History size={15} />, count: String(filteredHistory.length) },
    { id: "liked", label: "Liked", icon: <Star size={15} />, count: String(filteredLikes.length) },
    { id: "watched", label: "Watched", icon: <Eye size={15} />, count: String(filteredWatched.length) },
    { id: "fav-series", label: "Favourites", icon: <Heart size={15} />, count: `${filteredFavSeries.length}/${MAX_FAV_SERIES}` },
  ];

  const otherTag = mode === "tv" ? "anime" : "tv";
  const hiddenCount = favorites.filter((i) => resolveTag(i.content_tag, i.media_id) === otherTag).length;
  const isFiltered = audioFilter !== "all" || !!query;
  const pad = isMobile ? 16 : 32;

  const starChips = (
    <div role="group" aria-label="Filter by your rating" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="star-chip" aria-pressed={starFilter === null} onClick={() => setStarFilter(null)}>All</button>
      {starCounts.filter((s) => s.count > 0).map((s) => (
        <button key={s.stars} className="star-chip" aria-pressed={starFilter === s.stars} onClick={() => setStarFilter(s.stars)} aria-label={`${s.stars} stars, ${s.count} titles`}>
          {"★".repeat(s.stars)} · {s.count}
        </button>
      ))}
    </div>
  );

  const removeFavSeries = async (mediaId: string) => {
    await api.library.removeFavoriteSeries(mediaId).catch((err: unknown) => console.error("[library] removing favourite failed:", err));
    setFavSeries((prev) => prev.filter((x) => x.media_id !== mediaId));
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: `8px ${pad}px 88px` }}>
      {/* Profile banner */}
      <section className="lib-hero" aria-label="Library overview">
        {heroPosters.length > 0 && (
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", opacity: 0.22 }}>
            {heroPosters.map((p, i) => <img key={i} src={p} alt="" style={{ height: "100%", flex: 1, minWidth: 0, objectFit: "cover" }} />)}
          </div>
        )}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, var(--bg) 30%, var(--glass-strong) 60%, var(--glass))" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 16 : 24, minWidth: 0 }}>
          <div style={{
            width: isMobile ? 64 : 88, height: isMobile ? 64 : 88, borderRadius: 18, flexShrink: 0,
            background: account ? `linear-gradient(135deg, ${account.color}, ${account.color}88)` : "var(--accent)",
            display: "grid", placeItems: "center", fontSize: isMobile ? 28 : 40, fontWeight: 900,
            boxShadow: "0 12px 30px var(--accent-glow)",
          }}>
            {account?.initial ?? "?"}
          </div>
          <div style={{ minWidth: 0 }}>
            <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "var(--accent-hi)" }}>YOUR LIBRARY</p>
            <h1 style={{ margin: "4px 0 0", fontSize: isMobile ? 26 : 40, fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1, textTransform: "uppercase" }}>
              {account?.name}'s <span style={{ color: "var(--accent)" }}>collection.</span>
            </h1>
            {hiddenCount > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
                {hiddenCount} item{hiddenCount !== 1 ? "s" : ""} hidden — switch to {mode === "tv" ? "Anime" : "TV Series"} to see them
              </p>
            )}
          </div>
        </div>
        <dl className="lib-stats">
          <Stat label="WATCHING" value={String(filteredHistory.length)} />
          <Stat label="TO WATCH" value={String(filteredFavorites.length)} />
          <Stat label="COMPLETED" value={String(filteredWatched.length)} />
          <Stat label="AVG RATING" value={avgRating !== null ? avgRating.toFixed(1) : "—"} suffix={avgRating !== null ? "/5" : undefined} isRating />
        </dl>
      </section>

      {/* Tabs + library search + audio */}
      <div className="lib-tabrow">
        <div role="tablist" aria-label="Library sections" style={{ display: "flex", gap: 10 }}>
          {TABS.map((t, i) => (
            <React.Fragment key={t.id}>
              {i === 1 && <span aria-hidden="true" style={{ width: 2, alignSelf: "stretch", background: "var(--line)", margin: "0 2px" }} />}
              <button
                role="tab"
                aria-selected={tab === t.id}
                className="tab-slant"
                onClick={() => setTab(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 14px", whiteSpace: "nowrap", fontSize: 12 }}
              >
                {t.icon} {t.label}
                {t.count !== undefined && <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{t.count}</span>}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, width: isMobile ? "100%" : undefined }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, flex: isMobile ? 1 : undefined, minWidth: 0, width: isMobile ? undefined : 180, padding: "0 12px", borderRadius: 8, background: "var(--surf)", border: "1px solid var(--line)" }}>
            <Search size={14} color="var(--dim)" aria-hidden="true" />
            <input
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              placeholder="Search your library…"
              aria-label="Search your library"
              style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}
            />
          </label>
          {mode === "anime" && (
            <div role="group" aria-label="Audio" className="seg-group">
              {(["all", "sub", "dub"] as const).map((val) => (
                <button
                  key={val}
                  className="seg-btn"
                  aria-pressed={audioFilter === val}
                  onClick={() => handleAudioFilter(val)}
                  disabled={dubChecking && val !== "all"}
                  style={{ letterSpacing: 0.6, opacity: dubChecking && val !== "all" ? 0.4 : 1 }}
                >
                  {val.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {dubChecking && <span className="mono" style={{ color: "var(--dim)", fontSize: 10, letterSpacing: 1 }}>CHECKING…</span>}
        </div>
      </div>

      {tab === "overview" ? (
        <>
          {continueItems.length > 0 && (
            <Shelf title="Continue Watching" count={String(continueItems.length)} onSeeAll={() => setTab("history")}>
              {continueItems.map((g) => (
                <LibraryContinueCard key={g.media_id} group={g} banner={bannerMap.get(g.media_id)} onRemove={() => removeHistoryEntry(g.media_id)} />
              ))}
            </Shelf>
          )}
          {favItems.length > 0 && (
            <Shelf title="Your Top 10" count={`FAVOURITES · ${filteredFavSeries.length}/${MAX_FAV_SERIES}`} onSeeAll={() => setTab("fav-series")}>
              {favItems.map((f, i) => (
                <TopTenCard key={f.media_id} rank={i + 1} mediaId={f.media_id} title={f.title} poster={posterMap.get(f.media_id) || f.poster} />
              ))}
            </Shelf>
          )}
          {toWatchItems.length > 0 && (
            <Shelf title="To Watch" count={String(toWatchItems.length)} onSeeAll={() => setTab("favorites")}>
              {toWatchItems.map((f) => (
                <LibraryPosterCard
                  key={f.media_id}
                  mediaId={f.media_id}
                  title={f.title}
                  poster={posterMap.get(f.media_id) || f.poster}
                  onRemove={() => removeFavorite(f.media_id)}
                  removeLabel="Remove from to watch list"
                />
              ))}
            </Shelf>
          )}
          {likedAll.length > 0 && (
            <Shelf title="Liked" count={String(likedAll.length)} onSeeAll={() => setTab("liked")} extra={starChips}>
              {likedItems.map((l) => (
                <LibraryPosterCard key={l.media_id} mediaId={l.media_id} title={l.title} poster={posterMap.get(l.media_id) || l.poster} badge={<StarsBadge rating={l.rating} />} />
              ))}
            </Shelf>
          )}
          {watchedItems.length > 0 && (
            <Shelf title="Watched" count={String(watchedItems.length)} onSeeAll={() => setTab("watched")}>
              {watchedItems.map((g) => <WatchedPoster key={g.media_id} group={g} />)}
            </Shelf>
          )}
          {!historyLoading && !watchedLoading && continueItems.length + favItems.length + toWatchItems.length + likedAll.length + watchedItems.length === 0 && (
            <EmptyState hasItems={favorites.length + likes.length + history.length > 0} filtered={isFiltered} baseMessage="Your library is empty — add shows to To Watch or start watching to fill it." />
          )}
        </>
      ) : (
        <section aria-labelledby="lib-section-title">
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
            <h2 id="lib-section-title" className="section-title" style={{ margin: 0 }}>{TABS.find((t) => t.id === tab)?.label}</h2>
            {tab === "liked" && starChips}
            {tab !== "fav-series" && (
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 12px", borderRadius: 8, background: "var(--surf)", border: "1px solid var(--line)", fontSize: 12.5, color: "var(--muted)" }}>
                Sort:
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  style={{ background: "transparent", border: 0, outline: 0, color: "var(--text)", fontWeight: 700, fontFamily: "inherit", fontSize: 12.5 }}
                >
                  <option value="recent">Most recent</option>
                  <option value="title">Title A–Z</option>
                  {tab === "liked" && <option value="rating">Your rating</option>}
                </select>
              </label>
            )}
          </div>

          {tab === "favorites" ? (
            toWatchItems.length === 0 ? (
              <EmptyState hasItems={filteredFavorites.length > 0 || favorites.length > 0} filtered={isFiltered} baseMessage="Nothing in your to watch list yet." />
            ) : (
              <div className="card-grid lib-grid">
                {toWatchItems.map((f) => (
                  <LibraryPosterCard key={f.media_id} mediaId={f.media_id} title={f.title} poster={posterMap.get(f.media_id) || f.poster} onRemove={() => removeFavorite(f.media_id)} removeLabel="Remove from to watch list" />
                ))}
              </div>
            )
          ) : tab === "liked" ? (
            likedItems.length === 0 ? (
              <EmptyState hasItems={likes.length > 0} filtered={isFiltered || starFilter !== null} baseMessage="Nothing rated yet." />
            ) : (
              <div className="card-grid lib-grid">
                {likedItems.map((l) => (
                  <LibraryPosterCard key={l.media_id} mediaId={l.media_id} title={l.title} poster={posterMap.get(l.media_id) || l.poster} badge={<StarsBadge rating={l.rating} />} />
                ))}
              </div>
            )
          ) : tab === "history" ? (
            historyLoading ? (
              <div className="lib-wide-grid">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ aspectRatio: "16 / 10", borderRadius: 10, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
              </div>
            ) : continueItems.length === 0 ? (
              <EmptyState hasItems={history.length > 0} filtered={isFiltered} baseMessage="No watch history yet." />
            ) : (
              <div className="lib-wide-grid">
                {continueItems.map((g) => (
                  <LibraryContinueCard key={g.media_id} group={g} banner={bannerMap.get(g.media_id)} onRemove={() => removeHistoryEntry(g.media_id)} isFluid />
                ))}
              </div>
            )
          ) : tab === "watched" ? (
            watchedLoading ? (
              <div className="card-grid lib-grid">
                {Array.from({ length: 7 }).map((_, i) => <div key={i} style={{ width: CARD_W, height: CARD_H, background: "var(--surf-2)", borderRadius: 8, animation: "pulse 1.5s ease-in-out infinite" }} />)}
              </div>
            ) : watchedItems.length === 0 ? (
              <EmptyState hasItems={filteredWatched.length > 0} filtered={!!query} baseMessage="Nothing here yet — watch 80% of an episode list and it'll appear." />
            ) : (
              <div className="card-grid lib-grid">
                {watchedItems.map((g) => <WatchedPoster key={g.media_id} group={g} />)}
              </div>
            )
          ) : (
            favItems.length === 0 ? (
              <EmptyState hasItems={filteredFavSeries.length > 0} filtered={!!query} baseMessage="No favourites yet — press the heart button on any title." />
            ) : (
              <div className="card-grid lib-grid">
                {favItems.map((f, i) => (
                  <LibraryPosterCard
                    key={f.media_id}
                    mediaId={f.media_id}
                    title={f.title}
                    poster={posterMap.get(f.media_id) || f.poster}
                    badge={<span className="lib-badge" style={{ color: "var(--fav-text)" }}><Heart size={10} fill="currentColor" /> #{i + 1}</span>}
                    onRemove={() => removeFavSeries(f.media_id)}
                    removeLabel="Remove from favourites"
                  />
                ))}
              </div>
            )
          )}
        </section>
      )}
    </div>
  );
}

const CARD_W = 178;
const CARD_H = Math.round(CARD_W * (4 / 3) * 1.06);
const HERO_POSTER_COUNT = 8;
const MAX_FAV_SERIES = 10;

type SortKey = "recent" | "title" | "rating";

function sortItems<T>(items: T[], key: SortKey, title: (item: T) => string, date: (item: T) => number, rating?: (item: T) => number): T[] {
  const sorted = [...items];
  if (key === "title") sorted.sort((a, b) => title(a).localeCompare(title(b)));
  else if (key === "rating" && rating) sorted.sort((a, b) => rating(b) - rating(a) || date(b) - date(a));
  else sorted.sort((a, b) => date(b) - date(a));
  return sorted;
}

function Stat({ label, value, suffix, isRating }: { label: string; value: string; suffix?: string; isRating?: boolean }) {
  return (
    <div className="lib-stat">
      <dt style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "var(--dim)" }}>{label}</dt>
      <dd style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 900, color: isRating ? "var(--rating)" : "var(--text)" }}>
        {value}{suffix && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dim)" }}> {suffix}</span>}
      </dd>
    </div>
  );
}

function Shelf({ title, count, onSeeAll, extra, children }: { title: string; count: string; onSeeAll: () => void; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{title}</h2>
        <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{count}</span>
        {extra}
        <button onClick={onSeeAll} className="mono" style={{ marginLeft: "auto", minHeight: 36, fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "var(--accent-hi)" }}>
          SEE ALL →
        </button>
      </div>
      <div className="row-scroll" style={{ paddingTop: 4 }}>{children}</div>
    </section>
  );
}

function LibraryPosterCard({ mediaId, title, poster, badge, onRemove, removeLabel }: {
  mediaId: string; title: string; poster?: string; badge?: React.ReactNode; onRemove?: () => void; removeLabel?: string;
}) {
  return (
    <div className="lib-card" style={{ position: "relative", width: CARD_W, flexShrink: 0 }}>
      <Link to={`/title/${encodeURIComponent(mediaId)}`} className="kuro-card" style={{ display: "block" }}>
        <div className="lib-card-img kuro-card-img" style={{ position: "relative", width: CARD_W, height: CARD_H, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
          {poster
            ? <img src={poster} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
            : <AnimeCover title={title} w={CARD_W} h={CARD_H} />}
          {badge && (
            <>
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--glass-strong), transparent 35%)" }} />
              <span style={{ position: "absolute", left: 8, bottom: 8 }}>{badge}</span>
            </>
          )}
        </div>
        <div style={{ padding: "9px 2px 0", display: "flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
          <span className="clip-1" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</span>
        </div>
      </Link>
      {onRemove && (
        <button onClick={onRemove} aria-label={`${removeLabel}: ${title}`} className="lib-remove">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function StarsBadge({ rating }: { rating: number }) {
  return (
    <span className="lib-badge" aria-label={`Your rating: ${rating} of 5`} style={{ color: "var(--rating)", letterSpacing: 1 }}>
      {"★".repeat(rating)}
    </span>
  );
}

function WatchedPoster({ group: g }: { group: WatchedGroup }) {
  const title = g.media?.title ?? g.media_id;
  const pct = g.media?.totalEpisodes && g.watched_count > 0 ? Math.round((g.watched_count / g.media.totalEpisodes) * 100) : null;
  return (
    <LibraryPosterCard
      mediaId={g.media_id}
      title={title}
      poster={g.media?.poster}
      badge={<span className="lib-badge" style={{ color: "var(--seen-text)" }}><Eye size={10} /> {pct !== null ? `${Math.min(pct, 100)}%` : "WATCHED"}</span>}
    />
  );
}

function TopTenCard({ rank, mediaId, title, poster }: { rank: number; mediaId: string; title: string; poster?: string }) {
  return (
    <Link
      to={`/title/${encodeURIComponent(mediaId)}`}
      className="kuro-card"
      aria-label={`#${rank} ${title}`}
      style={{ display: "flex", alignItems: "flex-end", flexShrink: 0, height: 220, paddingLeft: 6 }}
    >
      <span aria-hidden="true" style={{
        fontSize: 200, fontWeight: 900, lineHeight: 0.74, letterSpacing: "-0.08em", marginRight: -28,
        color: "var(--bg)", WebkitTextStroke: `3px ${rank === 1 ? "var(--accent)" : "var(--line-2)"}`,
      }}>
        {rank}
      </span>
      <span className="kuro-card-img" style={{ position: "relative", width: 132, height: 192, borderRadius: 10, overflow: "hidden", boxShadow: "-10px 0 30px var(--glass-strong)" }}>
        {poster
          ? <img src={poster} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <AnimeCover title={title} w={132} h={192} />}
      </span>
    </Link>
  );
}

function LibraryContinueCard({ group: g, banner, onRemove, isFluid }: { group: HistoryGroup; banner?: string; onRemove: () => void; isFluid?: boolean }) {
  const ep = resumeEpisode(g);
  const pct = progressPercent(g.entry.progress_seconds, g.entry.duration_seconds ?? 0);
  const isNextEpisode = ep !== g.entry.episode_number;
  const minutesLeft = !isNextEpisode && g.entry.duration_seconds
    ? Math.max(Math.round((g.entry.duration_seconds - g.entry.progress_seconds) / 60), 1)
    : null;
  const title = g.media?.title ?? g.media_id;
  const art = banner ?? g.media?.banner ?? g.media?.poster;

  return (
    <div className="lib-card" style={{ position: "relative", width: isFluid ? "100%" : 320, flexShrink: 0 }}>
      <Link
        to={`/watch/${encodeURIComponent(g.media_id)}/${ep}`}
        className="kuro-card cw-card"
        aria-label={`Resume ${title}, episode ${ep}`}
        style={{ display: "block", background: "var(--surf)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}
      >
        <div className="kuro-card-img" style={{ position: "relative", aspectRatio: "16 / 8" }}>
          {art
            ? <img src={art} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <AnimeCover title={title} w={320} h={160} />}
          <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--glass-strong), transparent 60%)" }} />
          <span style={{ position: "absolute", left: 12, bottom: 10, fontSize: 12, fontWeight: 700 }}>
            EP {ep}
            {minutesLeft !== null && <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {minutesLeft}m left</span>}
            {isNextEpisode && <span style={{ color: "var(--muted)", fontWeight: 500 }}> · up next</span>}
          </span>
        </div>
        <div style={{ height: 3, background: "var(--line-2)" }}>
          <div style={{ height: "100%", width: `${isNextEpisode ? 0 : pct}%`, background: "var(--accent)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px" }}>
          <span className="clip-1" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</span>
          {g.media && toFormatLabel(g.media) && <span className="mono" style={{ fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>{toFormatLabel(g.media)}</span>}
        </div>
      </Link>
      <button onClick={onRemove} aria-label={`Remove from continue watching: ${title}`} className="lib-remove">
        <X size={13} />
      </button>
    </div>
  );
}

function EmptyState({ hasItems, filtered, baseMessage }: {
  hasItems: boolean;
  filtered: boolean;
  baseMessage: string;
}) {
  return (
    <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
      {hasItems && filtered ? "Nothing matches these filters." : baseMessage}
    </p>
  );
}
