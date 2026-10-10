import { useState } from "react";
import { Link } from "react-router-dom";

import type { Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";
import { toFormatLabel } from "../lib/utils";

export interface TrendingTab {
  label: string;
  items: Media[];
  loading?: boolean;
}

const VISIBLE_COUNT = 8;

export function TrendingPanel({ tabs }: { tabs: TrendingTab[] }) {
  const [activeTab, setActiveTab] = useState(0);
  const tab = tabs[activeTab];

  return (
    <section className="panel" aria-labelledby="top-trending">
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 14 }}>
        <h2 id="top-trending" style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: 1.05 }}>
          Top<br />Trending
        </h2>
        <div role="tablist" aria-label="Trending period" style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {tabs.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={i === activeTab}
              className="panel-tab"
              onClick={() => setActiveTab(i)}
            >
              {t.label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ol role="tabpanel" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {tab.loading
          ? Array.from({ length: 6 }).map((_, i) => (
            <li key={i} style={{ height: 76, borderRadius: 8, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
          ))
          : tab.items.slice(0, VISIBLE_COUNT).map((m, i) => (
            <li key={m.id}>
              <Link
                to={`/title/${encodeURIComponent(m.id)}`}
                className="trend-row"
                style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 14,
                  height: 76, padding: "0 14px", borderRadius: 8, overflow: "hidden", background: "var(--surf-2)",
                }}
              >
                <div className="trend-row-art" style={{
                  position: "absolute", top: 0, right: 0, bottom: 0, width: "60%", opacity: 0.5,
                  maskImage: "linear-gradient(to right, transparent, black)",
                  WebkitMaskImage: "linear-gradient(to right, transparent, black)",
                  transition: "opacity 150ms",
                }}>
                  {(m.banner || m.poster)
                    ? <img src={m.banner ?? m.poster} alt="" loading="lazy" width={200} height={76} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : <AnimeCover title={m.title} w={200} h={76} />}
                </div>
                <span aria-hidden="true" style={{
                  position: "relative", width: 34, flexShrink: 0,
                  fontSize: 36, fontWeight: 900, fontStyle: "italic", lineHeight: 1,
                  color: i === 0 ? "var(--accent)" : "transparent",
                  WebkitTextStroke: i === 0 ? undefined : "1.5px var(--muted)",
                }}>
                  {i + 1}
                </span>
                <span style={{ position: "relative", minWidth: 0 }}>
                  <span className="clip-1" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>
                    <span className="sr-only">#{i + 1} </span>{m.title}
                  </span>
                  <span style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
                    {m.rating && <span style={{ color: "var(--rating)" }}>★ {m.rating.toFixed(1)}</span>}
                    {toFormatLabel(m) && <span>{toFormatLabel(m)}</span>}
                    {m.totalEpisodes && <span>{m.totalEpisodes} eps</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
      </ol>
    </section>
  );
}
