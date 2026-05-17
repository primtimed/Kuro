import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Plus, Check, ChevronRight } from "lucide-react";
import type { Media } from "../lib/types";
import { api } from "../lib/api";
import { TrailerBackdrop } from "./TrailerBackdrop";
import { useIsMobile } from "../hooks/useIsMobile";

interface HeroProps {
  items: Media[];
  loading?: boolean;
}

export function Hero({ items, loading }: HeroProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const heroHeight = isMobile ? 320 : 560;
  const [activeIndex, setActiveIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [toggling, setToggling] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const count = Math.min(items.length, 5);
  const media = items[activeIndex] ?? null;

  useEffect(() => {
    if (!media) return;
    setFavorited(false);
    api.library.isFavorited(media.id).then(({ favorited: f }) => setFavorited(f)).catch(() => {});
  }, [media?.id]);

  // Reset to first slide when a new items array arrives (e.g. trending loads)
  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  function goTo(idx: number) {
    if (idx === activeIndex || fading) return;
    setFading(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setActiveIndex(idx);
      setFading(false);
    }, 220);
  }

  function goNext() {
    goTo((activeIndex + 1) % count);
  }

  async function toggleFavorite() {
    if (!media || toggling) return;
    setToggling(true);
    try {
      if (favorited) {
        await api.library.removeFavorite(media.id);
        setFavorited(false);
      } else {
        await api.library.addFavorite({ media_id: media.id, type: media.type, title: media.title, poster: media.poster });
        setFavorited(true);
      }
    } finally {
      setToggling(false);
    }
  }

  if (loading || !media) {
    return (
      <section style={{ position: "relative", height: heroHeight, overflow: "hidden", borderBottom: "1px solid var(--line)", background: "var(--surf)" }}>
        <div style={{ position: "absolute", inset: 0, maxWidth: 1600, margin: "0 auto", padding: "60px 32px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ height: 16, width: 200, background: "var(--surf-2)", borderRadius: 4, marginBottom: 16, animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ height: 56, width: 400, background: "var(--surf-2)", borderRadius: 6, marginBottom: 10, animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ height: 14, width: 320, background: "var(--surf-2)", borderRadius: 4, marginBottom: 18, animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ height: 60, width: 560, background: "var(--surf-2)", borderRadius: 4, marginBottom: 26, animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ height: 44, width: 130, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 44, width: 110, background: "var(--surf-2)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 24, right: 32, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ width: i === 0 ? 28 : 14, height: 3, borderRadius: 2, background: i === 0 ? "var(--accent)" : "rgba(255,255,255,0.25)" }} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ borderBottom: "1px solid var(--line)" }}>
      <TrailerBackdrop
        banner={media.banner}
        trailer={media.trailer}
        title={media.title}
        height={heroHeight}
      >
        {/* Content — fades during slide transitions */}
        <div style={{
          position: "absolute", inset: 0,
          maxWidth: 1600, margin: "0 auto",
          padding: isMobile ? "12px 16px" : "60px 32px",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          pointerEvents: "none",
          opacity: fading ? 0 : 1,
          transition: "opacity 220ms ease",
        }}>
          <div style={{ maxWidth: isMobile ? "100%" : 620, pointerEvents: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span className="mono" style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 3, letterSpacing: 1.5,
                background: "var(--accent)", color: "#fff", fontWeight: 700,
              }}>SPOTLIGHT · #{activeIndex + 1}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 1 }}>
                {media.type.toUpperCase()} · {media.year ?? "—"}
              </span>
            </div>

            <h1 style={{ margin: 0, fontSize: isMobile ? 26 : 56, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.0 }}>
              {media.title}
            </h1>
            {!isMobile && media.altTitles?.[0] && (
              <p className="mono" style={{ margin: "10px 0 0", color: "var(--dim)", fontSize: 12, letterSpacing: 1 }}>
                {media.altTitles[0].toUpperCase()}
              </p>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14, margin: isMobile ? "8px 0 8px" : "18px 0 14px" }}>
              {media.rating && (
                <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--rating)", fontWeight: 600, fontSize: 13 }}>
                  ★ {media.rating.toFixed(1)}
                </span>
              )}
              <span style={{ color: "var(--dim-2)" }}>·</span>
              {media.totalEpisodes && <span style={{ fontSize: 13, color: "var(--muted)" }}>{media.totalEpisodes} eps</span>}
              {media.status && (
                <>
                  <span style={{ color: "var(--dim-2)" }}>·</span>
                  <span style={{ fontSize: 13, color: "var(--muted)", textTransform: "capitalize" }}>{media.status.toLowerCase()}</span>
                </>
              )}
            </div>

            {!isMobile && (
              <p style={{ color: "#d4d4d4", fontSize: 15, lineHeight: 1.55, maxWidth: 560, margin: "0 0 14px" }}>
                {media.synopsis.length > 200 ? media.synopsis.slice(0, 200) + "…" : media.synopsis}
              </p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                data-tv-autofocus
                onClick={() => navigate(`/watch/${encodeURIComponent(media.id)}/1`)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: isMobile ? "10px 16px" : "12px 22px", borderRadius: 6, fontWeight: 700, fontSize: isMobile ? 13 : 14,
                  background: "#fff", color: "#0a0a0a", border: "none", cursor: "pointer",
                }}
              >
                <Play size={14} fill="#0a0a0a" color="#0a0a0a" /> Play E01
              </button>
              <button
                onClick={() => navigate(`/title/${encodeURIComponent(media.id)}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: isMobile ? "10px 12px" : "12px 18px", borderRadius: 6, fontWeight: 600, fontSize: isMobile ? 13 : 14,
                  background: "rgba(255,255,255,0.1)", color: "#fff",
                  border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", cursor: "pointer",
                }}
              >
                More info
              </button>
              <button
                onClick={toggleFavorite}
                disabled={toggling}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "12px 14px", borderRadius: 6, fontWeight: 600, fontSize: 14,
                  background: favorited ? "var(--accent-soft)" : "rgba(255,255,255,0.06)",
                  color: favorited ? "var(--accent)" : "#fff",
                  border: `1px solid ${favorited ? "var(--accent)" : "rgba(255,255,255,0.12)"}`,
                  cursor: "pointer",
                }}
              >
                {favorited ? <Check size={14} /> : <Plus size={14} />}
                {favorited ? "In To Watch" : "To Watch"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: isMobile ? 10 : 22, flexWrap: "wrap" }}>
              {media.genres.slice(0, 5).map((g) => (
                <span key={g} className="mono" style={{
                  fontSize: 10, padding: "3px 8px", borderRadius: 999, letterSpacing: 1,
                  border: "1px solid rgba(255,255,255,0.18)", color: "#d4d4d4",
                }}>{g.toUpperCase()}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom-right: dot indicators + next button */}
        <div style={{ position: "absolute", bottom: isMobile ? 12 : 24, right: isMobile ? 16 : 32, display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
          <div role="tablist" aria-label="Spotlight slides" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {items.slice(0, 5).map((_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Spotlight ${i + 1}`}
                onClick={() => goTo(i)}
                style={{
                  width: i === activeIndex ? 28 : 14,
                  height: 3, borderRadius: 2, padding: 0, border: "none", cursor: "pointer",
                  background: i === activeIndex ? "var(--accent)" : "rgba(255,255,255,0.3)",
                  transition: "width 250ms cubic-bezier(0.4,0,0.2,1), background 250ms",
                  // Enlarge the click target without changing visual size
                  boxShadow: "0 6px 0 6px transparent",
                }}
              />
            ))}
          </div>

          <button
            onClick={goNext}
            aria-label="Next spotlight"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 999,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              backdropFilter: "blur(8px)",
              color: "#fff", cursor: "pointer",
              transition: "background 150ms, border-color 150ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.2)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
            }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </TrailerBackdrop>
    </section>
  );
}
