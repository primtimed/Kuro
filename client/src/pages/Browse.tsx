import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ChevronLeft, X } from "lucide-react";
import type { Media } from "../lib/types";
import { Card, CardSkeleton } from "../components/Card";
import { Row } from "../components/Row";
import { api } from "../lib/api";
import { useMediaMode } from "../context/MediaModeContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { useBrowseSearch } from "../hooks/useBrowseSearch";
import { BrowseHero } from "../components/BrowseHero";
import { GenreTiles, pickGenreArt } from "../components/GenreTiles";

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
  const navigate = useNavigate();
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
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setAllItems([]);
    const fetchFn = isPagedGenre ? undefined
      : genre ? () => api.tv.genre(genre)
      : config?.fetch;
    if (!fetchFn) return;
    fetchFn()
      .then(setAllItems)
      .catch((err: unknown) => console.error(`[browse] loading ${genre ?? category} failed:`, err))
      .finally(() => setLoading(false));
  }, [category, genre, mode]);

  const title = genre ?? config?.title ?? "Browse";
  const filtered = applyFilters(allItems, query, format);
  const hasFilters = !!(query || format || audio);
  const browseGenres = mode === "tv" ? TV_BROWSE_GENRES : ANIME_BROWSE_GENRES;
  const pool = isPagedGenre ? search.results : allItems;
  const formatLabel = FORMATS.find((f) => f.value === format)?.label;
  const pad = isMobile ? 16 : 32;

  // Last word in red, matching the main Browse banner.
  const titleWords = title.split(" ");
  const lastWord = titleWords.pop();

  function handleGenreSelect(g: string) {
    // Picking the open genre again goes back to the full catalog.
    navigate(g === genre ? "/browse" : `/genre/${encodeURIComponent(g)}`);
  }

  function clearAll() {
    setQuery("");
    setFormat("");
    setAudio("");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: `8px ${pad}px 88px` }}>
      <Link to="/browse" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, marginBottom: 10, fontSize: 13, color: "var(--muted)" }}>
        <ChevronLeft size={15} /> Browse
      </Link>

      <BrowseHero
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => {
          inputRef.current?.blur();
          requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }}
        inputRef={inputRef}
        collage={pool.filter((m) => m.poster).map((m) => m.poster)}
        placeholder={`Search ${title.toLowerCase()}…`}
        eyebrow={genre ? "GENRE" : "BROWSE"}
        title={<>{titleWords.join(" ")}{titleWords.length > 0 && " "}<span style={{ color: "var(--accent)" }}>{lastWord}.</span></>}
        {...(mode === "anime" ? { formats: FORMATS, format, onFormatChange: setFormat } : {})}
        {...(isPagedGenre ? { audio, onAudioChange: setAudio } : {})}
      />

      <section aria-labelledby="genres-heading" style={{ marginBottom: isMobile ? 32 : 44 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
          <SectionTitle id="genres-heading">Genres</SectionTitle>
          {!isMobile && (
            <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--dim)" }}>
              {genre ? "Pick another genre, or the same one to go back" : "Opens the genre"}
            </span>
          )}
        </div>
        <GenreTiles
          genres={browseGenres}
          activeGenre={genre ?? ""}
          onSelect={handleGenreSelect}
          artFor={(g) => pickGenreArt(pool, browseGenres, g)}
        />
      </section>

      <section ref={resultsRef} aria-labelledby="results-heading" style={{ scrollMarginTop: 90 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          <SectionTitle id="results-heading">{title}</SectionTitle>
          {!isPagedGenre && !loading && (
            <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>
              {hasFilters ? `${filtered.length} OF ${allItems.length}` : `${allItems.length} TITLES`}
            </span>
          )}
          {query && <Pill label={`"${query}"`} onRemove={() => setQuery("")} />}
          {format && <Pill label={formatLabel ?? format} onRemove={() => setFormat("")} />}
          {audio && <Pill label={audio.toUpperCase()} onRemove={() => setAudio("")} />}
          {hasFilters && (
            <button onClick={clearAll} style={{ minHeight: 32, padding: "0 6px", fontSize: 12, color: "var(--dim)" }}>
              Clear all
            </button>
          )}
        </div>

        {isPagedGenre ? (
          <PagedResults search={search} />
        ) : loading ? (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px", justifyContent: "space-between" }}>
            {Array.from({ length: 20 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px", justifyContent: "space-between" }}>
            {filtered.map((m) => <Card key={m.id} media={m} />)}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 80 }}>
            {hasFilters ? "No results match your filters." : "Nothing here yet."}
          </p>
        )}
      </section>
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
        <GenreTiles genres={browseGenres} activeGenre={genre} onSelect={handleGenreSelect} artFor={(g) => pickGenreArt(pool, browseGenres, g)} />
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
