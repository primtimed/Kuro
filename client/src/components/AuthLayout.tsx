import { useEffect, useState, type ReactNode } from "react";

import { api } from "../lib/api";
import { AnimeCover } from "../lib/procedural";

const WALL_TILES = 40;
// Used when the cover art can't load (offline, AniList down): Kuro's generated covers instead.
const FALLBACK_TITLES = [
  "Kuro", "Midnight Signal", "Crimson Tide", "Paper Moon", "Neon Ronin", "Starfall", "Blue Hour",
  "Ember", "Hollow Sky", "Lantern", "Vermilion", "Afterglow",
];

/**
 * Split sign-in layout: a tilted wall of trending covers on one side (a strip on top on phones)
 * and the form on the other. Shared by the sign-in and invite pages.
 */
export function AuthLayout({ caption, children }: { caption?: ReactNode; children: ReactNode }) {
  const [posters, setPosters] = useState<string[] | null>(null);

  useEffect(() => {
    api.signInArt()
      .then((art) => setPosters(art.posters))
      .catch((err: unknown) => {
        console.error("[sign-in] loading cover art failed:", err);
        setPosters([]);
      });
  }, []);

  const tiles = Array.from({ length: WALL_TILES }, (_, i) => i);

  return (
    <main className="auth-split">
      <section className="auth-art" aria-hidden="true">
        <div className="auth-wall">
          {posters !== null && tiles.map((i) => (
            <div key={i} className="auth-wall-tile">
              {posters.length > 0
                ? <img src={posters[i % posters.length]} alt="" loading="lazy" />
                : <AnimeCover title={FALLBACK_TITLES[i % FALLBACK_TITLES.length]} w={160} h={240} />}
            </div>
          ))}
        </div>
        <div className="auth-art-fade" />
        {caption && <div className="auth-caption">{caption}</div>}
      </section>

      <section className="auth-pane">
        <div className="auth-card">
          <svg width="52" height="52" viewBox="0 0 32 32" role="img" aria-label="Kuro" style={{ display: "block", filter: "drop-shadow(0 8px 20px var(--accent-glow))" }}>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M9 8 L9 24 L13 24 L13 16 L19 24 L23 24 L17 15.5 L23 8 L19 8 L13 14.5 L13 8 Z" fill="var(--text)" />
          </svg>
          {children}
        </div>
      </section>
    </main>
  );
}
