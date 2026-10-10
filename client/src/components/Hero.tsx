import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Plus, Check, Info, ChevronLeft, ChevronRight } from "lucide-react";

import type { Media } from "../lib/types";
import { api } from "../lib/api";
import { AnimeCover } from "../lib/procedural";
import { toFormatLabel } from "../lib/utils";
import { TrailerBackdrop } from "./TrailerBackdrop";
import { useIsMobile } from "../hooks/useIsMobile";

interface HeroProps {
  items: Media[];
  loading?: boolean;
}

const SLIDE_COUNT = 5;

export function Hero({ items, loading }: HeroProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const heroHeight = isMobile ? 340 : 540;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slides = items.slice(0, SLIDE_COUNT);
  const media = slides[activeIndex] ?? null;

  useEffect(() => {
    if (!media) return;
    setIsFavorited(false);
    api.library.isFavorited(media.id).then(({ favorited }) => setIsFavorited(favorited)).catch(() => {});
  }, [media?.id]);

  // Reset to first slide when a new items array arrives (e.g. trending loads)
  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  function goTo(idx: number) {
    if (idx === activeIndex || isFading) return;
    setIsFading(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setActiveIndex(idx);
      setIsFading(false);
    }, 220);
  }

  async function toggleFavorite() {
    if (!media || isToggling) return;
    setIsToggling(true);
    try {
      if (isFavorited) {
        await api.library.removeFavorite(media.id);
        setIsFavorited(false);
      } else {
        await api.library.addFavorite({ media_id: media.id, type: media.type, title: media.title, poster: media.poster });
        setIsFavorited(true);
      }
    } finally {
      setIsToggling(false);
    }
  }

  const frameStyle: React.CSSProperties = isMobile
    ? { position: "relative", overflow: "hidden" }
    : { position: "relative", overflow: "hidden", borderRadius: "var(--radius-hero)", border: "1px solid var(--line)" };

  if (loading || !media) {
    return (
      <section aria-busy="true" style={{ ...frameStyle, height: heroHeight, background: "var(--surf)" }}>
        <div style={{ position: "absolute", left: isMobile ? 16 : 40, bottom: isMobile ? 24 : 150, width: "min(560px, 80%)" }}>
          <div style={{ height: 22, width: 260, background: "var(--surf-2)", borderRadius: 4, marginBottom: 18, animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ height: 52, width: "90%", background: "var(--surf-2)", borderRadius: 6, marginBottom: 16, animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ height: 56, width: "100%", background: "var(--surf-2)", borderRadius: 4, marginBottom: 22, animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ height: 46, width: 300, background: "var(--surf-2)", borderRadius: 4, animation: "pulse 1.5s ease-in-out infinite" }} />
        </div>
      </section>
    );
  }

  const format = toFormatLabel(media);

  return (
    <section aria-roledescription="carousel" aria-label="Spotlight" style={frameStyle}>
      <TrailerBackdrop banner={media.banner ?? media.poster} trailer={media.trailer} title={media.title} height={heroHeight}>
        <div style={{
          position: "absolute",
          left: isMobile ? 16 : 40, right: isMobile ? 16 : undefined,
          bottom: isMobile ? 20 : 150,
          width: isMobile ? undefined : "min(560px, 60%)",
          pointerEvents: "auto",
          opacity: isFading ? 0 : 1,
          transition: "opacity 220ms ease",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: isMobile ? 10 : 16 }}>
            <Chip tone="accent">#{activeIndex + 1} SPOTLIGHT</Chip>
            {media.rating && <Chip tone="rating">★ {media.rating.toFixed(1)}</Chip>}
            {format && <Chip>{format}</Chip>}
            {media.year && <Chip>{media.year}</Chip>}
            {!isMobile && media.genres.length > 0 && <Chip>{media.genres.slice(0, 2).join(" · ")}</Chip>}
          </div>

          <h1 className="clip-2" style={{
            margin: 0, fontSize: isMobile ? 28 : 52, fontWeight: 900, lineHeight: 0.98,
            letterSpacing: isMobile ? "-0.02em" : "-0.04em", textTransform: "uppercase",
          }}>
            {media.title}
          </h1>

          {!isMobile && media.synopsis && (
            <p className="clip-3" style={{ color: "var(--hero-text)", fontSize: 14, lineHeight: 1.6, margin: "16px 0 24px" }}>
              {media.synopsis}
            </p>
          )}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: isMobile ? 14 : 0 }}>
            <button
              data-tv-autofocus
              className="btn-slant btn-slant--primary"
              onClick={() => navigate(`/watch/${encodeURIComponent(media.id)}/1`)}
            >
              <Play size={14} fill="currentColor" /> Watch now
            </button>
            <button className="btn-slant btn-slant--ghost" onClick={() => navigate(`/title/${encodeURIComponent(media.id)}`)}>
              <Info size={15} /> Details
            </button>
            <button
              className="btn-slant btn-slant--ghost"
              onClick={toggleFavorite}
              disabled={isToggling}
              aria-pressed={isFavorited}
              aria-label={isFavorited ? "Remove from To Watch" : "Add to To Watch"}
              style={{ padding: "0 22px", color: isFavorited ? "var(--accent-hi)" : undefined }}
            >
              {isFavorited ? <Check size={16} /> : <Plus size={16} />}
            </button>
          </div>
        </div>

        {!isMobile && slides.length > 1 && (
          <>
            <div style={{ position: "absolute", top: 24, right: 24, display: "flex", gap: 8, pointerEvents: "auto" }}>
              <ArrowButton label="Previous spotlight" onClick={() => goTo((activeIndex - 1 + slides.length) % slides.length)}>
                <ChevronLeft size={18} />
              </ArrowButton>
              <ArrowButton label="Next spotlight" onClick={() => goTo((activeIndex + 1) % slides.length)}>
                <ChevronRight size={18} />
              </ArrowButton>
            </div>

            <div style={{ position: "absolute", left: 40, right: 24, bottom: 22, display: "flex", alignItems: "flex-end", gap: 10, pointerEvents: "auto" }}>
              <span className="mono" aria-hidden="true" style={{
                writingMode: "vertical-rl", transform: "rotate(180deg)",
                fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: "var(--muted)", marginRight: 4,
              }}>
                UP NEXT
              </span>
              <div role="tablist" aria-label="Spotlight slides" style={{ display: "flex", gap: 10, minWidth: 0 }}>
                {slides.map((m, i) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={i === activeIndex}
                    aria-label={m.title}
                    className="upnext-thumb"
                    onClick={() => goTo(i)}
                    style={{
                      position: "relative", width: 150, height: 84, flexShrink: 1, minWidth: 90,
                      borderRadius: 8, overflow: "hidden", border: "1px solid var(--glass-line)",
                    }}
                  >
                    {(m.banner || m.poster)
                      ? <img src={m.banner ?? m.poster} alt="" loading="lazy" width={150} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      : <AnimeCover title={m.title} w={150} h={84} />}
                    <span style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--glass-strong), transparent 70%)" }} />
                    <span className="clip-1" style={{
                      position: "absolute", left: 8, right: 8, bottom: 6,
                      fontSize: 11, fontWeight: 700, textAlign: "left",
                    }}>
                      {m.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </TrailerBackdrop>
    </section>
  );
}

function Chip({ tone, children }: { tone?: "accent" | "rating"; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 4,
      background: tone === "accent" ? "var(--accent-soft)" : "var(--glass-light)",
      border: `1px solid ${tone === "accent" ? "var(--accent-line)" : "var(--glass-line)"}`,
      color: tone === "accent" ? "var(--accent-hi)" : tone === "rating" ? "var(--rating)" : "var(--text)",
      backdropFilter: "blur(6px)",
    }}>
      {children}
    </span>
  );
}

function ArrowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="row-scroll-btn"
      style={{ position: "static", transform: "none", borderRadius: 8, background: "var(--glass)" }}
    >
      {children}
    </button>
  );
}
