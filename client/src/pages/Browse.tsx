import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Search as SearchIcon, X } from "lucide-react";
import type { Media } from "../lib/types";
import { Card, CardSkeleton } from "../components/Card";
import { Row } from "../components/Row";
import { api } from "../lib/api";
import { useMediaMode } from "../context/MediaModeContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { useBrowseSearch } from "../hooks/useBrowseSearch";
import { BrowseHero } from "../components/BrowseHero";
import { GenreTiles } from "../components/GenreTiles";

// ── Constants ────────────────────────────────────────────────────────────────

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy",
  "Horror", "Mecha", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

const FORMATS = [
  { label: "All", value: "" },
  { label: "TV", value: "TV" },
  { label: "Movie", value: "MOVIE" },
  { label: "OVA", value: "OVA" },
  { label: "ONA", value: "ONA" },
  { label: "Special", value: "SPECIAL" },
];

type Audio = "sub" | "dub" | "";

// ── Helpers ──────────────────────────────────────────────────────────────────

function matchesFormat(mediaFormat: string | undefined, filterFormat: string): boolean {
  if (!filterFormat || !mediaFormat) return false;
  if (filterFormat === "TV") return mediaFormat === "TV" || mediaFormat === "TV_SHORT";
  return mediaFormat === filterFormat;
}

function titleMatches(item: Media, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    item.title.toLowerCase().includes(lower) ||
    (item.altTitles?.some((t) => t.toLowerCase().includes(lower)) ?? false)
  );
}

/**
 * Returns a match count for how many active filters this item satisfies.
 * Used to sort items: all-matching first, then partial matches.
 */
function matchScore(item: Media, query: string, format: string): number {
  let score = 0;
  if (query) score += titleMatches(item, query) ? 1 : 0;
  if (format) score += matchesFormat(item.mediaFormat, format) ? 1 : 0;
  return score;
}

function activeFilterCount(query: string, format: string): number {
  return (query ? 1 : 0) + (format ? 1 : 0);
}

/** Apply multi-filter with scoring. Items matching all filters first, partial matches after. */
function applyFilters(items: Media[], query: string, format: string): Media[] {
  const total = activeFilterCount(query, format);
  if (total === 0) return items;

  return [...items]
    .map((item) => ({ item, score: matchScore(item, query, format) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

// ── Shared filter bar ─────────────────────────────────────────────────────────

interface FilterBarProps {
  query: string;
  format: string;
  audio: Audio;
  onQueryChange: (q: string) => void;
  onFormatChange: (f: string) => void;
  onAudioChange: (a: Audio) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  showAudio?: boolean;
  showFormat?: boolean;
}

function FilterBar({
  query, format, audio,
  onQueryChange, onFormatChange, onAudioChange,
  inputRef: externalRef,
  showAudio = true,
  showFormat = true,
}: FilterBarProps) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const ref = externalRef ?? internalRef;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <SearchIcon
          size={20}
          style={{
            position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)",
            color: "var(--dim)", pointerEvents: "none",
          }}
        />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search for anime, movies, OVAs…"
          style={{
            width: "100%", background: "var(--surf)", border: "1px solid var(--line-2)",
            color: "var(--text)", paddingLeft: 52, paddingRight: query ? 44 : 20,
            paddingTop: 16, paddingBottom: 16,
            borderRadius: 12, fontSize: 17, outline: "none", fontFamily: "inherit",
            boxSizing: "border-box", transition: "border-color 150ms, box-shadow 150ms",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(229,9,20,0.15)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--line-2)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {query && (
          <button
            onClick={() => { onQueryChange(""); ref.current?.focus(); }}
            aria-label="Clear search"
            style={{
              position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
              color: "var(--dim)", display: "flex", alignItems: "center", padding: 4,
              borderRadius: 4, transition: "color 120ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--muted)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Format + Audio row */}
      {(showFormat || showAudio) && (
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {showFormat && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FORMATS.map((f) => (
            <button
              key={f.value}
              onClick={() => onFormatChange(f.value)}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: format === f.value ? "var(--accent)" : "var(--surf-2)",
                color: format === f.value ? "#fff" : "var(--muted)",
                border: `1px solid ${format === f.value ? "var(--accent)" : "var(--line-2)"}`,
                cursor: "pointer", transition: "all 120ms", whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>}

        {showAudio && showFormat && (
          <div style={{ width: 1, height: 24, background: "var(--line-2)", flexShrink: 0 }} />
        )}
        {showAudio && (
          <div style={{ display: "flex", gap: 6 }}>
              {(["sub", "dub"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => onAudioChange(audio === a ? "" : a)}
                  className="mono"
                  style={{
                    padding: "6px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                    background: audio === a ? (a === "sub" ? "rgba(129,140,248,0.15)" : "rgba(251,191,36,0.15)") : "var(--surf-2)",
                    color: audio === a ? (a === "sub" ? "#818cf8" : "#fbbf24") : "var(--dim)",
                    border: `1px solid ${audio === a ? (a === "sub" ? "rgba(129,140,248,0.45)" : "rgba(251,191,36,0.45)") : "var(--line-2)"}`,
                    cursor: "pointer", transition: "all 120ms",
                  }}
                >
                  {a.toUpperCase()}
                </button>
              ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── Active filter badges ──────────────────────────────────────────────────────

function ActiveFilters({
  query, format, audio, total, shown,
  onClearQuery, onClearFormat, onClearAudio,
}: {
  query: string; format: string; audio: Audio; total: number; shown: number;
  onClearQuery: () => void; onClearFormat: () => void; onClearAudio: () => void;
}) {
  const hasAny = query || format || audio;
  if (!hasAny) return null;

  const formatLabel = FORMATS.find((f) => f.value === format)?.label;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "var(--dim)" }}>
        {shown} of {total} results
      </span>
      {query && (
        <Pill label={`"${query}"`} onRemove={onClearQuery} />
      )}
      {format && (
        <Pill label={formatLabel ?? format} onRemove={onClearFormat} />
      )}
      {audio && (
        <Pill label={audio.toUpperCase()} onRemove={onClearAudio} color={audio === "sub" ? "#818cf8" : "#fbbf24"} />
      )}
    </div>
  );
}

function Pill({ label, onRemove, color }: { label: string; onRemove: () => void; color?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px 3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: color ? `${color}18` : "var(--surf-2)",
      color: color ?? "var(--muted)",
      border: `1px solid ${color ? `${color}44` : "var(--line-2)"}`,
    }}>
      {label}
      <button
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        style={{ display: "flex", alignItems: "center", color: "inherit", opacity: 0.7 }}
      >
        <X size={10} />
      </button>
    </span>
  );
}

// ── Category/Genre full-grid browse ──────────────────────────────────────────

const ANIME_CATEGORIES: Record<string, { title: string; fetch: () => Promise<Media[]> }> = {
  trending: { title: "Trending Now", fetch: () => api.trending() },
  seasonal: { title: "This Season", fetch: () => api.seasonal() },
  recommended: { title: "Recommended For You", fetch: () => api.library.recommendations() },
  "new-seasons": { title: "New Seasons — From Your List", fetch: () => api.library.newSeasons() },
};

const TV_CATEGORIES: Record<string, { title: string; fetch: () => Promise<Media[]> }> = {
  trending: { title: "Popular Shows", fetch: () => api.tv.trending() },
  onair: { title: "On Air Today", fetch: () => api.tv.onAir() },
};

function CategoryBrowse({ category, genre }: { category?: string; genre?: string }) {
  const { mode } = useMediaMode();
  const isMobile = useIsMobile();
  const categories = mode === "tv" ? TV_CATEGORIES : ANIME_CATEGORIES;
  const config = category ? categories[category] : undefined;
  const [allItems, setAllItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [audio, setAudio] = useState<Audio>("");
  // Anime genres page through the server (AniList or the sub/dub catalog); TV genres and
  // categories are fixed lists filtered client-side.
  const isPagedGenre = !!genre && mode === "anime";
  const search = useBrowseSearch({ mode, query, format, audio, genre: genre ?? "", isEnabled: isPagedGenre });

  useEffect(() => {
    setLoading(true);
    setAllItems([]);
    const fetchFn = isPagedGenre ? undefined
      : genre ? () => api.tv.genre(genre)
      : config?.fetch;
    if (!fetchFn) return;
    fetchFn()
      .then(setAllItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category, genre, mode]);

  const title = genre ?? config?.title ?? "Browse";
  const filtered = applyFilters(allItems, query, format);
  const hasFilters = !!(query || format);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", paddingTop: isMobile ? 70 : 80, paddingBottom: 88 }}>
      <div style={{ padding: isMobile ? "0 16px 16px" : "0 32px 32px" }}>
        <Link
          to="/browse"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            color: "var(--muted)", textDecoration: "none", fontSize: 13,
            marginBottom: 24, transition: "color 150ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
        >
          <ChevronLeft size={15} /> Browse
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 24 }}>
          <span style={{ width: 3, height: 20, borderRadius: 2, background: "var(--accent)", flexShrink: 0 }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h1>
        </div>

        <FilterBar
          query={query}
          format={format}
          audio={audio}
          onQueryChange={setQuery}
          onFormatChange={setFormat}
          onAudioChange={setAudio}
          showAudio={isPagedGenre}
        />

        {!isPagedGenre && !loading && hasFilters && (
          <ActiveFilters
            query={query}
            format={format}
            audio={audio}
            total={allItems.length}
            shown={filtered.length}
            onClearQuery={() => setQuery("")}
            onClearFormat={() => setFormat("")}
            onClearAudio={() => setAudio("")}
          />
        )}

        {isPagedGenre ? (
          <PagedResults search={search} />
        ) : loading ? (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px" }}>
            {Array.from({ length: 20 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px" }}>
            {filtered.map((m) => <Card key={m.id} media={m} />)}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 80 }}>
            {hasFilters ? "No results match your filters." : "Nothing here yet."}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Paged results (infinite scroll) ─────────────────────────────────────────

function PagedResults({ search }: { search: ReturnType<typeof useBrowseSearch> }) {
  if (search.isLoading) {
    return (
      <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px" }}>
        {Array.from({ length: 20 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    );
  }
  if (search.results.length === 0) {
    return search.hasSearched ? (
      <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
        No results — try a different search or filter.
      </p>
    ) : null;
  }
  return (
    <>
      <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px" }}>
        {search.results.map((m) => <Card key={m.id} media={m} />)}
        {search.isLoadingMore && Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={`more-${i}`} />)}
      </div>
      {search.hasMore && <div ref={search.sentinelRef} aria-hidden style={{ height: 1 }} />}
    </>
  );
}

// ── Main browse ──────────────────────────────────────────────────────────────

const ANIME_BROWSE_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy",
  "Horror", "Mecha", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

const TV_BROWSE_GENRES = [
  "Action", "Adventure", "Comedy", "Crime", "Drama",
  "Fantasy", "History", "Horror", "Mystery", "Romance",
  "Science-Fiction", "Supernatural", "Thriller", "Western",
];

const TILE_ART_COUNT = 3;
const TRENDING_GRID_COUNT = 14;

function MainBrowse() {
  const navigate = useNavigate();
  const { mode } = useMediaMode();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [audio, setAudio] = useState<Audio>("");
  const [genre, setGenre] = useState("");
  const [row1, setRow1] = useState<Media[]>([]);
  const [row2, setRow2] = useState<Media[]>([]);
  const [row1Loading, setRow1Loading] = useState(true);
  const [row2Loading, setRow2Loading] = useState(true);
  const search = useBrowseSearch({ mode, query, format, audio, genre });
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRow1([]);
    setRow2([]);
    setRow1Loading(true);
    setRow2Loading(true);
    setQuery("");
    setFormat("");
    setAudio("");
    setGenre("");

    const logError = (what: string) => (err: unknown) => console.error(`[browse] loading ${what} failed:`, err);
    if (mode === "tv") {
      api.tv.trending().then(setRow1).catch(logError("popular shows")).finally(() => setRow1Loading(false));
      api.tv.onAir().then(setRow2).catch(logError("on-air shows")).finally(() => setRow2Loading(false));
    } else {
      api.trending().then(setRow1).catch(logError("trending")).finally(() => setRow1Loading(false));
      api.seasonal().then(setRow2).catch(logError("seasonal")).finally(() => setRow2Loading(false));
    }
  }, [mode]);

  const browseGenres = mode === "tv" ? TV_BROWSE_GENRES : ANIME_BROWSE_GENRES;
  const row1Label = mode === "tv" ? "Popular Shows" : "Trending Now";
  const row2Label = mode === "tv" ? "On Air Today" : "This Season";
  const row1Path = "/browse/trending";
  const row2Path = mode === "tv" ? "/browse/onair" : "/browse/seasonal";
  const pad = isMobile ? 16 : 32;

  const pool = [...row1, ...row2.filter((m) => !row1.some((r) => r.id === m.id))].filter((m) => m.poster);

  // Tile art comes from titles already on the page, so the tiles cost no extra requests.
  function artFor(g: string): string[] {
    const matches = pool.filter((m) => m.genres.includes(g)).slice(0, TILE_ART_COUNT);
    const offset = browseGenres.indexOf(g) * TILE_ART_COUNT;
    const fill = pool.filter((m) => !matches.includes(m));
    while (matches.length < TILE_ART_COUNT && fill.length > 0) {
      matches.push(fill[(offset + matches.length) % fill.length]);
    }
    return matches.map((m) => m.poster);
  }

  function scrollToResults() {
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function handleGenreSelect(g: string) {
    // TV genres have their own page; anime genres filter in place so they combine with search, type and audio.
    if (mode === "tv") {
      navigate(`/genre/${encodeURIComponent(g)}`);
      return;
    }
    const next = genre === g ? "" : g;
    setGenre(next);
    if (next) scrollToResults();
  }

  function clearAll() {
    setQuery("");
    setFormat("");
    setAudio("");
    setGenre("");
  }

  const formatLabel = FORMATS.find((f) => f.value === format)?.label;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: `8px ${pad}px 88px` }}>
      <BrowseHero
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => { inputRef.current?.blur(); scrollToResults(); }}
        inputRef={inputRef}
        collage={pool.map((m) => m.poster)}
        placeholder={mode === "tv" ? "Search TV series…" : "Search anime, movies, OVAs…"}
        {...(mode === "anime" ? {
          formats: FORMATS, format, onFormatChange: setFormat,
          audio, onAudioChange: setAudio,
        } : {})}
      />

      <section aria-labelledby="genres-heading" style={{ marginBottom: isMobile ? 32 : 44 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
          <SectionTitle id="genres-heading">Genres</SectionTitle>
          {!isMobile && (
            <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--dim)" }}>
              {mode === "tv" ? "Opens the genre" : "Pick one to filter — combines with search & type"}
            </span>
          )}
        </div>
        <GenreTiles genres={browseGenres} activeGenre={genre} onSelect={handleGenreSelect} artFor={artFor} />
      </section>

      {/* Full-height while filtering so the scroll to results lands before the first page arrives. */}
      <div ref={resultsRef} style={{ scrollMarginTop: 90, minHeight: search.isActive ? "100vh" : undefined }}>
        {search.isActive ? (
          <section aria-labelledby="results-heading">
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
              <SectionTitle id="results-heading">{genre || "Results"}</SectionTitle>
              {query && <Pill label={`"${query}"`} onRemove={() => setQuery("")} />}
              {format && <Pill label={formatLabel ?? format} onRemove={() => setFormat("")} />}
              {audio && <Pill label={audio.toUpperCase()} onRemove={() => setAudio("")} />}
              {genre && <Pill label={genre} onRemove={() => setGenre("")} />}
              <button onClick={clearAll} style={{ minHeight: 32, padding: "0 6px", fontSize: 12, color: "var(--dim)" }}>
                Clear all
              </button>
            </div>
            <PagedResults search={search} />
          </section>
        ) : (
          <>
            <section aria-labelledby="trending-heading" style={{ marginBottom: isMobile ? 32 : 52 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <SectionTitle id="trending-heading">{row1Label}</SectionTitle>
                <Link to={row1Path} className="mono" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "var(--accent-hi)" }}>
                  SEE ALL →
                </Link>
              </div>
              <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px", justifyContent: "space-between" }}>
                {row1Loading
                  ? Array.from({ length: TRENDING_GRID_COUNT }).map((_, i) => <CardSkeleton key={i} />)
                  : row1.slice(0, TRENDING_GRID_COUNT).map((m) => <Card key={m.id} media={m} />)}
              </div>
            </section>
            <div style={{ margin: `0 -${pad}px` }}>
              <Row title={row2Label} items={row2} loading={row2Loading} seeAllTo={row2Path} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} style={{
      margin: 0, paddingLeft: 12, borderLeft: "4px solid var(--accent)",
      fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1,
    }}>
      {children}
    </h2>
  );
}

export function Browse() {
  const { category, genre } = useParams<{ category?: string; genre?: string }>();

  if (category || genre) return <CategoryBrowse category={category} genre={genre} />;
  return <MainBrowse />;
}
