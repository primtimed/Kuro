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
