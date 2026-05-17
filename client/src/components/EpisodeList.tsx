import { useNavigate } from "react-router-dom";
import { Play, Check, Calendar, Clock, ExternalLink } from "lucide-react";
import type { Episode, EpisodeAvail } from "../lib/types";
import { EpisodeThumbnail } from "../lib/procedural";
import { progressPercent } from "../lib/utils";

interface EpisodeListProps {
  mediaId: string;
  mediaTitle: string;
  episodes: Episode[];
  currentEpisode?: number;
  progressMap?: Record<number, { progress: number; duration: number }>;
  availabilityMap?: Record<number, EpisodeAvail>;
  onEpisodeHover?: (thumb: string | null) => void;
  onToggleWatched?: (epNumber: number, currentlyWatched: boolean) => void;
  hideSeasonsHeaders?: boolean;
  externalFallbackUrl?: string;
}

// Group episodes by season when seasonNumber is present
function groupBySeason(episodes: Episode[]): { season: number; episodes: Episode[] }[] {
  const hasSeasons = episodes.some((e) => e.seasonNumber != null);
  if (!hasSeasons) return [{ season: 0, episodes }];

  const map = new Map<number, Episode[]>();
  for (const ep of episodes) {
    const s = ep.seasonNumber ?? 0;
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(ep);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, eps]) => ({ season, episodes: eps }));
}

export function EpisodeList({
  mediaId, mediaTitle, episodes, currentEpisode,
  progressMap, availabilityMap, onEpisodeHover, onToggleWatched,
  hideSeasonsHeaders = false, externalFallbackUrl,
}: EpisodeListProps) {
  const navigate = useNavigate();
  const isExternal = !!externalFallbackUrl || episodes.some((e) => e.streamUrl);

  if (episodes.length === 0) {
    return (
      <p className="mono" style={{ color: "var(--dim)", fontSize: 12, letterSpacing: 0.5, padding: "16px 0" }}>
        NO EPISODE DATA AVAILABLE
      </p>
    );
  }

  const groups = hideSeasonsHeaders
    ? [{ season: 0, episodes }]
    : groupBySeason(episodes);

  return (
    <div>
      {isExternal && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px", borderRadius: 6, marginBottom: 16,
          background: "var(--surf)", border: "1px solid var(--line-2)",
          fontSize: 12, color: "var(--muted)",
        }}>
          <ExternalLink size={12} style={{ flexShrink: 0 }} />
          Episodes open directly in the streaming service — Kuro cannot play DRM-protected content.
        </div>
      )}

      {groups.map(({ season, episodes: eps }) => (
        <div key={season}>
          {season > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "16px 16px 8px", marginBottom: 4,
            }}>
              <span style={{
                width: 2, height: 14, borderRadius: 1,
                background: "var(--accent)", flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: 0.5 }}>
                SEASON {season}
              </span>
              <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                {eps.length} episodes
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {eps.map((ep) => {
              const prog = progressMap?.[ep.number];
              const pct = prog ? progressPercent(prog.progress, prog.duration) : 0;
              const watched = pct >= 90;
              const isNext = ep.number === currentEpisode;
              const durationMin = prog?.duration ? Math.round(prog.duration / 60) : (ep.duration ?? null);

              return (
                <EpisodeRow
                  key={ep.number}
                  mediaId={mediaId}
                  mediaTitle={mediaTitle}
                  ep={ep}
                  pct={pct}
                  watched={watched}
                  isNext={isNext}
                  avail={availabilityMap?.[ep.number]}
                  durationMin={durationMin}
                  onPlay={() => {
                    const target = ep.streamUrl ?? externalFallbackUrl;
                    if (target) {
                      window.open(`/api/services/launch?target=${encodeURIComponent(target)}`, "_blank", "noopener,noreferrer");
                    } else {
                      navigate(`/watch/${encodeURIComponent(mediaId)}/${ep.number}`);
                    }
                  }}
                  onHover={onEpisodeHover}
                  isExternalEpisode={!!(ep.streamUrl ?? externalFallbackUrl)}
                  onToggleWatched={onToggleWatched && !ep.streamUrl && !externalFallbackUrl
                    ? () => onToggleWatched(ep.number, watched)
                    : undefined}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EpisodeRow({ mediaId, mediaTitle, ep, pct, watched, isNext, avail, durationMin, onPlay, onHover, onToggleWatched, isExternalEpisode }: {
  mediaId: string;
  mediaTitle: string;
  ep: Episode;
  pct: number;
  watched: boolean;
  isNext: boolean;
  avail?: EpisodeAvail;
  durationMin: number | null;
  onPlay: () => void;
  onHover?: (thumb: string | null) => void;
  onToggleWatched?: () => void;
  isExternalEpisode?: boolean;
}) {
  const isExternal = isExternalEpisode ?? !!ep.streamUrl;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${isExternal ? "Open" : "Play"} episode ${ep.number}${ep.title ? `: ${ep.title}` : ""}`}
      onClick={onPlay}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(); } }}
      style={{
        display: "grid",
        gridTemplateColumns: "60px 220px 1fr auto",
        gap: 20, alignItems: "center",
        width: "100%", padding: "14px 16px",
        borderRadius: 6, textAlign: "left",
        background: isNext ? "var(--accent-soft)" : "transparent",
        border: isNext ? "1px solid var(--accent)" : "1px solid transparent",
        transition: "background 160ms",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (!isNext) (e.currentTarget as HTMLDivElement).style.background = "var(--surf)";
        onHover?.(ep.thumbnail ?? null);
      }}
      onMouseLeave={(e) => {
        if (!isNext) (e.currentTarget as HTMLDivElement).style.background = "transparent";
        onHover?.(null);
      }}
      onFocus={(e) => {
        if (!isNext) (e.currentTarget as HTMLDivElement).style.background = "var(--surf)";
      }}
      onBlur={(e) => {
        if (!isNext) (e.currentTarget as HTMLDivElement).style.background = "transparent";
        onHover?.(null);
      }}
    >
      {/* Episode number */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1,
          color: watched ? "var(--dim)" : "#fff",
        }}>
          {String(ep.episodeInSeason ?? ep.number).padStart(2, "0")}
        </span>
        {watched ? (
          <span className="mono" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "var(--sub)", fontWeight: 600, letterSpacing: 0.5 }}>
            <Check size={9} /> SEEN
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 9, color: "var(--dim)", letterSpacing: 0.5 }}>EP</span>
        )}
      </div>

      {/* Thumbnail */}
      <div style={{ position: "relative", height: 124, borderRadius: 4, overflow: "hidden" }}>
        {ep.thumbnail ? (
          <img src={ep.thumbnail} alt={`Episode ${ep.number}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
        ) : (
          <EpisodeThumbnail title={mediaTitle} epNum={ep.number} />
        )}
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.25)",
        }}>
          <span style={{
            width: 42, height: 42, borderRadius: "50%",
            background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isExternal
              ? <ExternalLink size={15} color="#fff" />
              : <Play size={16} fill="#fff" color="#fff" />
            }
          </span>
        </div>
        {(avail?.hasSub || avail?.hasDub) && (
          <div style={{ position: "absolute", bottom: pct > 0 && pct < 90 ? 8 : 6, left: 6, display: "flex", gap: 4 }}>
            {avail.hasSub && (
              <span className="mono" style={{ fontSize: 8, padding: "2px 5px", borderRadius: 3, background: "var(--sub-badge-bg)", color: "#fff", fontWeight: 700, letterSpacing: 0.5 }}>SUB</span>
            )}
            {avail.hasDub && (
              <span className="mono" style={{ fontSize: 8, padding: "2px 5px", borderRadius: 3, background: "var(--dub-badge-bg)", color: "#000", fontWeight: 700, letterSpacing: 0.5 }}>DUB</span>
            )}
          </div>
        )}
        {pct > 0 && pct < 90 && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: "rgba(255,255,255,0.2)" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
          </div>
        )}
      </div>

      {/* Title + description */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{ep.title}</h4>
          {isNext && (
            <span className="mono" style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "var(--accent)", color: "#fff", fontWeight: 700, letterSpacing: 1 }}>
              NEXT UP
            </span>
          )}
        </div>
        {ep.description && (
          <p className="clip-2" style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>{ep.description}</p>
        )}
        <div className="mono" style={{ fontSize: 10, color: "var(--dim)", marginTop: 8, letterSpacing: 0.5, display: "flex", gap: 12 }}>
          {ep.seasonNumber
            ? <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Calendar size={10} /> S{ep.seasonNumber} · E{ep.episodeInSeason ?? ep.number}</span>
            : <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Calendar size={10} /> Episode {ep.number}</span>
          }
          {durationMin && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Clock size={10} /> {durationMin}m</span>}
        </div>
      </div>

      {/* Watch status toggle (only for internal, non-external episodes) */}
      {!isExternal && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleWatched?.(); }}
          aria-label={watched ? `Mark episode ${ep.number} as unwatched` : `Mark episode ${ep.number} as watched`}
          title={watched ? "Mark as unwatched" : "Mark as watched"}
          style={{
            width: 28, height: 28, borderRadius: 4,
            border: "1px solid var(--line-2)",
            background: watched ? "var(--seen-soft)" : "var(--surf)",
            color: watched ? "var(--seen-text)" : "var(--dim)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: onToggleWatched ? "pointer" : "default",
            transition: "background 160ms, color 160ms",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (!onToggleWatched) return;
            (e.currentTarget as HTMLButtonElement).style.background = watched ? "var(--danger-soft)" : "var(--seen-soft)";
            (e.currentTarget as HTMLButtonElement).style.color = watched ? "var(--danger-text)" : "var(--seen-text)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = watched ? "var(--seen-soft)" : "var(--surf)";
            (e.currentTarget as HTMLButtonElement).style.color = watched ? "var(--seen-text)" : "var(--dim)";
          }}
        >
          {watched ? <Check size={12} /> : <Clock size={12} />}
        </button>
      )}
    </div>
  );
}
