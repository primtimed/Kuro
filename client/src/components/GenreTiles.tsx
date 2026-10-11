import type { Media } from "../lib/types";

const TILE_ART_COUNT = 3;

/**
 * Picks poster art for a genre tile from titles already on the page, so the tiles cost no
 * extra requests. Genres with too few matches are topped up with other posters, offset per
 * genre so neighbouring tiles don't repeat the same art.
 */
export function pickGenreArt(pool: Media[], genres: string[], genre: string): string[] {
  const withPoster = pool.filter((m) => m.poster);
  const matches = withPoster.filter((m) => m.genres.includes(genre)).slice(0, TILE_ART_COUNT);
  const offset = genres.indexOf(genre) * TILE_ART_COUNT;
  const fill = withPoster.filter((m) => !matches.includes(m));
  while (matches.length < TILE_ART_COUNT && fill.length > 0) {
    matches.push(fill[(offset + matches.length) % fill.length]);
  }
  return matches.map((m) => m.poster);
}

interface GenreTilesProps {
  genres: string[];
  activeGenre: string;
  onSelect: (genre: string) => void;
  /** Up to three poster URLs per genre, fanned out on the tile. */
  artFor: (genre: string) => string[];
}

export function GenreTiles({ genres, activeGenre, onSelect, artFor }: GenreTilesProps) {
  return (
    <div role="group" aria-label="Genres" className="genre-tiles">
      {genres.map((g, i) => (
        <button
          key={g}
          className="genre-tile"
          aria-pressed={activeGenre === g}
          onClick={() => onSelect(g)}
        >
          <span className="genre-tile-art" aria-hidden="true" style={{ position: "absolute", top: -6, right: -10, bottom: -6, display: "flex" }}>
            {artFor(g).map((src) => <img key={src} src={src} alt="" loading="lazy" width={66} height={132} />)}
          </span>
          <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, var(--surf) 30%, transparent 80%)" }} />
          <span className="mono" aria-hidden="true" style={{ position: "absolute", left: 16, top: 12, fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "var(--dim)" }}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span style={{ position: "absolute", left: 16, bottom: 12, fontSize: 18, fontWeight: 800 }}>{g}</span>
        </button>
      ))}
    </div>
  );
}
