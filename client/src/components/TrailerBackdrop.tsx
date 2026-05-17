import { useState, useEffect, useRef, type ReactNode } from "react";
import { AnimeBackdrop } from "../lib/procedural";

function embedUrl(id: string, muted: boolean) {
  const p = new URLSearchParams({
    autoplay: "1", mute: muted ? "1" : "0",
    controls: muted ? "0" : "1", loop: muted ? "1" : "0",
    ...(muted ? { playlist: id } : {}),
    rel: "0", modestbranding: "1", playsinline: "1",
  });
  return `https://www.youtube.com/embed/${id}?${p}`;
}

interface TrailerBackdropProps {
  banner?: string;
  trailer?: { site: string; id: string };
  title: string;
  height: number;
  /** Extra px added when expanded. Defaults to 180. */
  expandedHeight?: number;
  /** Overrides banner src (e.g. episode hover thumbnail). Suppresses trailer while set. */
  overrideSrc?: string;
  children?: ReactNode;
}

export function TrailerBackdrop({
  banner, trailer, title, height, expandedHeight = 180,
  overrideSrc, children,
}: TrailerBackdropProps) {
  const [trailerVisible, setTrailerVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasTrailer = !!trailer && trailer.site === "youtube";
  const showTrailer = trailerVisible && hasTrailer && !overrideSrc;
  const expanded = showTrailer && !muted;

  // Reset 10s timer when media changes
  useEffect(() => {
    setTrailerVisible(false);
    setMuted(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!hasTrailer) return;
    timerRef.current = setTimeout(() => setTrailerVisible(true), 10_000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner, hasTrailer]);

  // Click outside the banner → remute and collapse
  useEffect(() => {
    if (!expanded) return;
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMuted(true);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [expanded]);

  function handleBannerClick() {
    if (showTrailer && muted) setMuted(false);
  }

  const imgSrc = overrideSrc ?? banner;

  return (
    <div
      ref={containerRef}
      onClick={handleBannerClick}
      style={{
        position: "relative", overflow: "hidden",
        height: expanded ? height + expandedHeight : height,
        transition: "height 600ms cubic-bezier(0.4,0,0.2,1)",
        cursor: showTrailer && muted ? "pointer" : "default",
      }}
    >
      {/* Banner / episode thumbnail / procedural fallback */}
      {imgSrc ? (
        <img
          key={imgSrc}
          src={imgSrc}
          alt=""
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%", objectFit: "cover", objectPosition: "top",
            transition: "opacity 800ms ease",
            opacity: showTrailer ? 0 : 1,
          }}
        />
      ) : (
        <AnimeBackdrop title={title} />
      )}

      {/* Trailer iframe — fades in after 10s */}
      {hasTrailer && (
        <div style={{
          position: "absolute", inset: 0,
          opacity: showTrailer ? 1 : 0,
          transition: "opacity 800ms ease",
          pointerEvents: "none",
        }}>
          <iframe
            key={muted ? "muted" : "unmuted"}
            src={showTrailer ? embedUrl(trailer!.id, muted) : undefined}
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              border: "none", pointerEvents: "none",
              transform: expanded ? "scale(1.02)" : "scale(1.18)",
              transition: "transform 600ms cubic-bezier(0.4,0,0.2,1)",
            }}
          />
        </div>
      )}

      {/* Gradients — lighten on the right when expanded so more video is visible */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: expanded
          ? "linear-gradient(to right, rgba(10,10,10,0.8) 0%, rgba(10,10,10,0.2) 40%, rgba(10,10,10,0) 100%)"
          : "linear-gradient(to right, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.5) 50%, rgba(10,10,10,0.1) 100%)",
        transition: "background 600ms ease",
      }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #0a0a0a 0%, transparent 50%)", pointerEvents: "none" }} />

      {/* Isolate children clicks so they don't bubble up and trigger unmute */}
      {children && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {children}
        </div>
      )}
    </div>
  );
}
