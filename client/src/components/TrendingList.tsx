import { Link } from "react-router-dom";
import type { Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";

interface TrendingListProps {
  items: Media[];
  loading?: boolean;
}

export function TrendingList({ items, loading }: TrendingListProps) {
  return (
    <aside style={{
      width: 400,
      flexShrink: 0,
      paddingRight: 32,
      overflowX: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 11,
        padding: "44px 0 16px",
      }}>
        <span style={{
          width: 3, height: 17, borderRadius: 2,
          background: "var(--accent)", flexShrink: 0,
        }} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>Top Trending</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {loading
          ? Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "10px 0",
              borderBottom: "1px solid var(--line)",
            }}>
              <div style={{ width: 30, textAlign: "right", flexShrink: 0 }}>
                <div style={{ height: 20, width: 18, background: "var(--surf-2)", borderRadius: 2, marginLeft: "auto", animation: "pulse 1.5s ease-in-out infinite" }} />
              </div>
              <div style={{ width: 70, height: 100, borderRadius: 6, background: "var(--surf-2)", flexShrink: 0, animation: "pulse 1.5s ease-in-out infinite" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ height: 14, width: "90%", background: "var(--surf-2)", borderRadius: 2, animation: "pulse 1.5s ease-in-out infinite" }} />
                <div style={{ height: 14, width: "70%", background: "var(--surf-2)", borderRadius: 2, marginTop: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
                <div style={{ height: 11, width: "50%", background: "var(--surf-2)", borderRadius: 2, marginTop: 10, animation: "pulse 1.5s ease-in-out infinite" }} />
              </div>
            </div>
          ))
          : items.slice(0, 10).map((m, idx) => (
            <Link
              key={m.id}
              to={`/title/${encodeURIComponent(m.id)}`}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "10px 0",
                borderBottom: "1px solid var(--line)",
                textDecoration: "none",
                transition: "background 150ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surf)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{
                width: 30, textAlign: "right", flexShrink: 0,
                fontSize: 22, fontWeight: 900,
                color: "transparent",
                WebkitTextStroke: idx < 3 ? "1.5px var(--accent)" : "1.5px var(--dim-2)",
                fontFamily: "Geist, sans-serif",
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}>
                {idx + 1}
              </span>

              <div style={{
                width: 70, height: 100, borderRadius: 6, overflow: "hidden",
                flexShrink: 0, border: "1px solid var(--line)",
              }}>
                {(m.banner || m.poster)
                  ? <img src={m.banner ?? m.poster} alt={m.title} loading="lazy" width={140} height={200} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
                  : <AnimeCover title={m.title} w={140} h={200} />
                }
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="clip-3" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.35, color: "var(--text)" }}>
                  {m.title}
                </div>
                {m.altTitles?.[0] && (
                  <div className="mono clip-1" style={{ fontSize: 10, color: "var(--dim)", marginTop: 5, letterSpacing: 0.5 }}>
                    {m.altTitles[0]}
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                  {m.genres.slice(0, 3).map((g) => (
                    <span key={g} className="mono" style={{
                      fontSize: 9, padding: "2px 6px", borderRadius: 3,
                      border: "1px solid var(--line-2)", color: "var(--muted)",
                      letterSpacing: 0.5,
                    }}>{g.toUpperCase()}</span>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--dim)", marginTop: 10, letterSpacing: 0.3 }}>
                  {m.rating ? <span style={{ color: "var(--rating)", fontWeight: 700 }}>★ {m.rating.toFixed(1)}</span> : null}
                  {m.year ? <span style={{ color: "var(--dim)" }}>{m.rating ? " · " : ""}{m.year}</span> : null}
                  {m.totalEpisodes ? <span style={{ color: "var(--dim)" }}> · {m.totalEpisodes} eps</span> : null}
                </div>
              </div>
            </Link>
          ))
        }
      </div>
    </aside>
  );
}
