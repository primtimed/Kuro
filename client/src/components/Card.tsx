import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";
import { useLibrary } from "../context/LibraryContext";
import { toFormatLabel } from "../lib/utils";

interface CardProps {
  media: Media;
  rank?: number;
  width?: number;
}

export function Card({ media, rank, width = 178 }: CardProps) {
  const [hover, setHover] = useState(false);
  const { watchedIds, ratingMap } = useLibrary();
  const isWatched = watchedIds.has(media.id);
  const userRating = ratingMap.get(media.id) ?? null;
  const h = Math.round(width * (4 / 3) * 1.06);
  const format = toFormatLabel(media);

  return (
    <Link
      to={`/title/${encodeURIComponent(media.id)}`}
      className="kuro-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block", textAlign: "left", width, flexShrink: 0,
        transform: hover ? "translateY(-4px)" : "none",
        transition: "transform 200ms ease",
        textDecoration: "none",
      }}
    >
      <div className="kuro-card-img" style={{
        position: "relative", width, height: h,
        borderRadius: 6, overflow: "hidden",
        border: hover ? "1px solid var(--accent)" : "1px solid var(--line)",
        boxShadow: hover ? "0 12px 30px var(--accent-glow)" : "0 4px 12px var(--glass)",
        transition: "border-color 200ms, box-shadow 200ms",
      }}>
        {(media.poster || media.banner) ? (
          <img src={media.poster ?? media.banner} alt={media.title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
        ) : (
          <AnimeCover title={media.title} w={width} h={h} />
        )}

        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--glass-strong), transparent 38%)", pointerEvents: "none" }} />

        {/* Community rating + format — top left */}
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4 }}>
          {media.rating && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 6px", borderRadius: 4,
              background: "var(--glass-strong)", color: "var(--rating)",
            }}>★ {media.rating.toFixed(1)}</span>
          )}
          {format && (
            <span className="mono" style={{
              fontSize: 10, fontWeight: 700, padding: "3px 6px", borderRadius: 4, letterSpacing: 0.4,
              background: "var(--glass-strong)", color: "var(--text)",
            }}>{format}</span>
          )}
        </div>

        {/* Watched badge — top right */}
        {isWatched && (
          <div style={{
            position: "absolute", top: 8, right: 8,
            display: "flex", alignItems: "center", gap: 2,
            fontSize: 8, padding: "2px 5px", borderRadius: 3,
            background: "var(--seen-soft)", border: "1px solid var(--seen-border)",
            color: "var(--seen-text)", fontWeight: 700, letterSpacing: 0.5,
          }}>
            <Check size={8} strokeWidth={3} /> SEEN
          </div>
        )}

        {/* User star rating — bottom left */}
        {userRating !== null && (
          <div style={{
            position: "absolute", bottom: 8, left: rank != null ? 56 : 8,
            fontSize: 9, padding: "2px 6px", borderRadius: 3,
            background: "var(--glass-strong)", border: "1px solid var(--rating)",
            color: "var(--rating)", fontWeight: 700,
          }}>
            {"★".repeat(userRating)}
          </div>
        )}

        {/* Episode count — bottom right */}
        {media.totalEpisodes && (
          <div className="mono" style={{
            position: "absolute", bottom: 8, right: 8,
            fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 800,
            background: "var(--chip-light)", color: "var(--bg)",
          }}>
            {media.totalEpisodes} EP
          </div>
        )}

        {/* Ranked ghost number */}
        {rank != null && (
          <div style={{
            position: "absolute", bottom: -10, left: -4,
            fontSize: 88, fontWeight: 900, color: "transparent",
            WebkitTextStroke: "2px var(--accent)",
            fontFamily: "Geist, sans-serif", lineHeight: 0.9,
            letterSpacing: "-0.05em", pointerEvents: "none", userSelect: "none",
          }}>{rank}</div>
        )}
      </div>

      {/* Caption */}
      <div style={{ padding: "9px 2px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
          <span className="clip-1" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{media.title}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 4 }}>
          {[format, media.year, media.genres[0]].filter(Boolean).join(" · ")}
        </div>
      </div>
    </Link>
  );
}

export function CardSkeleton({ width = 178 }: { width?: number }) {
  const h = Math.round(width * (4 / 3) * 1.06);
  return (
    <div style={{ width, flexShrink: 0 }}>
      <div style={{
        width, height: h, borderRadius: 6,
        background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite",
      }} />
      <div style={{ padding: "8px 2px 0" }}>
        <div style={{ height: 13, width: "80%", background: "var(--surf-2)", borderRadius: 3, animation: "pulse 1.5s ease-in-out infinite" }} />
        <div style={{ height: 10, width: "50%", background: "var(--surf-2)", borderRadius: 3, marginTop: 5, animation: "pulse 1.5s ease-in-out infinite" }} />
      </div>
    </div>
  );
}
