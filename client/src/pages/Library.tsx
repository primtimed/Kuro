import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookMarked, History, Trash2, Star, Eye, Heart } from "lucide-react";
import type { FavoriteEntry, HistoryEntry, LikeEntry, Media } from "../lib/types";
import { api } from "../lib/api";
import { progressPercent } from "../lib/utils";
import { useAccount } from "../context/AccountContext";
import { useMediaMode } from "../context/MediaModeContext";
import { AnimeCover } from "../lib/procedural";
import { useIsMobile } from "../hooks/useIsMobile";
import { lcGet, lcSet } from "../lib/localCache";

function resolveTag(contentTag: string | undefined, mediaId: string): string {
  return contentTag ?? (mediaId.startsWith("tvmaze:") ? "tv" : "anime");
}

type Tab = "favorites" | "history" | "liked" | "watched" | "fav-series";
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
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "favorites";
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

  const TABS: [Tab, string, typeof BookMarked][] = [
    ["favorites", "To Watch", BookMarked],
    ["liked", "Liked", Star],
    ["history", "Continue Watching", History],
    ["watched", "Watched", Eye],
    ["fav-series", "Favourites", Heart],
  ];

  const otherTag = mode === "tv" ? "anime" : "tv";
  const hiddenCount = favorites.filter((i) => resolveTag(i.content_tag, i.media_id) === otherTag).length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "70px 16px 64px" : "80px 32px 64px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{account?.name}'s Library</h1>
        {hiddenCount > 0 && (
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            {hiddenCount} item{hiddenCount !== 1 ? "s" : ""} hidden — switch to {mode === "tv" ? "Anime" : "TV Series"} to see them
          </span>
        )}
      </div>

      {/* Tabs + audio filter */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 32, alignItems: "flex-end", overflowX: "auto", scrollbarWidth: "none" }}>
        {TABS.map(([t, label, Icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "10px 14px", fontSize: 13, fontWeight: 500,
              color: tab === t ? "var(--text)" : "var(--muted)",
              borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}

        {mode === "anime" && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, paddingBottom: 10 }}>
          {dubChecking && (
            <span className="mono" style={{ color: "var(--dim)", fontSize: 10, marginRight: 4, letterSpacing: 1 }}>checking…</span>
          )}
          {(["ALL", "SUB", "DUB"] as const).map((m) => {
            const val = m.toLowerCase() as AudioFilter;
            const active = audioFilter === val;
            return (
              <button
                key={m}
                onClick={() => handleAudioFilter(val)}
                disabled={dubChecking && val !== "all"}
                className="mono"
                style={{
                  padding: "4px 10px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 2,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--muted)",
                  opacity: dubChecking && val !== "all" ? 0.4 : 1,
                  cursor: dubChecking && val !== "all" ? "not-allowed" : "pointer",
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
        )}
      </div>

      {tab === "favorites" ? (
        filteredFavorites.length === 0 ? (
          <EmptyState hasItems={favorites.length > 0} filtered={audioFilter !== "all"} baseMessage="Nothing in your to watch list yet." />
        ) : (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
            {filteredFavorites.map((f) => (
              <FavoriteCard key={f.media_id} entry={f} batchPoster={posterMap.get(f.media_id)} onRemove={() => removeFavorite(f.media_id)} />
            ))}
          </div>
        )
      ) : tab === "liked" ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
            <div style={{ position: "relative" }}>
              <Star
                size={14}
                style={{
                  pointerEvents: "none", position: "absolute",
                  left: 10, top: "50%", transform: "translateY(-50%)",
                  color: starFilter !== null ? "var(--rating)" : "var(--dim)",
                  fill: starFilter !== null ? "var(--rating)" : "none",
                }}
              />
              <select
                value={starFilter ?? ""}
                onChange={(e) => setStarFilter(e.target.value === "" ? null : Number(e.target.value))}
                aria-label="Filter by star rating"
                style={{
                  appearance: "none" as const,
                  paddingLeft: 28, paddingRight: 28, paddingTop: 6, paddingBottom: 6,
                  borderRadius: 6, background: "var(--surf)", fontSize: 13, fontWeight: 500,
                  border: `1px solid ${starFilter !== null ? "var(--rating)" : "var(--line-2)"}`,
                  color: starFilter !== null ? "var(--rating)" : "var(--muted)",
                  cursor: "pointer", outline: "none",
                }}
              >
                <option value="">All ratings</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5 - n)}</option>
                ))}
              </select>
              <svg style={{ pointerEvents: "none", position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }} width={12} height={12} viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="var(--dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          {(() => {
            const byRating = starFilter === null ? filteredLikes : filteredLikes.filter((l) => l.rating === starFilter);
            return byRating.length === 0 ? (
              <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
                {likes.length === 0
                  ? "Nothing rated yet."
                  : audioFilter !== "all" && filteredLikes.length === 0
                  ? "No matching anime for this filter."
                  : "No items with that rating."}
              </p>
            ) : (
              <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
                {byRating.map((l) => (
                  <LikedCard key={l.media_id} entry={l} batchPoster={posterMap.get(l.media_id)} />
                ))}
              </div>
            );
          })()}
        </>
      ) : tab === "history" ? (
        historyLoading ? (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ width: CARD_W, height: CARD_H, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
            ))}
          </div>
        ) : filteredHistory.length === 0 ? (
          <EmptyState hasItems={history.length > 0} filtered={audioFilter !== "all"} baseMessage="No watch history yet." />
        ) : (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
            {filteredHistory.map((g) => (
              <ContinueWatchingCard key={g.media_id} group={g} onRemove={() => removeHistoryEntry(g.media_id)} />
            ))}
          </div>
        )
      ) : tab === "watched" ? (
        watchedLoading ? (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ width: CARD_W, height: CARD_H, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
            ))}
          </div>
        ) : filteredWatched.length === 0 ? (
          <EmptyState hasItems={false} filtered={false} baseMessage="Nothing here yet — watch 80% of an episode list and it'll appear." />
        ) : (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
            {filteredWatched.map((g) => (
              <WatchedCard key={g.media_id} group={g} />
            ))}
          </div>
        )
      ) : (
        filteredFavSeries.length === 0 ? (
          <EmptyState hasItems={false} filtered={false} baseMessage="No favourites yet — press the heart button on any title." />
        ) : (
          <>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>{filteredFavSeries.length} / 10 favourites</p>
            <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
              {filteredFavSeries.map((f) => (
                <FavSeriesCard
                  key={f.media_id}
                  entry={f}
                  batchPoster={posterMap.get(f.media_id)}
                  onRemove={async () => {
                    await api.library.removeFavoriteSeries(f.media_id).catch(() => {});
                    setFavSeries((prev) => prev.filter((x) => x.media_id !== f.media_id));
                  }}
                />
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}

const CARD_W = 178;
const CARD_H = Math.round(CARD_W * (4 / 3) * 1.06);

function FavoriteCard({ entry: f, batchPoster, onRemove }: { entry: FavoriteEntry; batchPoster?: string; onRemove: () => void }) {
  const [hovering, setHovering] = useState(false);
  const img = batchPoster || f.poster;
  return (
    <div
      style={{ position: "relative", width: CARD_W }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link to={`/title/${encodeURIComponent(f.media_id)}`} style={{ display: "block", textDecoration: "none" }}>
        <div className="lib-card-img" style={{ position: "relative", width: CARD_W, height: CARD_H, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
          {img
            ? <img src={img} alt={f.title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} loading="lazy" />
            : <AnimeCover title={f.title} w={CARD_W} h={CARD_H} />
          }
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 8, background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)" }}>
            <p className="clip-2" style={{ margin: 0, color: "var(--text)", fontSize: 12 }}>{f.title}</p>
          </div>
        </div>
      </Link>
      <button
        onClick={onRemove}
        aria-label="Remove from to watch list"
        style={{
          position: "absolute", top: 6, right: 6, padding: 6,
          background: hovering ? "rgba(239,68,68,0.75)" : "rgba(0,0,0,0.6)",
          borderRadius: 4, opacity: hovering ? 1 : 0, transition: "opacity 150ms, background 150ms",
        }}
      >
        <Trash2 size={12} color="#fff" />
      </button>
    </div>
  );
}

function LikedCard({ entry: l, batchPoster }: { entry: LikeEntry; batchPoster?: string }) {
  const img = batchPoster || l.poster;
  return (
    <Link to={`/title/${encodeURIComponent(l.media_id)}`} style={{ display: "block", textDecoration: "none", width: CARD_W }}>
      <div className="lib-card-img" style={{ position: "relative", width: CARD_W, height: CARD_H, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
        {img
          ? <img src={img} alt={l.title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} loading="lazy" />
          : <AnimeCover title={l.title} w={CARD_W} h={CARD_H} />
        }
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 8, background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)" }}>
          <p className="clip-2" style={{ margin: "0 0 5px", color: "var(--text)", fontSize: 12 }}>{l.title}</p>
          <div style={{ display: "flex", gap: 2 }}>
            {Array.from({ length: l.rating }).map((_, i) => (
              <Star key={i} size={10} color="var(--rating)" fill="var(--rating)" />
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

function FavSeriesCard({ entry: f, batchPoster, onRemove }: { entry: { media_id: string; title: string; poster?: string; added_at: number }; batchPoster?: string; onRemove: () => void }) {
  const [hovering, setHovering] = useState(false);
  const img = batchPoster || f.poster;
  return (
    <div
      style={{ position: "relative", width: CARD_W }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link to={`/title/${encodeURIComponent(f.media_id)}`} style={{ display: "block", textDecoration: "none" }}>
        <div className="lib-card-img" style={{ position: "relative", width: CARD_W, height: CARD_H, borderRadius: 6, overflow: "hidden", border: "1px solid var(--fav-border)" }}>
          {img
            ? <img src={img} alt={f.title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} loading="lazy" />
            : <AnimeCover title={f.title} w={CARD_W} h={CARD_H} />
          }
          <div style={{ position: "absolute", top: 8, left: 8 }}>
            <Heart size={12} fill="var(--fav)" color="var(--fav)" />
          </div>
        </div>
        <div style={{ padding: "8px 2px 0" }}>
          <div className="clip-1" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>{f.title}</div>
        </div>
      </Link>
      <button
        onClick={onRemove}
        aria-label="Remove from favourites"
        style={{
          position: "absolute", top: 6, right: 6, padding: 6,
          background: hovering ? "rgba(239,68,68,0.75)" : "rgba(0,0,0,0.6)",
          borderRadius: 4, opacity: hovering ? 1 : 0, transition: "opacity 150ms, background 150ms",
        }}
      >
        <Trash2 size={12} color="#fff" />
      </button>
    </div>
  );
}

function ContinueWatchingCard({ group: g, onRemove }: { group: HistoryGroup; onRemove: () => void }) {
  const [hovering, setHovering] = useState(false);
  const ep = resumeEpisode(g);
  const pct = progressPercent(g.entry.progress_seconds, g.entry.duration_seconds ?? 0);
  const title = g.media?.title ?? g.media_id;

  return (
    <div
      style={{ position: "relative", width: CARD_W, flexShrink: 0 }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link to={`/watch/${encodeURIComponent(g.media_id)}/${ep}`} style={{ display: "block", textDecoration: "none" }}>
        <div className="lib-card-img" style={{ position: "relative", width: CARD_W, height: CARD_H, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
          {g.media?.poster ? (
            <img src={g.media.poster} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} loading="lazy" />
          ) : (
            <AnimeCover title={title} w={CARD_W} h={CARD_H} />
          )}
          <div className="mono" style={{
            position: "absolute", top: 8, left: 8,
            fontSize: 9, padding: "2px 6px", borderRadius: 3,
            background: "rgba(0,0,0,0.82)", border: "1px solid rgba(255,255,255,0.15)",
            color: "#fff", fontWeight: 700, letterSpacing: 0.5,
          }}>EP {ep}</div>
          {pct > 0 && pct < 95 && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.18)" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          )}
        </div>
        <div style={{ padding: "8px 2px 0" }}>
          <div className="clip-1" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>{title}</div>
        </div>
      </Link>
      <button
        onClick={onRemove}
        aria-label="Remove from continue watching"
        style={{
          position: "absolute", top: 6, right: 6, padding: 6,
          background: hovering ? "rgba(239,68,68,0.75)" : "rgba(0,0,0,0.6)",
          borderRadius: 4, opacity: hovering ? 1 : 0, transition: "opacity 150ms, background 150ms",
        }}
      >
        <Trash2 size={12} color="#fff" />
      </button>
    </div>
  );
}

function WatchedCard({ group: g }: { group: WatchedGroup }) {
  const title = g.media?.title ?? g.media_id;
  const pct = g.media?.totalEpisodes ? Math.round((g.watched_count / g.media.totalEpisodes) * 100) : null;

  return (
    <div style={{ width: CARD_W, flexShrink: 0 }}>
      <Link to={`/title/${encodeURIComponent(g.media_id)}`} style={{ display: "block", textDecoration: "none" }}>
        <div className="lib-card-img" style={{ position: "relative", width: CARD_W, height: CARD_H, borderRadius: 6, overflow: "hidden", border: "1px solid var(--seen-border)" }}>
          {g.media?.poster ? (
            <img src={g.media.poster} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} loading="lazy" />
          ) : (
            <AnimeCover title={title} w={CARD_W} h={CARD_H} />
          )}
          <div className="mono" style={{
            position: "absolute", top: 8, left: 8,
            fontSize: 9, padding: "2px 6px", borderRadius: 3,
            background: "var(--seen-soft)", border: "1px solid var(--seen-border)",
            color: "var(--seen-text)", fontWeight: 700, letterSpacing: 0.5,
            display: "flex", alignItems: "center", gap: 3,
          }}>
            <Eye size={8} strokeWidth={2.5} /> {pct != null ? `${pct}%` : "WATCHED"}
          </div>
        </div>
        <div style={{ padding: "8px 2px 0" }}>
          <div className="clip-1" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>{title}</div>
        </div>
      </Link>
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
      {hasItems && filtered ? "No matching anime for this filter." : baseMessage}
    </p>
  );
}
