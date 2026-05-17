import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Search as SearchIcon, X } from "lucide-react";
import type { Media } from "../lib/types";
import { Card, CardSkeleton } from "../components/Card";
import { Row } from "../components/Row";
import { api } from "../lib/api";
import { useMediaMode } from "../context/MediaModeContext";
import { useIsMobile } from "../hooks/useIsMobile";

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

  useEffect(() => {
    setLoading(true);
    setAllItems([]);
    const fetchFn = genre
      ? () => (mode === "tv" ? api.tv.genre(genre) : api.genre(genre))
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
          showAudio={false}
        />

        {!loading && hasFilters && (
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

        {loading ? (
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

function MainBrowse() {
  const navigate = useNavigate();
  const { mode } = useMediaMode();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [audio, setAudio] = useState<Audio>("");
  const [results, setResults] = useState<Media[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [row1, setRow1] = useState<Media[]>([]);
  const [row2, setRow2] = useState<Media[]>([]);
  const [row1Loading, setRow1Loading] = useState(true);
  const [row2Loading, setRow2Loading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRow1([]);
    setRow2([]);
    setRow1Loading(true);
    setRow2Loading(true);
    setResults([]);
    setHasSearched(false);
    setQuery("");
    setFormat("");
    setAudio("");

    if (mode === "tv") {
      api.tv.trending().then(setRow1).catch(() => {}).finally(() => setRow1Loading(false));
      api.tv.onAir().then(setRow2).catch(() => {}).finally(() => setRow2Loading(false));
    } else {
      api.trending().then(setRow1).catch(() => {}).finally(() => setRow1Loading(false));
      api.seasonal().then(setRow2).catch(() => {}).finally(() => setRow2Loading(false));
    }
  }, [mode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    const effectiveQuery = mode === "anime" && audio === "dub" ? `${q} dub`.trim() : q;
    if (!effectiveQuery && !format) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      const searchFn = mode === "tv"
        ? () => api.tv.search(effectiveQuery)
        : () => api.search(effectiveQuery, format || undefined);
      searchFn()
        .then((r) => { setResults(r); setHasSearched(true); })
        .catch(() => setResults([]))
        .finally(() => setSearchLoading(false));
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, format, audio, mode]);

  const isSearchMode = !!query.trim() || (mode === "anime" && !!format);
  const browseGenres = mode === "tv" ? TV_BROWSE_GENRES : ANIME_BROWSE_GENRES;
  const row1Label = mode === "tv" ? "Popular Shows" : "Trending Now";
  const row2Label = mode === "tv" ? "On Air Today" : "This Season";
  const row1Path = "/browse/trending";
  const row2Path = mode === "tv" ? "/browse/onair" : "/browse/seasonal";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: 88 }}>
      <div style={{ padding: isMobile ? "70px 16px 0" : "104px 32px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 28 }}>
          <span style={{ width: 3, height: 20, borderRadius: 2, background: "var(--accent)", flexShrink: 0 }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Browse</h1>
        </div>

        <FilterBar
          query={query}
          format={format}
          audio={audio}
          onQueryChange={setQuery}
          onFormatChange={setFormat}
          onAudioChange={setAudio}
          inputRef={inputRef}
          showAudio={mode === "anime"}
          showFormat={mode === "anime"}
        />

        {/* Genre chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 32 }}>
          {browseGenres.map((g) => (
            <button
              key={g}
              onClick={() => navigate(`/genre/${encodeURIComponent(g)}`)}
              style={{
                padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: "var(--surf)", color: "var(--muted)",
                border: "1px solid var(--line-2)", cursor: "pointer",
                transition: "border-color 150ms, color 150ms",
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.borderColor = "var(--accent)";
                b.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.borderColor = "var(--line-2)";
                b.style.color = "var(--muted)";
              }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {isSearchMode || hasSearched ? (
        <div style={{ padding: isMobile ? "0 16px" : "0 32px" }}>
          {searchLoading ? (
            <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px" }}>
              {Array.from({ length: 20 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : results.length > 0 ? (
            <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: "24px 16px" }}>
              {results.map((m) => <Card key={m.id} media={m} />)}
            </div>
          ) : hasSearched ? (
            <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
              No results — try a different search or filter.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Row title={row1Label} items={row1} loading={row1Loading} ranked seeAllTo={row1Path} />
          <Row title={row2Label} items={row2} loading={row2Loading} seeAllTo={row2Path} />
        </>
      )}
    </div>
  );
}

export function Browse() {
  const { category, genre } = useParams<{ category?: string; genre?: string }>();

  if (category || genre) return <CategoryBrowse category={category} genre={genre} />;
  return <MainBrowse />;
}
