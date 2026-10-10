import { Link } from "react-router-dom";

import type { Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";
import { toFormatLabel } from "../lib/utils";
import { useIsMobile } from "../hooks/useIsMobile";

export interface ContinueItem {
  media: Media;
  episode: number;
  progressSeconds: number;
  durationSeconds?: number;
}

interface ContinueWatchingProps {
  items: ContinueItem[];
}

export function ContinueWatching({ items }: ContinueWatchingProps) {
  const isMobile = useIsMobile();
  const pad = isMobile ? 16 : 32;
  const cardWidth = isMobile ? 260 : 300;

  return (
    <section aria-labelledby="continue-watching" style={{ marginBottom: isMobile ? 32 : 44 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${pad}px 16px` }}>
        <h2 id="continue-watching" style={{
          margin: 0, paddingLeft: 12, borderLeft: "4px solid var(--accent)",
          fontSize: isMobile ? 18 : 22, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1,
        }}>
          Continue Watching
        </h2>
        <Link to="/library?tab=history" className="mono" style={{
          fontSize: 10, color: "var(--muted)", letterSpacing: 1.5,
          padding: "4px 10px", borderRadius: 4, border: "1px solid var(--line-2)",
        }}>
          SEE ALL →
        </Link>
      </div>

      <div className="row-scroll" style={{ padding: `4px ${pad}px 12px` }}>
        {items.map(({ media, episode, progressSeconds, durationSeconds }) => {
          const ratio = durationSeconds ? Math.min(progressSeconds / durationSeconds, 1) : 0;
          const minutesLeft = durationSeconds ? Math.max(Math.round((durationSeconds - progressSeconds) / 60), 1) : null;
          const art = media.banner ?? media.poster;
          return (
            <Link
              key={media.id}
              to={`/watch/${encodeURIComponent(media.id)}/${episode}`}
              className="kuro-card cw-card"
              aria-label={`Resume ${media.title}, episode ${episode}`}
              style={{
                display: "block", width: cardWidth, flexShrink: 0,
                background: "var(--surf)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden",
              }}
            >
              <div className="kuro-card-img" style={{ position: "relative", aspectRatio: "16 / 8" }}>
                {art
                  ? <img src={art} alt="" loading="lazy" width={cardWidth} height={cardWidth / 2} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <AnimeCover title={media.title} w={cardWidth} h={cardWidth / 2} />}
                <span style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--glass-strong), transparent 60%)" }} />
                <span style={{ position: "absolute", left: 12, bottom: 10, fontSize: 12, fontWeight: 700 }}>
                  EP {episode}
                  {minutesLeft !== null && <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {minutesLeft}m left</span>}
                </span>
              </div>
              <div role="progressbar" aria-label="Watched" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} style={{ height: 3, background: "var(--line-2)" }}>
                <div style={{ height: "100%", width: `${ratio * 100}%`, background: "var(--accent)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px" }}>
                <span className="clip-1" style={{ fontSize: 13, fontWeight: 600 }}>{media.title}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>
                  {toFormatLabel(media)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
