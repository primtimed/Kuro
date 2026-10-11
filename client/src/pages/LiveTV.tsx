import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Heart, Search as SearchIcon, Globe, Flag } from "lucide-react";

import { ChannelPreview } from "../components/ChannelPreview";
import { LiveFavoriteButton } from "../components/LiveFavoriteButton";
import { api } from "../lib/api";
import { CATEGORY_ICONS } from "../lib/live-categories";
import { useIsMobile } from "../hooks/useIsMobile";
import { useLiveFavorites } from "../hooks/useLiveFavorites";
import { useMinuteTick } from "../hooks/useMinuteTick";

import type { LiveChannelSummary, LiveFilters } from "../lib/types";

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;
const LANGUAGE_SORT_KEY = "kuro-live-language-sort";

type LanguageSort = "count" | "alphabetical";

function readLanguageSort(): LanguageSort {
  try {
    return localStorage.getItem(LANGUAGE_SORT_KEY) === "alphabetical" ? "alphabetical" : "count";
  } catch {
    return "count";
  }
}

export function LiveTV() {
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get("category") ?? "";
  const language = searchParams.get("language") ?? "";
  const country = searchParams.get("country") ?? "";
  const q = searchParams.get("q") ?? "";
  const isFavoritesOnly = searchParams.get("favorites") === "1";

  const [filters, setFilters] = useState<LiveFilters | null>(null);
  const [hasFiltersError, setHasFiltersError] = useState(false);
  const [channels, setChannels] = useState<LiveChannelSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasChannelsError, setHasChannelsError] = useState(false);
  const [searchInput, setSearchInput] = useState(q);
  const [languageSort, setLanguageSort] = useState<LanguageSort>(readLanguageSort);
  const latestRequestRef = useRef(0);
  const { favoriteIds, toggleFavorite } = useLiveFavorites();
  const [favoriteChannels, setFavoriteChannels] = useState<LiveChannelSummary[]>([]);
  const [isShowingAllGenres, setIsShowingAllGenres] = useState(false);
  const tick = useMinuteTick();

  useEffect(() => {
    api.live.filters()
      .then(setFilters)
      .catch(() => setHasFiltersError(true));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim() !== q) updateParam("q", searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    loadChannels(0);
  }, [category, language, country, q, isFavoritesOnly]);

  // Refetched when the favourite count changes so the row follows hearts pressed on this page.
  useEffect(() => {
    api.live.channels({ favorites: "1", offset: 0, limit: FAVORITES_ROW_SIZE })
      .then((page) => setFavoriteChannels(page.channels))
      .catch((err: unknown) => console.error("[live] loading favourite channels failed:", err));
  }, [favoriteIds.size]);

  function loadChannels(offset: number) {
    // Filters can change faster than responses arrive; only the newest request may update the grid.
    const requestId = ++latestRequestRef.current;
    setIsLoading(true);
    api.live.channels({ category, language, country, q, favorites: isFavoritesOnly ? "1" : undefined, offset, limit: PAGE_SIZE })
      .then((page) => {
        if (requestId !== latestRequestRef.current) return;
        setChannels((prev) => (offset === 0 ? page.channels : [...prev, ...page.channels]));
        setTotal(page.total);
        setHasChannelsError(false);
      })
      .catch(() => { if (requestId === latestRequestRef.current) setHasChannelsError(true); })
      .finally(() => { if (requestId === latestRequestRef.current) setIsLoading(false); });
  }

  function handleToggleFavorite(channelId: string) {
    const isNowFavorite = toggleFavorite(channelId);
    // In the favourites view an un-favourited channel should disappear right away
    if (isFavoritesOnly && !isNowFavorite) {
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      setTotal((t) => Math.max(0, t - 1));
    }
  }

  function updateParam(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  const languageNames = useMemo(
    () => new Map((filters?.languages ?? []).map((l) => [l.code, l.name])),
    [filters]
  );
  // The server sends languages by channel count; A–Z is sorted here so switching is instant.
  const sortedLanguages = useMemo(() => {
    const languages = filters?.languages ?? [];
    return languageSort === "alphabetical"
      ? [...languages].sort((a, b) => a.name.localeCompare(b.name))
      : languages;
  }, [filters, languageSort]);

  function handleLanguageSortChange(sort: LanguageSort) {
    setLanguageSort(sort);
    try { localStorage.setItem(LANGUAGE_SORT_KEY, sort); } catch { /* storage unavailable */ }
  }

  const countryNames = useMemo(
    () => new Map((filters?.countries ?? []).map((c) => [c.code, c.name])),
    [filters]
  );
  const countryFlags = useMemo(
    () => new Map((filters?.countries ?? []).map((c) => [c.code, c.flag])),
    [filters]
  );

  const selectedCategory = filters?.categories.find((c) => c.id === category);
  // The directory lists categories biggest first; the long tail stays folded unless asked for (or selected).
  const visibleCategories = (filters?.categories ?? []).filter((c, i) => isShowingAllGenres || i < GENRE_PREVIEW_COUNT || c.id === category);
  const resultsTitle = isFavoritesOnly ? "Favourites" : q ? `"${q}"` : selectedCategory?.name ?? "All channels";
  const isBrowsingAll = !isFavoritesOnly && !category && !q && !language && !country;
  const wallLogos = [...favoriteChannels, ...channels].map((c) => c.logo).filter((l): l is string => !!l).slice(0, HERO_LOGO_COUNT);
  const pad = isMobile ? 16 : 32;

  const tileFor = (c: LiveChannelSummary) => (
    <ChannelTile
      key={c.id}
      channel={c}
      tick={tick}
      flag={c.country ? countryFlags.get(c.country) : undefined}
      meta={[c.country ? countryNames.get(c.country) : undefined, c.languages.slice(0, 1).map((code) => languageNames.get(code) ?? code)[0]].filter(Boolean).join(" · ")}
      isFavorite={favoriteIds.has(c.id)}
      onToggleFavorite={() => handleToggleFavorite(c.id)}
    />
  );

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: `8px ${pad}px 88px` }}>
      {/* Banner */}
      <section className="live-hero" aria-label="Live TV">
        {wallLogos.length > 0 && (
          <div aria-hidden="true" className="live-hero-wall">
            {Array.from({ length: HERO_WALL_TILES }, (_, i) => wallLogos[i % wallLogos.length]).map((logo, i) => (
              <span key={i}><img src={logo} alt="" loading="lazy" /></span>
            ))}
          </div>
        )}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, var(--bg) 30%, var(--glass-strong) 60%, var(--glass))" }} />

        <div style={{ position: "relative" }}>
          <p className="mono" style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px", fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "var(--accent-hi)" }}>
            <LiveBadge /> FREE TV FROM AROUND THE WORLD
          </p>
          <h1 style={{ margin: 0, fontSize: isMobile ? 34 : 52, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, textTransform: "uppercase" }}>
            Live <span style={{ color: "var(--accent)" }}>TV.</span>
          </h1>

          {filters ? (
            <dl className="live-stats">
              <LiveStat label="CHANNELS" value={filters.total.toLocaleString()} />
              <LiveStat label="COUNTRIES" value={String(filters.countries.length)} />
              <LiveStat label="LANGUAGES" value={String(filters.languages.length)} />
              <LiveStat label="FAVOURITES" value={String(favoriteIds.size)} isFav />
            </dl>
          ) : (
            <p style={{ margin: "14px 0 0", color: "var(--muted)", fontSize: 14 }}>
              {hasFiltersError ? "The live TV directory could not be loaded. It will retry when you reload the page." : "Loading channel directory…"}
            </p>
          )}

          <div className="live-toolbar">
            <label className="live-search">
              <SearchIcon size={16} aria-hidden="true" color="var(--dim)" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search channels…"
                aria-label="Search channels"
              />
            </label>
            <label className="live-select">
              <Globe size={15} aria-hidden="true" />
              <select aria-label="Language" value={language} onChange={(e) => updateParam("language", e.target.value)}>
                <option value="">All languages</option>
                {sortedLanguages.map((l) => (
                  <option key={l.code} value={l.code}>{l.name} ({l.count})</option>
                ))}
              </select>
            </label>
            <div role="group" aria-label="Sort languages" className="seg-group">
              {([{ sort: "count", label: "Most channels" }, { sort: "alphabetical", label: "A–Z" }] as const).map(({ sort, label }) => (
                <button key={sort} className="seg-btn" aria-pressed={languageSort === sort} onClick={() => handleLanguageSortChange(sort)}>{label}</button>
              ))}
            </div>
            <label className="live-select">
              <Flag size={15} aria-hidden="true" />
              <select aria-label="Country" value={country} onChange={(e) => updateParam("country", e.target.value)}>
                <option value="">All countries</option>
                {filters?.countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name} ({c.count})</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => updateParam("favorites", isFavoritesOnly ? "" : "1")}
              aria-pressed={isFavoritesOnly}
              className="live-fav-toggle"
            >
              <Heart size={16} aria-hidden="true" fill={isFavoritesOnly ? "currentColor" : "none"} />
              Favourites
            </button>
          </div>
        </div>
      </section>

      {/* Genres */}
      {filters && (
        <section aria-labelledby="live-genres" style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
            <h2 id="live-genres" className="section-title" style={{ margin: 0 }}>Genres</h2>
            <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{filters.categories.length} CATEGORIES</span>
          </div>
          <div role="group" aria-label="Genres" className="live-genres">
            <GenreTile label="All" count={filters.total} icon="📡" isActive={!category} onClick={() => updateParam("category", "")} />
            {visibleCategories.map((c) => (
              <GenreTile key={c.id} label={c.name} count={c.count} icon={CATEGORY_ICONS[c.id] ?? "📺"} isActive={category === c.id} onClick={() => updateParam("category", c.id)} />
            ))}
            {filters.categories.length > GENRE_PREVIEW_COUNT && (
              <button className="live-genre" onClick={() => setIsShowingAllGenres((v) => !v)} aria-expanded={isShowingAllGenres} style={{ display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
                {isShowingAllGenres ? "Show fewer" : `+${filters.categories.length - GENRE_PREVIEW_COUNT} more genres`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Favourites row on the unfiltered view */}
      {isBrowsingAll && favoriteChannels.length > 0 && (
        <section aria-labelledby="live-favs" style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
            <h2 id="live-favs" className="section-title" style={{ margin: 0 }}>Your favourites</h2>
            <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{favoriteIds.size}</span>
            <button onClick={() => updateParam("favorites", "1")} className="mono" style={{ marginLeft: "auto", minHeight: 36, fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "var(--accent-hi)" }}>
              SEE ALL →
            </button>
          </div>
          <div className="row-scroll live-row">{favoriteChannels.map(tileFor)}</div>
        </section>
      )}

      {/* Results */}
      <section aria-labelledby="live-results">
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
          <h2 id="live-results" className="section-title" style={{ margin: 0 }}>{resultsTitle}</h2>
          <span aria-live="polite" className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>
            {hasChannelsError ? "" : `${total.toLocaleString()} CHANNELS`}
          </span>
        </div>

        {hasChannelsError && (
          <p role="alert" style={{ color: "var(--muted)", textAlign: "center", marginTop: 48 }}>
            Channels couldn't be loaded. The directory may still be downloading. Try again in a minute.
          </p>
        )}

        {!hasChannelsError && !isLoading && channels.length === 0 && (
          <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 48 }}>
            {isFavoritesOnly && favoriteIds.size === 0
              ? "No favourite channels yet. Press the heart on a channel to add it here."
              : "No channels match these filters."}
          </p>
        )}

        <div className="live-grid">{channels.map(tileFor)}</div>

        {!hasChannelsError && channels.length < total && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
            <button
              onClick={() => loadChannels(channels.length)}
              disabled={isLoading}
              className="btn-slant btn-slant--ghost"
              style={{ opacity: isLoading ? 0.6 : 1 }}
            >
              {isLoading ? "Loading…" : `Show more (${(total - channels.length).toLocaleString()} left)`}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

const HERO_LOGO_COUNT = 24;
const HERO_WALL_TILES = 40;
const FAVORITES_ROW_SIZE = 12;
const GENRE_PREVIEW_COUNT = 13;

function LiveBadge() {
  return <span className="live-badge">LIVE</span>;
}

function LiveStat({ label, value, isFav }: { label: string; value: string; isFav?: boolean }) {
  return (
    <div className="lib-stat" style={{ minWidth: 104, padding: "10px 14px" }}>
      <dt style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "var(--dim)" }}>{label}</dt>
      <dd style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 900, color: isFav ? "var(--fav-text)" : "var(--text)" }}>{value}</dd>
    </div>
  );
}

function GenreTile({ label, count, icon, isActive, onClick }: { label: string; count: number; icon: string; isActive: boolean; onClick: () => void }) {
  return (
    <button className="live-genre" aria-pressed={isActive} onClick={onClick}>
      <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{label}</span>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--dim)" }}>{count.toLocaleString()} channels</span>
      <span aria-hidden="true" className="live-genre-icon">{icon}</span>
    </button>
  );
}

function ChannelTile({ channel, tick, flag, meta, isFavorite, onToggleFavorite }: {
  channel: LiveChannelSummary;
  tick: number;
  flag?: string;
  meta: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="live-tile" style={{ position: "relative" }}>
      <Link to={`/live/${encodeURIComponent(channel.id)}`} className="kuro-card" style={{ display: "block", color: "inherit" }}>
        <div className="kuro-card-img" style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
          <ChannelPreview channel={channel} tick={tick} />
          <span style={{ position: "absolute", top: 8, left: 8 }}><LiveBadge /></span>
          {(flag || channel.country) && (
            <span className="mono" style={{ position: "absolute", left: 8, bottom: 8, fontSize: 12, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: "var(--glass-strong)" }}>
              {flag || channel.country}
            </span>
          )}
        </div>
        <p className="clip-1" style={{ margin: "9px 0 2px", fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{channel.name}</p>
        <p className="clip-1" style={{ margin: 0, fontSize: 11.5, color: "var(--dim)" }}>{meta}</p>
      </Link>
      <div style={{ position: "absolute", top: 4, right: 4 }}>
        <LiveFavoriteButton channelName={channel.name} isFavorite={isFavorite} onToggle={onToggleFavorite} />
      </div>
    </div>
  );
}
