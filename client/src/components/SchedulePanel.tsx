import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { ScheduleEntry } from "../lib/types";
import { api } from "../lib/api";
import { AnimeCover } from "../lib/procedural";

interface SchedulePanelProps {
  /** "panel" is the compact home sidebar; "page" is the full /schedule view. */
  variant?: "panel" | "page";
  /** Lets the home page hold this request until its critical rows have loaded. */
  isEnabled?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PANEL_ROW_LIMIT = 10;
const DEFAULT_EPISODE_MINUTES = 24;

export function SchedulePanel({ variant = "panel", isEnabled = true }: SchedulePanelProps) {
  const isPage = variant === "page";
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const today = startOfDay(now);
  // Yesterday first so late-night airings that just finished are still reachable.
  const days = useMemo(
    () => Array.from({ length: isPage ? 7 : 5 }, (_, i) => today - DAY_MS + i * DAY_MS),
    [today, isPage],
  );
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(Date.now()));

  useEffect(() => {
    if (!isEnabled) return;
    api.schedule()
      .then(setEntries)
      .catch((err: unknown) => {
        console.error("[schedule] loading failed:", err);
        setHasError(true);
      });
  }, [isEnabled]);

  // Keeps the "airing now" badge honest without a reload.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dayEntries = (entries ?? []).filter((e) => {
    const ms = e.airingAt * 1000;
    return ms >= selectedDay && ms < selectedDay + DAY_MS;
  });
  const visible = isPage ? dayEntries : dayEntries.slice(0, PANEL_ROW_LIMIT);
  const clock = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <section className={isPage ? undefined : "panel"} aria-labelledby="schedule-heading">
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 14 }}>
        <h2 id="schedule-heading" style={{ margin: 0, fontSize: isPage ? 28 : 20, fontWeight: 800 }}>
          {isPage ? "Airing Schedule" : "Schedule"}
        </h2>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--dim)", fontSize: 11 }}>
          {Intl.DateTimeFormat().resolvedOptions().timeZone} · {clock}
        </span>
      </div>

      <div role="tablist" aria-label="Day" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {days.map((day) => {
          const date = new Date(day);
          const isSelected = day === selectedDay;
          return (
            <button
              key={day}
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelectedDay(day)}
              style={{
                flex: 1, minHeight: 52, borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: isSelected ? "var(--accent)" : "var(--surf-2)",
                color: isSelected ? "var(--text)" : "var(--dim)",
              }}
            >
              {date.toLocaleDateString([], { weekday: "short" }).toUpperCase()}
              <span style={{ display: "block", fontSize: 16, color: "var(--text)", marginTop: 2 }}>{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-live="polite">
        {hasError && <p style={{ margin: "12px 0", color: "var(--dim)", fontSize: 13 }}>Schedule is unavailable right now.</p>}

        {!hasError && entries === null && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ height: 22, margin: "12px 0", borderRadius: 4, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
        ))}

        {entries !== null && visible.length === 0 && (
          <p style={{ margin: "12px 0", color: "var(--dim)", fontSize: 13 }}>Nothing airs on this day.</p>
        )}

        {visible.map((e) => {
          const startMs = e.airingAt * 1000;
          const endMs = startMs + (e.media.duration ?? DEFAULT_EPISODE_MINUTES) * 60_000;
          const isAiring = now >= startMs && now < endMs;
          const hasAired = now >= endMs;
          return (
            <Link
              key={`${e.media.id}:${e.episode}`}
              to={`/title/${encodeURIComponent(e.media.id)}`}
              className="list-row"
              style={{
                display: "flex", alignItems: "center", gap: 12,
                minHeight: isPage ? 72 : 44, padding: isPage ? "8px 10px" : "0 4px",
                borderBottom: "1px dashed var(--line)", borderRadius: isPage ? 6 : 0,
                opacity: hasAired ? 0.6 : 1,
              }}
            >
              <span className="mono" style={{ width: 44, flexShrink: 0, fontSize: 12, color: isAiring ? "var(--accent-hi)" : "var(--dim)" }}>
                {new Date(startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
              {isPage && (
                <span style={{ width: 40, height: 56, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
                  {e.media.poster
                    ? <img src={e.media.poster} alt="" loading="lazy" width={40} height={56} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : <AnimeCover title={e.media.title} w={40} h={56} />}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="clip-1" style={{ fontSize: isPage ? 14 : 13, fontWeight: isAiring ? 700 : 500 }}>{e.media.title}</span>
                {isPage && e.media.genres.length > 0 && (
                  <span className="clip-1" style={{ fontSize: 12, color: "var(--dim)", marginTop: 3 }}>{e.media.genres.slice(0, 3).join(" · ")}</span>
                )}
              </span>
              {isAiring
                ? <span style={{
                    fontSize: 9.5, fontWeight: 900, letterSpacing: 1.5, padding: "3px 7px", borderRadius: 3,
                    background: "var(--accent)", color: "var(--text)", animation: "airing-pulse 2s infinite",
                  }}>AIRING</span>
                : <span className="mono" style={{ fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>EP {e.episode}</span>}
            </Link>
          );
        })}

        {!isPage && dayEntries.length > PANEL_ROW_LIMIT && (
          <Link to="/schedule" className="mono" style={{ display: "block", marginTop: 12, fontSize: 11, letterSpacing: 1, color: "var(--accent-hi)", textAlign: "right" }}>
            +{dayEntries.length - PANEL_ROW_LIMIT} MORE · FULL SCHEDULE →
          </Link>
        )}
      </div>
    </section>
  );
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
