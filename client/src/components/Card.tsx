import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";
import { useLibrary } from "../context/LibraryContext";

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
        boxShadow: hover ? "0 12px 30px rgba(229,9,20,0.25)" : "0 4px 12px rgba(0,0,0,0.4)",
        transition: "border-color 200ms, box-shadow 200ms",
      }}>
        {(media.poster || media.banner) ? (
          <img src={media.poster ?? media.banner} alt={media.title} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
        ) : (
          <AnimeCover title={media.title} w={width} h={h} />
        )}

        {/* Type badge */}
        <div className="mono" style={{
          position: "absolute", top: 8, left: 8,
          fontSize: 9, padding: "2px 6px", borderRadius: 3,
          background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)",
          color: "#fff", fontWeight: 600, letterSpacing: 0.5,
        }}>{media.type.toUpperCase()}</div>

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
            position: "absolute", bottom: 8, left: 8,
            fontSize: 9, padding: "2px 6px", borderRadius: 3,
            background: "rgba(0,0,0,0.75)", border: "1px solid rgba(251,191,36,0.5)",
            color: "#fbbf24", fontWeight: 700,
          }}>
            {"★".repeat(userRating)}
          </div>
        )}

        {/* AniList community rating */}
        {media.rating && (
          <div style={{
            position: "absolute", bottom: 8, right: 8,
            display: "flex", alignItems: "center", gap: 3,
            fontSize: 10, padding: "2px 6px", borderRadius: 3,
            background: "rgba(0,0,0,0.7)", color: "var(--rating)", fontWeight: 700,
          }}>
            ★ {media.rating.toFixed(1)}
          </div>
        )}

        {/* Ranked ghost number */}
        {rank != null && (
          <div style={{
            position: "absolute", top: -4, left: -8,
            fontSize: 88, fontWeight: 900, color: "transparent",
            WebkitTextStroke: "2px rgba(229,9,20,0.9)",
            fontFamily: "Geist, sans-serif", lineHeight: 0.9,
            letterSpacing: "-0.05em", pointerEvents: "none", userSelect: "none",
          }}>{rank}</div>
        )}
      </div>

      {/* Caption */}
      <div style={{ padding: "8px 2px 0" }}>
        <div className="clip-1" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{media.title}</div>
        <div className="mono" style={{ fontSize: 10, color: "var(--dim)", marginTop: 5, letterSpacing: 0.5 }}>
          {media.year ?? "—"}{media.totalEpisodes ? ` · ${media.totalEpisodes}EP` : ""}
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
