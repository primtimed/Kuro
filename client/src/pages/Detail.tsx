import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Plus, Check, ChevronLeft, Star, Eye, EyeOff, Heart } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useMedia, useEpisodes } from "../hooks/useMedia";
import { EpisodeList } from "../components/EpisodeList";
import { TrailerBackdrop } from "../components/TrailerBackdrop";
import { Card, CardSkeleton } from "../components/Card";
import { api } from "../lib/api";
import type { HistoryEntry, EpisodeAvail, Media } from "../lib/types";
import { AnimeCover, CastPortrait, EpisodeThumbnail } from "../lib/procedural";
import { toFormatLabel } from "../lib/utils";
import { useLibrary } from "../context/LibraryContext";
import { lcGet, lcSet } from "../lib/localCache";

type Tab = "overview" | "episodes" | "cast" | "related";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "episodes", label: "Episodes" },
  { id: "cast", label: "Characters" },
  { id: "related", label: "Related" },
];

const RELATION_LABELS: Record<string, string> = {
  PREQUEL: "PREQUEL",
  SEQUEL: "SEQUEL",
  SIDE_STORY: "SIDE STORY",
  SPIN_OFF: "SPIN-OFF",
  ALTERNATIVE: "ALT VERSION",
};

const UP_NEXT_COUNT = 3;
const CAST_PREVIEW_COUNT = 8;
// Roughly four lines at the column width; shorter synopses never get a "Read more".
const SYNOPSIS_CLAMP_CHARS = 420;

export function Detail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { media, loading, error } = useMedia(id ? decodeURIComponent(id) : undefined);
  const { episodes, loading: epsLoading } = useEpisodes(id ? decodeURIComponent(id) : undefined);
  const [tab, setTab] = useState<Tab>("overview");
  const [favorited, setFavorited] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [likeRating, setLikeRating] = useState<number | null>(null);
  const [showRatingPicker, setShowRatingPicker] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);
  const ratingPickerRef = useRef<HTMLDivElement>(null);
  const [progressMap, setProgressMap] = useState<Record<number, { progress: number; duration: number }>>({});
  const [availabilityMap, setAvailabilityMap] = useState<Record<number, EpisodeAvail>>(
    () => (id ? lcGet<Record<number, EpisodeAvail>>(`avail:${decodeURIComponent(id)}`) ?? {} : {})
  );
  const [hoveredEpThumb, setHoveredEpThumb] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Media[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [relations, setRelations] = useState<{ relationType: string; media: Media }[]>([]);
  const [showWatchedConfirm, setShowWatchedConfirm] = useState(false);
  const [isManuallyWatched, setIsManuallyWatched] = useState(false);
  const [togglingWatched, setTogglingWatched] = useState(false);
  const [isFavSeries, setIsFavSeries] = useState(false);
  const [favSeriesList, setFavSeriesList] = useState<{ media_id: string; title: string; poster?: string }[]>([]);
  const [showFavSeriesModal, setShowFavSeriesModal] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState(0);
  const [isSynopsisOpen, setIsSynopsisOpen] = useState(false);

  const { watchedIds } = useLibrary();
  const decodedId = id ? decodeURIComponent(id) : "";

  useEffect(() => {
    if (!decodedId) return;
    api.getAvailability(decodedId).then((r) => {
      lcSet(`avail:${decodedId}`, r.episodes, 6 * 60 * 60 * 1000);
      setAvailabilityMap(r.episodes);
    }).catch(() => {});
    api.library.isFavorited(decodedId).then(({ favorited: f }) => setFavorited(f)).catch(() => {});
    api.library.isManuallyWatched(decodedId).then(({ watched: w }) => setIsManuallyWatched(w)).catch(() => {});
    api.library.isFavoriteSeries(decodedId).then(({ isFavSeries: f }) => setIsFavSeries(f)).catch(() => {});
    api.library.favoriteSeries().then(setFavSeriesList).catch(() => {});
    api.library.isLiked(decodedId).then(({ rating }) => setLikeRating(rating)).catch(() => {});
    api.library.getProgress(decodedId).then((entries: HistoryEntry[]) => {
      const map: Record<number, { progress: number; duration: number }> = {};
      entries.forEach((e) => { map[e.episode_number] = { progress: e.progress_seconds, duration: e.duration_seconds ?? 0 }; });
      setProgressMap(map);
    }).catch(() => {});
  }, [decodedId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ratingPickerRef.current && !ratingPickerRef.current.contains(e.target as Node)) {
        setShowRatingPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showRatingPicker) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowRatingPicker(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showRatingPicker]);

  useEffect(() => {
    if (!media) return;
    setSimilarLoading(true);
    const similarFn = media.type === "series"
      ? () => api.tv.getSimilar(media.id)
      : () => api.getSimilar(media.id);
    similarFn()
      .then(setSimilar)
      .catch(() => {})
      .finally(() => setSimilarLoading(false));
    api.getRelations(media.id).then(setRelations).catch(() => {});
  }, [media?.id]);

  async function toggleFavSeries() {
    if (!media) return;
    if (isFavSeries) {
      await api.library.removeFavoriteSeries(media.id).catch(() => {});
      setIsFavSeries(false);
      setFavSeriesList((prev) => prev.filter((f) => f.media_id !== media.id));
    } else if (favSeriesList.length >= 10) {
      setShowFavSeriesModal(true);
    } else {
      await api.library.addFavoriteSeries({ media_id: media.id, title: media.title, poster: media.poster }).catch(() => {});
      setIsFavSeries(true);
      setFavSeriesList((prev) => [{ media_id: media.id, title: media.title, poster: media.poster }, ...prev]);
    }
  }

  async function replaceFavSeries(removeId: string) {
    if (!media) return;
    await api.library.removeFavoriteSeries(removeId).catch(() => {});
    await api.library.addFavoriteSeries({ media_id: media.id, title: media.title, poster: media.poster }).catch(() => {});
    setIsFavSeries(true);
    setFavSeriesList((prev) => [
      { media_id: media.id, title: media.title, poster: media.poster },
      ...prev.filter((f) => f.media_id !== removeId),
    ]);
    setShowFavSeriesModal(false);
  }

  const watchedEpCount = Object.values(progressMap).filter((p) => p.duration > 0 && p.progress / p.duration >= 0.90).length;
  const isWatched = watchedIds.has(decodedId) || isManuallyWatched || likeRating !== null || (!!media?.totalEpisodes && watchedEpCount / media.totalEpisodes >= 0.80);

  async function toggleManuallyWatched() {
    if (!media || togglingWatched) return;
    setTogglingWatched(true);
    try {
      if (isManuallyWatched) {
        await api.library.unmarkWatched(media.id);
        setIsManuallyWatched(false);
      } else {
        await api.library.markWatched({ media_id: media.id, title: media.title, poster: media.poster });
        setIsManuallyWatched(true);
        // Remove from To Watch when marking as watched
        if (favorited) {
          await api.library.removeFavorite(media.id).catch(() => {});
          setFavorited(false);
        }
      }
    } finally {
      setTogglingWatched(false);
    }
  }

  async function doAddFavorite() {
    if (!media) return;
    setToggling(true);
    try {
      await api.library.addFavorite({ media_id: media.id, type: media.type, title: media.title, poster: media.poster });
      setFavorited(true);
    } finally {
      setToggling(false);
    }
  }

  async function toggleFavorite() {
    if (!media || toggling) return;
    if (favorited) {
      setToggling(true);
      try {
        await api.library.removeFavorite(media.id);
        setFavorited(false);
      } finally {
        setToggling(false);
      }
    } else if (isWatched) {
      setShowWatchedConfirm(true);
    } else {
      await doAddFavorite();
    }
  }

  async function handleToggleWatched(epNumber: number, currentlyWatched: boolean) {
    if (!media) return;
    const existing = progressMap[epNumber];
    const dur = existing?.duration ?? 1440;
    const progress = currentlyWatched ? 0 : Math.ceil(dur * 0.96);
    await api.library.saveProgress({ media_id: media.id, episode_number: epNumber, progress_seconds: progress, duration_seconds: dur }).catch(() => {});
    setProgressMap((prev) => ({ ...prev, [epNumber]: { progress, duration: dur } }));
  }

  async function handleLike(stars: number) {
    if (!media) return;
    await api.library.addLike({ media_id: media.id, rating: stars, title: media.title, poster: media.poster }).catch(() => {});
    setLikeRating(stars);
    setShowRatingPicker(false);
    // Liking means you've watched it — remove from favorites automatically
    if (favorited) {
      await api.library.removeFavorite(media.id).catch(() => {});
      setFavorited(false);
    }
  }

  async function handleUnlike() {
    if (!media) return;
    await api.library.removeLike(media.id).catch(() => {});
    setLikeRating(null);
    setShowRatingPicker(false);
  }

  function getStartEpisode(): number {
    const entries = Object.entries(progressMap);
    if (entries.length === 0) return 1;
    // Prefer the highest-numbered episode that's started but not finished
    const inProgress = entries
      .filter(([, p]) => p.progress > 0 && (p.duration === 0 || p.progress / p.duration < 0.9))
      .map(([ep]) => parseInt(ep));
    if (inProgress.length > 0) return Math.max(...inProgress);
    // All watched — suggest the next episode after the highest completed one
    const completed = entries
      .filter(([, p]) => p.duration > 0 && p.progress / p.duration >= 0.9)
      .map(([ep]) => parseInt(ep));
    if (completed.length > 0) return Math.max(...completed) + 1;
    return 1;
  }

  if (loading) return <DetailSkeleton />;
  if (error || !media) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--muted)" }}>{error ?? "Not found"}</p>
      </div>
    );
  }

  const bannerHeight = isMobile ? 300 : 520;
  const hasProgress = Object.keys(progressMap).length > 0;
  const startEpisode = getStartEpisode();
  const hasSub = Object.values(availabilityMap).some((a) => a.hasSub);
  const hasDub = Object.values(availabilityMap).some((a) => a.hasDub);
  const startIndex = Math.max(episodes.findIndex((e) => e.number === startEpisode), 0);
  const upNext = episodes.slice(startIndex, startIndex + UP_NEXT_COUNT);
  const unwatchedSimilar = similar.filter((m) => !watchedIds.has(m.id));
  const byYear = (a: { media: Media }, b: { media: Media }) => (a.media.year ?? 9999) - (b.media.year ?? 9999);
  // AniList can list the same entry twice (or the title itself), which would duplicate timeline nodes.
  const seasonRelations = relations.filter((r, i) => r.media.id !== media.id && relations.findIndex((o) => o.media.id === r.media.id) === i);
  const seasonChain = [
    ...seasonRelations.filter((r) => r.relationType === "PREQUEL").sort(byYear).map((r) => ({ ...r, isCurrent: false })),
    { relationType: "CURRENT", media, isCurrent: true },
    ...seasonRelations.filter((r) => r.relationType === "SEQUEL").sort(byYear).map((r) => ({ ...r, isCurrent: false })),
  ];

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "var(--bg)" }}>
      {showFavSeriesModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fav-series-title"
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowFavSeriesModal(false); }}
        >
          <div style={{
            background: "var(--surf-2)", border: "1px solid var(--line-2)",
            borderRadius: 10, padding: 28, maxWidth: 520, width: "90%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <p id="fav-series-title" style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>Favourite Series Full</p>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--muted)" }}>
              You have 10 favourites. Tap one to replace it with <strong style={{ color: "var(--text)" }}>{media.title}</strong>.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
              {favSeriesList.map((f) => (
                <button
                  key={f.media_id}
                  onClick={() => replaceFavSeries(f.media_id)}
                  title={`Replace with ${f.title}`}
                  style={{
                    padding: 0, border: "2px solid var(--line-2)", borderRadius: 6,
                    overflow: "hidden", cursor: "pointer", background: "var(--surf)",
                    transition: "border-color 150ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line-2)")}
                >
                  {f.poster
                    ? <img src={f.poster} alt={f.title} style={{ width: "100%", aspectRatio: "2/3", objectFit: "cover", display: "block" }} />
                    : <div style={{ width: "100%", aspectRatio: "2/3", background: "var(--surf-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 9, color: "var(--dim)", padding: 4, textAlign: "center" }}>{f.title}</span>
                      </div>
                  }
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowFavSeriesModal(false)}
                style={{
                  padding: "9px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: "var(--surf)", border: "1px solid var(--line-2)", color: "var(--muted)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {showWatchedConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="watched-confirm-title"
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowWatchedConfirm(false); }}
        >
          <div style={{
            background: "var(--surf-2)", border: "1px solid var(--line-2)",
            borderRadius: 10, padding: 28, maxWidth: 380, width: "90%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <p id="watched-confirm-title" style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>Already Watched</p>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--muted)", lineHeight: 1.55 }}>
              <strong style={{ color: "var(--text)" }}>{media.title}</strong> is in your watched list. Add it to your to watch list anyway?
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowWatchedConfirm(false)}
                style={{
                  padding: "9px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: "var(--surf)", border: "1px solid var(--line-2)", color: "var(--muted)", cursor: "pointer",
                }}
              >
                No
              </button>
              <button
                onClick={() => { setShowWatchedConfirm(false); doAddFavorite(); }}
                style={{
                  padding: "9px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: "var(--accent)", border: "none", color: "#fff", cursor: "pointer",
                }}
              >
                Yes, add it
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Faint banner (and trailer, after a few seconds) behind the header area */}
      <div aria-hidden="true" style={{
        position: "absolute", top: 0, left: 0, right: 0, height: bannerHeight,
        opacity: 0.35, overflow: "hidden", pointerEvents: "none",
      }}>
        <TrailerBackdrop
          banner={media.banner ?? media.poster}
          trailer={media.trailer}
          title={media.title}
          height={bannerHeight}
          overrideSrc={(tab === "episodes" && hoveredEpThumb) ? hoveredEpThumb : undefined}
        />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--bg) 5%, transparent 70%)" }} />
      </div>

      <div className="detail-layout">
        {/* Left column: poster, actions, facts */}
        <aside className="detail-aside" aria-label="Actions and details">
          <div style={{
            width: "100%", aspectRatio: "300 / 430", borderRadius: 12, overflow: "hidden",
            border: "1px solid var(--glass-line)", boxShadow: "0 24px 60px var(--glass-strong)",
          }}>
            {media.poster
              ? <img src={media.poster} alt={media.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <AnimeCover title={media.title} w={300} h={430} />}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <button
              data-tv-autofocus
              className="btn-slant btn-slant--primary"
              onClick={() => navigate(`/watch/${encodeURIComponent(media.id)}/${startEpisode}`)}
              style={{ justifyContent: "center", width: "100%" }}
            >
              <Play size={14} fill="currentColor" /> {hasProgress ? `Resume EP ${startEpisode}` : "Watch now"}
            </button>
            <button
              className="btn-slant btn-slant--ghost"
              onClick={toggleFavorite}
              disabled={toggling}
              aria-pressed={favorited}
              style={{ justifyContent: "center", width: "100%", color: favorited ? "var(--accent-hi)" : undefined }}
            >
              {favorited ? <Check size={15} /> : <Plus size={15} />} {favorited ? "In To Watch" : "To Watch"}
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 4 }}>
              <button
                className="action-tile"
                onClick={toggleFavSeries}
                aria-pressed={isFavSeries}
                title={isFavSeries ? "Remove from favourite series" : "Add to favourite series (max 10)"}
                style={isFavSeries ? { color: "var(--fav-text)", borderColor: "var(--fav-border)", background: "var(--fav-soft)" } : undefined}
              >
                <Heart size={17} fill={isFavSeries ? "currentColor" : "none"} /> Favourite
              </button>
              <button
                className="action-tile"
                onClick={toggleManuallyWatched}
                disabled={togglingWatched}
                aria-pressed={isWatched}
                title={isManuallyWatched ? "Remove from watched" : "Mark as watched"}
                style={isWatched ? { color: "var(--seen-text)", borderColor: "var(--seen-border)", background: "var(--seen-soft)" } : undefined}
              >
                {isWatched ? <EyeOff size={17} /> : <Eye size={17} />} Watched
              </button>
              <div ref={ratingPickerRef} style={{ position: "relative", display: "flex" }}>
                <button
                  className="action-tile"
                  onClick={() => setShowRatingPicker((p) => !p)}
                  aria-expanded={showRatingPicker}
                  aria-label={likeRating ? `Your rating: ${likeRating} of 5` : "Rate this anime"}
                  style={{ flex: 1, ...(likeRating != null ? { color: "var(--rating)", borderColor: "var(--rating)" } : {}) }}
                >
                  <Star size={17} fill={likeRating != null ? "currentColor" : "none"} /> {likeRating != null ? `${likeRating}/5` : "Rate"}
                </button>
                {showRatingPicker && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50,
                    background: "var(--surf-2)", border: "1px solid var(--line-2)", borderRadius: 8,
                    padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
                    boxShadow: "0 8px 32px var(--glass-strong)",
                  }}>
                    <p className="mono" style={{ margin: 0, fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>RATE THIS ANIME</p>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => handleLike(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          aria-label={`Rate ${star} stars`}
                          style={{ padding: 4, transition: "transform 100ms", transform: hoverRating >= star ? "scale(1.2)" : "scale(1)" }}
                        >
                          <Star
                            size={22}
                            fill={(hoverRating || likeRating || 0) >= star ? "var(--rating)" : "none"}
                            color={(hoverRating || likeRating || 0) >= star ? "var(--rating)" : "var(--dim)"}
                          />
                        </button>
                      ))}
                    </div>
                    {likeRating != null && (
                      <button onClick={handleUnlike} className="mono" style={{ fontSize: 10, color: "var(--dim)", letterSpacing: 0.5, textAlign: "left" }}>
                        REMOVE RATING
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

        </aside>

        {/* Right column: title, synopsis, tabs */}
        <main className="detail-main" style={{ minWidth: 0 }}>
          <button onClick={() => navigate(-1)} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            <ChevronLeft size={15} /> Back
          </button>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {media.rating && <HeaderChip tone="rating">★ {media.rating.toFixed(1)}</HeaderChip>}
            {toFormatLabel(media) && <HeaderChip>{toFormatLabel(media)}</HeaderChip>}
            {media.year && <HeaderChip>{media.year}</HeaderChip>}
            {media.genres.slice(0, 4).map((g) => <HeaderChip key={g}>{g}</HeaderChip>)}
            {hasSub && <HeaderChip tone="sub">SUB</HeaderChip>}
            {hasDub && <HeaderChip tone="dub">DUB</HeaderChip>}
          </div>

          <h1 style={{
            margin: "14px 0 8px", fontSize: isMobile ? 30 : 56, fontWeight: 900, lineHeight: 0.95,
            letterSpacing: isMobile ? "-0.02em" : "-0.04em", textTransform: "uppercase",
          }}>
            {media.title}
          </h1>
          {media.altTitles?.[0] && (
            <p className="mono" style={{ margin: "0 0 16px", color: "var(--dim)", fontSize: 11, letterSpacing: 1 }}>{media.altTitles[0].toUpperCase()}</p>
          )}

          <p className={isSynopsisOpen ? undefined : "clip-4"} style={{ margin: 0, maxWidth: 860, color: "var(--hero-text)", fontSize: isMobile ? 14 : 15, lineHeight: 1.65, whiteSpace: "pre-line" }}>
            {media.synopsis || "No synopsis available."}
          </p>
          {media.synopsis.length > SYNOPSIS_CLAMP_CHARS && (
            <button onClick={() => setIsSynopsisOpen((o) => !o)} style={{ minHeight: 36, fontSize: 13, fontWeight: 700, color: "var(--accent-hi)" }}>
              {isSynopsisOpen ? "Show less" : "Read more"}
            </button>
          )}

          <div role="tablist" aria-label="Sections" style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "24px 0 26px" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className="tab-slant"
                onClick={() => setTab(t.id)}
              >
                {t.label}{t.id === "episodes" && episodes.length > 0 ? ` · ${episodes.length}` : ""}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" && (
              <>
                {upNext.length > 0 && (
                  <section style={{ marginBottom: 36 }}>
                    <h2 className="section-title">Up next</h2>
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 220 : 240}px, 1fr))`, gap: 14 }}>
                      {upNext.map((ep, i) => {
                        const prog = progressMap[ep.number];
                        const pct = prog?.duration ? Math.min(prog.progress / prog.duration, 1) * 100 : 0;
                        const isCurrent = i === 0 && hasProgress;
                        return (
                          <button
                            key={ep.number}
                            className="upnext-card"
                            onClick={() => navigate(`/watch/${encodeURIComponent(media.id)}/${ep.number}`)}
                            style={{
                              textAlign: "left", borderRadius: 10, overflow: "hidden", background: "var(--surf)",
                              border: `1px solid ${isCurrent ? "var(--accent)" : "var(--line)"}`,
                            }}
                          >
                            <div style={{ position: "relative", aspectRatio: "16 / 9" }}>
                              {ep.thumbnail
                                ? <img src={ep.thumbnail} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                : <EpisodeThumbnail title={media.title} epNum={ep.number} />}
                            </div>
                            {pct > 0 && (
                              <div style={{ height: 3, background: "var(--line-2)" }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)" }} />
                              </div>
                            )}
                            <div style={{ padding: "10px 12px" }}>
                              <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: isCurrent ? "var(--accent-hi)" : "var(--dim)" }}>
                                {isCurrent ? "CONTINUE · " : ""}EPISODE {ep.episodeInSeason ?? ep.number}
                              </span>
                              <span className="clip-1" style={{ marginTop: 4, fontSize: 13.5, fontWeight: 700 }}>{ep.title}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {seasonChain.length > 1 && (
                  <section style={{ marginBottom: 36 }}>
                    <h2 className="section-title">Seasons</h2>
                    <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", paddingBottom: 6 }}>
                      {seasonChain.map((s, i) => (
                        <React.Fragment key={s.media.id}>
                          {i > 0 && <span aria-hidden="true" style={{ width: 32, height: 2, flexShrink: 0, background: "var(--line-2)" }} />}
                          <SeasonNode
                            media={s.media}
                            label={s.isCurrent ? "YOU'RE HERE" : (RELATION_LABELS[s.relationType] ?? s.relationType)}
                            isCurrent={s.isCurrent}
                            onOpen={() => navigate(`/title/${encodeURIComponent(s.media.id)}`)}
                          />
                        </React.Fragment>
                      ))}
                    </div>
                  </section>
                )}

                {media.cast.length > 0 && (
                  <section style={{ marginBottom: 36 }}>
                    <div style={{ display: "flex", alignItems: "baseline" }}>
                      <h2 className="section-title">Characters</h2>
                      {media.cast.length > CAST_PREVIEW_COUNT && (
                        <button onClick={() => setTab("cast")} className="mono" style={{ marginLeft: "auto", minHeight: 32, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "var(--accent-hi)" }}>
                          ALL {media.cast.length} →
                        </button>
                      )}
                    </div>
                    <CharacterGrid cast={media.cast.slice(0, CAST_PREVIEW_COUNT)} />
                  </section>
                )}

                <SimilarRow items={unwatchedSimilar} loading={similarLoading} />
              </>
            )}

            {tab === "episodes" && (() => {
              // Compute unique season numbers for the dropdown
              const seasons = [...new Set(
                episodes.map((e) => e.seasonNumber).filter((s): s is number => s != null)
              )].sort((a, b) => a - b);
              const hasSeasons = seasons.length > 1;

              // Episodes to show after season filter
              const seasonFiltered = selectedSeason != null
                ? episodes.filter((e) => e.seasonNumber === selectedSeason)
                : episodes;

              // Chunk into groups of 100 when list is long
              const RANGE_SIZE = 100;
              const ranges: { label: string; episodes: typeof seasonFiltered }[] = [];
              if (seasonFiltered.length > RANGE_SIZE) {
                for (let i = 0; i < seasonFiltered.length; i += RANGE_SIZE) {
                  const chunk = seasonFiltered.slice(i, i + RANGE_SIZE);
                  const first = chunk[0].number;
                  const last = chunk[chunk.length - 1].number;
                  ranges.push({ label: `${first}–${last}`, episodes: chunk });
                }
              }
              const clampedRange = Math.min(selectedRange, Math.max(0, ranges.length - 1));
              const visibleEpisodes = ranges.length > 0 ? ranges[clampedRange].episodes : seasonFiltered;

              return epsLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ height: 80, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
                  ))}
                </div>
              ) : (
                <>
                  {(hasSeasons || ranges.length > 0) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                      {hasSeasons && (
                        <>
                          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>Season</span>
                          <div role="group" aria-label="Season" className="seg-group">
                            <button className="seg-btn" aria-pressed={selectedSeason === null} onClick={() => { setSelectedSeason(null); setSelectedRange(0); }}>
                              All
                            </button>
                            {seasons.map((s) => (
                              <button key={s} className="seg-btn" aria-pressed={selectedSeason === s} onClick={() => { setSelectedSeason(s); setSelectedRange(0); }}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      {ranges.length > 0 && (
                        <>
                          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>Episodes</span>
                          <select
                            value={clampedRange}
                            onChange={(e) => setSelectedRange(Number(e.target.value))}
                            aria-label="Episode range"
                            style={{
                              minHeight: 40, padding: "0 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                              background: "var(--surf-2)", color: "var(--muted)",
                              border: "1px solid var(--line-2)", cursor: "pointer",
                            }}
                          >
                            {ranges.map((r, i) => (
                              <option key={i} value={i}>{r.label}</option>
                            ))}
                          </select>
                        </>
                      )}
                      <span className="mono" style={{ fontSize: 10, color: "var(--dim)", marginLeft: "auto" }}>
                        {watchedEpCount} / {seasonFiltered.length} WATCHED
                      </span>
                    </div>
                  )}
                  <EpisodeList
                    mediaId={media.id}
                    mediaTitle={media.title}
                    episodes={visibleEpisodes}
                    currentEpisode={hasProgress ? startEpisode : undefined}
                    progressMap={progressMap}
                    availabilityMap={availabilityMap}
                    onEpisodeHover={setHoveredEpThumb}
                    onToggleWatched={handleToggleWatched}
                    hideSeasonsHeaders={selectedSeason !== null}
                  />
                </>
              );
            })()}

            {tab === "cast" && (
              media.cast.length === 0
                ? <p className="mono" style={{ color: "var(--dim)", fontSize: 12 }}>NO CHARACTER DATA</p>
                : <CharacterGrid cast={media.cast} />
            )}

            {tab === "related" && (
              <>
                {relations.length === 0 && !similarLoading && unwatchedSimilar.length === 0 && (
                  <p className="mono" style={{ color: "var(--dim)", fontSize: 12 }}>NOTHING RELATED FOUND</p>
                )}
                <RelationRow heading="Other seasons" items={relations.filter((r) => r.relationType === "PREQUEL" || r.relationType === "SEQUEL")} />
                <RelationRow heading="Side stories & spin-offs" items={relations.filter((r) => r.relationType === "SIDE_STORY" || r.relationType === "SPIN_OFF" || r.relationType === "ALTERNATIVE")} />
                <SimilarRow items={unwatchedSimilar} loading={similarLoading} />
              </>
            )}
          </div>
        </main>

        {/* Under the poster on desktop; after the content on phones, so the title comes first */}
        <div className="detail-extra">
          <AnimeInfoPanel media={media} />
        </div>
      </div>
    </div>
  );
}

function HeaderChip({ tone, children }: { tone?: "rating" | "sub" | "dub"; children: React.ReactNode }) {
  const tones = {
    rating: { color: "var(--rating)", background: "var(--glass-light)", border: "var(--glass-line)" },
    sub: { color: "var(--sub-badge-text)", background: "var(--sub-badge-soft)", border: "var(--sub-badge-border)" },
    dub: { color: "var(--dub-badge-text)", background: "var(--dub-badge-soft)", border: "var(--dub-badge-border)" },
  };
  const t = tone ? tones[tone] : { color: "var(--text)", background: "var(--glass-light)", border: "var(--glass-line)" };
  return (
    <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 4, color: t.color, background: t.background, border: `1px solid ${t.border}` }}>
      {children}
    </span>
  );
}

function SeasonNode({ media, label, isCurrent, onOpen }: { media: Media; label: string; isCurrent: boolean; onOpen: () => void }) {
  return (
    <button
      className="season-node"
      onClick={onOpen}
      disabled={isCurrent}
      aria-current={isCurrent ? "page" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0, maxWidth: 280,
        padding: "10px 14px 10px 10px", borderRadius: 10, textAlign: "left",
        background: isCurrent ? "linear-gradient(90deg, var(--accent-soft), var(--surf))" : "var(--surf)",
        border: `1px solid ${isCurrent ? "var(--accent)" : "var(--line)"}`,
        cursor: isCurrent ? "default" : "pointer",
      }}
    >
      <span style={{ width: 44, height: 62, borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
        {media.poster
          ? <img src={media.poster} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <AnimeCover title={media.title} w={44} h={62} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: isCurrent ? "var(--accent-hi)" : "var(--dim)" }}>{label}</span>
        <span className="clip-1" style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{media.title}</span>
        <span style={{ display: "block", fontSize: 11, color: "var(--dim)", marginTop: 2 }}>{media.year ?? "TBA"}</span>
      </span>
    </button>
  );
}

function CharacterGrid({ cast }: { cast: Media["cast"] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
      {cast.map((c) => (
        <div key={c.name} className="char-card" style={{ display: "flex", borderRadius: 10, overflow: "hidden", background: "var(--surf)", border: "1px solid var(--line)" }}>
          <span style={{ width: 64, height: 86, flexShrink: 0 }}>
            {c.image
              ? <img src={c.image} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <CastPortrait name={c.name} size={64} />}
          </span>
          <span style={{ padding: "12px 12px", minWidth: 0, alignSelf: "center" }}>
            <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: c.role === "Main" ? "var(--accent-hi)" : "var(--dim)" }}>
              {c.role.toUpperCase()}
            </span>
            <span className="clip-2" style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{c.name}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function RelationRow({ heading, items }: { heading: string; items: { relationType: string; media: Media }[] }) {
  if (items.length === 0) return null;
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 className="section-title">{heading}</h2>
      <div className="row-scroll" style={{ paddingTop: 4 }}>
        {items.map(({ relationType, media: m }) => (
          <div key={m.id} style={{ flexShrink: 0 }}>
            <Card media={m} width={148} />
            <div className="mono" style={{ marginTop: 4, fontSize: 9, color: "var(--accent-hi)", letterSpacing: 0.5 }}>
              {RELATION_LABELS[relationType] ?? relationType}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SimilarRow({ items, loading }: { items: Media[]; loading: boolean }) {
  if (!loading && items.length === 0) return null;
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 className="section-title">More like this</h2>
      <div className="row-scroll" style={{ paddingTop: 4 }}>
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} width={148} />)
          : items.map((m) => <Card key={m.id} media={m} width={148} />)}
      </div>
    </section>
  );
}

function AnimeInfoPanel({ media }: { media: Media }) {
  type Row = { label: string; content: React.ReactNode };
  const rows: Row[] = [];

  const format = toFormatLabel(media);
  if (format) rows.push({ label: "Type", content: media.duration ? `${format} · ${media.duration} min/ep` : format });
  else if (media.duration) rows.push({ label: "Duration", content: `${media.duration} min` });
  if (media.totalEpisodes) rows.push({ label: "Episodes", content: media.totalEpisodes });

  if (media.status) {
    const formatted = media.status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    rows.push({ label: "Status", content: formatted });
  }

  const airedFrom = media.airedFrom;
  const airedTo = media.airedTo;
  if (airedFrom) rows.push({ label: "Aired", content: airedTo ? `${airedFrom} → ${airedTo}` : airedFrom });
  if (media.premiered) rows.push({ label: "Premiered", content: media.premiered });
  if (media.broadcast) rows.push({ label: "Broadcast", content: media.broadcast });
  if (media.country) rows.push({ label: "Country", content: media.country });
  if (media.studios?.length) rows.push({ label: "Studios", content: media.studios.join(", ") });
  if (media.producers?.length) rows.push({ label: "Producers", content: media.producers.join(", ") });

  if (media.rating != null) {
    rows.push({
      label: "Score",
      content: (
        <>
          <span style={{ color: "var(--rating)", fontWeight: 700 }}>{media.rating.toFixed(1)}</span>
          {media.popularity ? <span style={{ color: "var(--dim)" }}> · {media.popularity.toLocaleString()} users</span> : null}
          <span style={{ display: "block", height: 4, borderRadius: 2, marginTop: 6, background: "var(--line)" }}>
            <span style={{ display: "block", height: "100%", width: `${media.rating * 10}%`, borderRadius: 2, background: "var(--rating)" }} />
          </span>
        </>
      ),
    });
  }

  const links: React.ReactNode[] = [];
  if (media.malId) {
    links.push(<a key="mal" href={`https://myanimelist.net/anime/${media.malId}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-hi)" }}>MAL</a>);
  }
  if (media.siteUrl) {
    links.push(<a key="al" href={media.siteUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent-hi)" }}>AniList</a>);
  }
  if (links.length) {
    rows.push({ label: "Links", content: links.reduce<React.ReactNode[]>((acc, l, i) => i === 0 ? [l] : [...acc, " · ", l], []) });
  }

  if (rows.length === 0) return null;

  return (
    <dl className="panel" style={{ margin: 0, display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", gap: "10px 12px", fontSize: 13 }}>
      {rows.map(({ label, content }) => (
        <React.Fragment key={label}>
          <dt style={{ color: "var(--dim)" }}>{label}</dt>
          <dd style={{ margin: 0, color: "var(--text)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{content}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function DetailSkeleton() {
  const block = (style: React.CSSProperties) => (
    <div style={{ background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite", ...style }} />
  );
  return (
    <div className="detail-layout" style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div className="detail-aside">
        {block({ width: "100%", aspectRatio: "300 / 430", borderRadius: 12 })}
        {block({ height: 46, borderRadius: 4 })}
      </div>
      <div>
        {block({ height: 24, width: 320, borderRadius: 4, marginBottom: 18 })}
        {block({ height: 56, width: "70%", borderRadius: 6, marginBottom: 16 })}
        {block({ height: 90, width: "90%", borderRadius: 4, marginBottom: 26 })}
        {block({ height: 44, width: 460, maxWidth: "100%", borderRadius: 4 })}
      </div>
    </div>
  );
}
