import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Plus, Check, ChevronLeft, Star, Eye, EyeOff, Heart, ExternalLink } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useMedia, useEpisodes } from "../hooks/useMedia";
import { EpisodeList } from "../components/EpisodeList";
import { CastCard } from "../components/CastCard";
import { TrailerBackdrop } from "../components/TrailerBackdrop";
import { Card, CardSkeleton } from "../components/Card";
import { api } from "../lib/api";
import type { HistoryEntry, EpisodeAvail, Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";
import { useLibrary } from "../context/LibraryContext";
import { lcGet, lcSet } from "../lib/localCache";

type Tab = "overview" | "episodes" | "cast";

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

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
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
      {/* Sticky back bar */}
      <div style={{
        position: "sticky", top: 0, zIndex: 60,
        background: "rgba(10,10,10,0.7)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ maxWidth: 1600, margin: "0 auto", padding: isMobile ? "12px 16px" : "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => navigate(-1)} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
            borderRadius: 6, border: "1px solid var(--line)", background: "var(--surf)", fontSize: 13, color: "var(--muted)",
          }}>
            <ChevronLeft size={14} /> Library
          </button>
        </div>
      </div>

      {/* Backdrop */}
      <TrailerBackdrop
        banner={media.banner}
        trailer={media.trailer}
        title={media.title}
        height={isMobile ? 240 : 420}
        overrideSrc={(tab === "episodes" && hoveredEpThumb) ? hoveredEpThumb : undefined}
      />

      {/* Main content */}
      <div style={{ position: "relative", zIndex: 10, maxWidth: 1600, margin: isMobile ? "-60px auto 0" : "-180px auto 0", padding: isMobile ? "0 16px 64px" : "0 32px 64px" }}>
        {/* Poster + meta row */}
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 16 : 32, marginBottom: 32, alignItems: isMobile ? "flex-start" : "flex-end" }}>
          {/* Poster */}
          <div style={{ flexShrink: 0, width: isMobile ? 110 : 180, height: isMobile ? 160 : 260, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line-2)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            {media.poster ? (
              <img src={media.poster} alt={media.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <AnimeCover title={media.title} w={isMobile ? 110 : 180} h={isMobile ? 160 : 260} />
            )}
          </div>

          {/* Meta */}
          <div style={{ paddingBottom: 4, flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {media.genres.slice(0, 5).map((g) => (
                <span key={g} className="mono" style={{
                  fontSize: 10, padding: "3px 8px", borderRadius: 999, letterSpacing: 1,
                  border: "1px solid rgba(255,255,255,0.18)", color: "#d4d4d4",
                }}>{g.toUpperCase()}</span>
              ))}
            </div>
            <h1 style={{ margin: "0 0 6px", fontSize: isMobile ? 24 : 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{media.title}</h1>
            {media.altTitles?.[0] && (
              <p className="mono" style={{ margin: "0 0 12px", color: "var(--dim)", fontSize: 11, letterSpacing: 1 }}>{media.altTitles[0].toUpperCase()}</p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
              {media.year && <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{media.year}</span>}
              {media.rating && <span style={{ color: "var(--rating)", fontWeight: 600, fontSize: 13 }}>★ {media.rating.toFixed(1)}</span>}
              {media.totalEpisodes && <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{media.totalEpisodes}EP</span>}
              {media.status && <span className="mono" style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>{media.status}</span>}
              {Object.values(availabilityMap).some((a) => a.hasSub) && (
                <span className="mono" style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: "var(--sub-badge-soft)", color: "var(--sub-badge-text)", border: "1px solid var(--sub-badge-border)", fontWeight: 700, letterSpacing: 1 }}>SUB</span>
              )}
              {Object.values(availabilityMap).some((a) => a.hasDub) && (
                <span className="mono" style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: "var(--dub-badge-soft)", color: "var(--dub-badge-text)", border: "1px solid var(--dub-badge-border)", fontWeight: 700, letterSpacing: 1 }}>DUB</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                data-tv-autofocus
                onClick={() => navigate(`/watch/${encodeURIComponent(media.id)}/${getStartEpisode()}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "12px 22px",
                  borderRadius: 6, fontWeight: 700, fontSize: 14, background: "#fff", color: "#0a0a0a", border: "none", cursor: "pointer",
                }}
              >
                <Play size={14} fill="#0a0a0a" color="#0a0a0a" /> Play
              </button>
              <button
                onClick={toggleFavorite}
                disabled={toggling}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
                  borderRadius: 6, fontWeight: 600, fontSize: 14,
                  background: favorited ? "var(--accent-soft)" : "rgba(255,255,255,0.06)",
                  color: favorited ? "var(--accent)" : "#fff",
                  border: `1px solid ${favorited ? "var(--accent)" : "rgba(255,255,255,0.18)"}`,
                }}
              >
                {favorited ? <Check size={14} /> : <Plus size={14} />}
                {favorited ? "In To Watch" : "To Watch"}
              </button>
              <button
                onClick={toggleFavSeries}
                title={isFavSeries ? "Remove from favorite series" : "Add to favorite series (max 10)"}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
                  borderRadius: 6, fontWeight: 600, fontSize: 14,
                  background: isFavSeries ? "var(--fav-soft)" : "rgba(255,255,255,0.06)",
                  color: isFavSeries ? "var(--fav-text)" : "#fff",
                  border: `1px solid ${isFavSeries ? "var(--fav-border)" : "rgba(255,255,255,0.18)"}`,
                  cursor: "pointer",
                }}
              >
                <Heart size={14} fill={isFavSeries ? "currentColor" : "none"} />
                {isFavSeries ? "Favourite" : "Add Favourite"}
              </button>
              <button
                onClick={toggleManuallyWatched}
                disabled={togglingWatched}
                title={isManuallyWatched ? "Remove from watched" : "Mark as watched"}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
                  borderRadius: 6, fontWeight: 600, fontSize: 14,
                  background: isWatched ? "var(--seen-soft)" : "rgba(255,255,255,0.06)",
                  color: isWatched ? "var(--seen-text)" : "#fff",
                  border: `1px solid ${isWatched ? "var(--seen-border)" : "rgba(255,255,255,0.18)"}`,
                  cursor: togglingWatched ? "wait" : "pointer",
                }}
              >
                {isWatched ? <EyeOff size={14} /> : <Eye size={14} />}
                {isWatched ? "Watched" : "Mark Watched"}
              </button>
              <div ref={ratingPickerRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setShowRatingPicker((p) => !p)}
                  aria-label={likeRating ? `Liked: ${likeRating}/5` : "Like this anime"}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "12px 16px",
                    borderRadius: 6, fontWeight: 600, fontSize: 14,
                    background: likeRating != null ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.06)",
                    color: likeRating != null ? "var(--rating)" : "#fff",
                    border: `1px solid ${likeRating != null ? "var(--rating)" : "rgba(255,255,255,0.18)"}`,
                  }}
                >
                  <Star size={14} fill={likeRating != null ? "var(--rating)" : "none"} color={likeRating != null ? "var(--rating)" : "currentColor"} />
                  {likeRating != null ? `${likeRating}/5` : "Like"}
                </button>
                {showRatingPicker && (
                  <div
                    style={{
                      position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 50,
                      background: "var(--surf-2)", border: "1px solid var(--line-2)", borderRadius: 8,
                      padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    }}
                  >
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
                      <button
                        onClick={handleUnlike}
                        className="mono"
                        style={{ fontSize: 10, color: "var(--dim)", letterSpacing: 0.5, textAlign: "left" }}
                      >
                        REMOVE RATING
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" style={{ borderBottom: "1px solid var(--line)", marginBottom: 24, display: "flex", gap: 0 }}>
          {(["overview", "episodes", "cast"] as Tab[])
          .map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              id={`tab-${t}`}
              aria-controls={`panel-${t}`}
              onClick={() => setTab(t)}
              style={{
                padding: "12px 20px", fontSize: 13, fontWeight: 600, textTransform: "capitalize",
                color: tab === t ? "#fff" : "var(--muted)",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                marginBottom: -1, transition: "color 160ms",
              }}
            >{t}</button>
          ))}
        </div>

        {/* Tab content */}
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "overview" ? (
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 24 : 48, alignItems: "flex-start" }}>
              <p style={{ flex: 1, margin: 0, color: "var(--muted)", fontSize: isMobile ? 14 : 15, lineHeight: 1.65, whiteSpace: "pre-line" }}>
                {media.synopsis || "No synopsis available."}
              </p>
              <AnimeInfoPanel media={media} fullWidth={isMobile} />
            </div>
          ) : (
            <div style={{ maxWidth: 900 }}>
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
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                onClick={() => { setSelectedSeason(null); setSelectedRange(0); }}
                                style={{
                                  padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                                  background: selectedSeason === null ? "var(--accent)" : "var(--surf-2)",
                                  color: selectedSeason === null ? "#fff" : "var(--muted)",
                                  border: `1px solid ${selectedSeason === null ? "var(--accent)" : "var(--line-2)"}`,
                                  transition: "all 150ms",
                                }}
                              >
                                All
                              </button>
                              {seasons.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => { setSelectedSeason(s); setSelectedRange(0); }}
                                  style={{
                                    padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                                    background: selectedSeason === s ? "var(--accent)" : "var(--surf-2)",
                                    color: selectedSeason === s ? "#fff" : "var(--muted)",
                                    border: `1px solid ${selectedSeason === s ? "var(--accent)" : "var(--line-2)"}`,
                                    transition: "all 150ms",
                                  }}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {ranges.length > 0 && (
                          <>
                            {hasSeasons && <span style={{ color: "var(--line-2)" }}>·</span>}
                            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>Episodes</span>
                            <select
                              value={clampedRange}
                              onChange={(e) => setSelectedRange(Number(e.target.value))}
                              style={{
                                padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
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
                          {seasonFiltered.length} episodes
                        </span>
                      </div>
                    )}
                    <EpisodeList
                      mediaId={media.id}
                      mediaTitle={media.title}
                      episodes={visibleEpisodes}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                  {media.cast.length === 0
                    ? <p className="mono" style={{ color: "var(--dim)", fontSize: 12 }}>NO CAST DATA</p>
                    : media.cast.map((c) => <CastCard key={c.name} member={c} />)
                  }
                </div>
              )}
            </div>
          )}
        </div>

        {tab === "overview" && relations.length > 0 && (() => {
          const seasons = relations.filter((r) => r.relationType === "PREQUEL" || r.relationType === "SEQUEL");
          const related = relations.filter((r) => r.relationType === "SIDE_STORY" || r.relationType === "SPIN_OFF" || r.relationType === "ALTERNATIVE");
          const RELATION_LABELS: Record<string, string> = {
            PREQUEL: "PREQUEL",
            SEQUEL: "SEQUEL",
            SIDE_STORY: "SIDE STORY",
            SPIN_OFF: "SPIN-OFF",
            ALTERNATIVE: "ALT VERSION",
          };
          const renderRow = (items: typeof relations, heading: string) => items.length === 0 ? null : (
            <div style={{ marginTop: 48 }}>
              <p className="mono" style={{ margin: "0 0 16px", fontSize: 11, color: "var(--dim)", letterSpacing: 1 }}>
                {heading}
              </p>
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8, scrollbarWidth: "none" }}>
                {items.map(({ relationType, media: m }) => (
                  <div key={m.id} style={{ position: "relative", flexShrink: 0 }}>
                    <Card media={m} width={148} />
                    <div className="mono" style={{
                      marginTop: 4, fontSize: 9, color: "var(--accent)", letterSpacing: 0.5, textAlign: "center",
                    }}>
                      {RELATION_LABELS[relationType] ?? relationType}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
          return (
            <>
              {renderRow(seasons, "OTHER SEASONS")}
              {renderRow(related, "RELATED")}
            </>
          );
        })()}

        {tab === "overview" && (() => {
          const filteredSimilar = similar.filter((m) => !watchedIds.has(m.id));
          return (similarLoading || filteredSimilar.length > 0) && (
            <div style={{ marginTop: 48 }}>
              <p className="mono" style={{ margin: "0 0 16px", fontSize: 11, color: "var(--dim)", letterSpacing: 1 }}>
                SIMILAR SERIES
              </p>
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8, scrollbarWidth: "none" }}>
                {similarLoading
                  ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} width={148} />)
                  : filteredSimilar.map((m) => <Card key={m.id} media={m} width={148} />)
                }
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function AnimeInfoPanel({ media, fullWidth }: { media: Media; fullWidth?: boolean }) {
  type Row = { label: string; content: React.ReactNode };
  const rows: Row[] = [];

  if (media.country) rows.push({ label: "Country", content: media.country });
  if (media.genres.length) rows.push({ label: "Genres", content: media.genres.join(", ") });
  if (media.premiered) rows.push({ label: "Premiered", content: media.premiered });

  const airedFrom = media.airedFrom;
  const airedTo = media.airedTo;
  if (airedFrom) rows.push({ label: "Date aired", content: airedTo ? `${airedFrom} to ${airedTo}` : airedFrom });

  if (media.broadcast) rows.push({ label: "Broadcast", content: media.broadcast });
  if (media.totalEpisodes) rows.push({ label: "Episodes", content: media.totalEpisodes });
  if (media.duration) rows.push({ label: "Duration", content: `${media.duration} min` });

  if (media.status) {
    const formatted = media.status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    rows.push({ label: "Status", content: formatted });
  }

  if (media.rating != null) {
    const score = media.rating.toFixed(2);
    rows.push({
      label: "Score",
      content: media.popularity ? `${score} by ${media.popularity.toLocaleString()} users` : score,
    });
  }

  if (media.studios?.length) rows.push({ label: "Studios", content: media.studios.join(", ") });
  if (media.producers?.length) rows.push({ label: "Producers", content: media.producers.join(", ") });

  const links: React.ReactNode[] = [];
  if (media.malId) {
    links.push(
      <a key="mal" href={`https://myanimelist.net/anime/${media.malId}`} target="_blank" rel="noreferrer"
        style={{ color: "var(--accent)", textDecoration: "none" }}>MAL</a>
    );
  }
  if (media.siteUrl) {
    links.push(
      <a key="al" href={media.siteUrl} target="_blank" rel="noreferrer"
        style={{ color: "var(--accent)", textDecoration: "none" }}>AniList</a>
    );
  }
  if (links.length) {
    rows.push({
      label: "Links",
      content: links.reduce<React.ReactNode[]>((acc, l, i) => i === 0 ? [l] : [...acc, ", ", l], []),
    });
  }

  if (rows.length === 0) return null;

  return (
    <div style={{ flexShrink: 0, width: fullWidth ? "100%" : 240, display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map(({ label, content }) => (
        <div key={label}>
          <p className="mono" style={{ margin: "0 0 3px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>
            {label.toUpperCase()}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{content}</p>
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ height: 420, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
      <div style={{ maxWidth: 1600, margin: "-180px auto 0", padding: "0 32px" }}>
        <div style={{ display: "flex", gap: 32, alignItems: "flex-end", marginBottom: 40 }}>
          <div style={{ width: 180, height: 260, borderRadius: 8, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ paddingBottom: 4 }}>
            <div style={{ height: 40, width: 400, background: "var(--surf-2)", borderRadius: 6, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ height: 14, width: 280, background: "var(--surf-2)", borderRadius: 4, marginBottom: 20, animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ height: 44, width: 130, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 44, width: 110, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
