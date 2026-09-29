import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Heart, Search as SearchIcon } from "lucide-react";

import { LiveFavoriteButton } from "../components/LiveFavoriteButton";
import { api } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import { useLiveFavorites } from "../hooks/useLiveFavorites";

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

  const selectStyle: React.CSSProperties = {
    minHeight: 44, padding: "0 12px", borderRadius: 8, fontSize: 14, fontFamily: "inherit",
    background: "var(--surf)", color: "var(--text)", border: "1px solid var(--line-2)",
    flex: isMobile ? "1 1 100%" : "0 1 240px",
  };

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "70px 16px 64px" : "80px 32px 64px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: isMobile ? 24 : 30, fontWeight: 800, letterSpacing: "-0.02em" }}>Live TV</h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>
          {filters
            ? `${filters.total.toLocaleString()} free channels from ${filters.countries.length} countries in ${filters.languages.length} languages`
            : hasFiltersError
              ? "The live TV directory could not be loaded. It will retry when you reload the page."
              : "Loading channel directory…"}
        </p>
      </header>

      <section aria-label="Filters" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <button
          onClick={() => updateParam("favorites", isFavoritesOnly ? "" : "1")}
          aria-pressed={isFavoritesOnly}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px",
            borderRadius: 8, fontSize: 14, fontWeight: 500, whiteSpace: "nowrap",
            flex: isMobile ? "1 1 100%" : "0 0 auto", justifyContent: "center",
            background: isFavoritesOnly ? "var(--fav-soft)" : "var(--surf)",
            color: isFavoritesOnly ? "var(--fav)" : "var(--muted)",
            border: `1px solid ${isFavoritesOnly ? "var(--fav-border)" : "var(--line-2)"}`,
          }}
        >
          <Heart size={16} aria-hidden="true" fill={isFavoritesOnly ? "currentColor" : "none"} />
          Favourites ({favoriteIds.size})
        </button>

        <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "1 1 280px", maxWidth: isMobile ? "none" : 360 }}>
          <SearchIcon size={16} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--dim)", pointerEvents: "none" }} />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search channels…"
            aria-label="Search channels"
            style={{ ...selectStyle, width: "100%", paddingLeft: 40, flex: "none" }}
          />
        </div>

        <select aria-label="Language" value={language} onChange={(e) => updateParam("language", e.target.value)} style={selectStyle}>
          <option value="">All languages</option>
          {sortedLanguages.map((l) => (
            <option key={l.code} value={l.code}>{l.name} ({l.count})</option>
          ))}
        </select>

        <div role="group" aria-label="Sort languages" style={{
          display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line-2)",
          flex: isMobile ? "1 1 100%" : "0 0 auto",
        }}>
          {([
            { sort: "count", label: "Most channels" },
            { sort: "alphabetical", label: "A–Z" },
          ] as const).map(({ sort, label }, i) => (
            <button
              key={sort}
              onClick={() => handleLanguageSortChange(sort)}
              aria-pressed={languageSort === sort}
              style={{
                flex: 1, minHeight: 44, padding: "0 14px", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap",
                background: languageSort === sort ? "var(--surf-3)" : "var(--surf)",
                color: languageSort === sort ? "var(--text)" : "var(--muted)",
                borderLeft: i > 0 ? "1px solid var(--line-2)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <select aria-label="Country" value={country} onChange={(e) => updateParam("country", e.target.value)} style={selectStyle}>
          <option value="">All countries</option>
          {filters?.countries.map((c) => (
            <option key={c.code} value={c.code}>{c.name} ({c.count})</option>
          ))}
        </select>
      </section>

      <nav aria-label="Genres" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
        <GenreChip label="All" isActive={!category} onClick={() => updateParam("category", "")} />
        {filters?.categories.map((c) => (
          <GenreChip
            key={c.id}
            label={`${c.name} ${c.count}`}
            isActive={category === c.id}
            onClick={() => updateParam("category", c.id)}
          />
        ))}
      </nav>

      <p aria-live="polite" className="mono" style={{ margin: "0 0 14px", fontSize: 11, color: "var(--dim)", letterSpacing: 1 }}>
        {hasChannelsError ? "" : `${total.toLocaleString()} CHANNELS`}
      </p>

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

      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 180}px, 1fr))`, gap: 14 }}>
        {channels.map((c) => (
          <ChannelTile
            key={c.id}
            channel={c}
            countryName={c.country ? countryNames.get(c.country) : undefined}
            languageLabel={c.languages.slice(0, 2).map((code) => languageNames.get(code) ?? code).join(", ")}
            isFavorite={favoriteIds.has(c.id)}
            onToggleFavorite={() => handleToggleFavorite(c.id)}
          />
        ))}
      </div>

      {!hasChannelsError && channels.length < total && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
          <button
            onClick={() => loadChannels(channels.length)}
            disabled={isLoading}
            style={{
              minHeight: 44, padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600,
              background: "var(--surf-2)", color: "var(--text)", border: "1px solid var(--line-2)",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? "Loading…" : `Show more (${(total - channels.length).toLocaleString()} left)`}
          </button>
        </div>
      )}
    </main>
  );
}

function GenreChip({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        minHeight: 44, padding: "0 16px", borderRadius: 999, fontSize: 13, fontWeight: 500,
        background: isActive ? "var(--accent)" : "var(--surf)",
        color: isActive ? "var(--text)" : "var(--muted)",
        border: `1px solid ${isActive ? "var(--accent)" : "var(--line-2)"}`,
      }}
    >
      {label}
    </button>
  );
}

function ChannelTile({ channel, countryName, languageLabel, isFavorite, onToggleFavorite }: {
  channel: LiveChannelSummary;
  countryName?: string;
  languageLabel: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const [hasLogoError, setHasLogoError] = useState(false);
  const initials = channel.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <div style={{ position: "relative" }}>
      <Link to={`/live/${encodeURIComponent(channel.id)}`} className="kuro-card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        <div className="kuro-card-img" style={{
          position: "relative", aspectRatio: "16 / 9", borderRadius: 8, overflow: "hidden",
          background: "var(--surf-2)", border: "1px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {channel.logo && !hasLogoError ? (
            <img
              src={channel.logo}
              alt=""
              loading="lazy"
              width={160}
              height={90}
              onError={() => setHasLogoError(true)}
              style={{ width: "70%", height: "70%", objectFit: "contain" }}
            />
          ) : (
            <span aria-hidden="true" style={{ fontSize: 26, fontWeight: 800, color: "var(--dim)" }}>{initials}</span>
          )}
        </div>
        <p style={{ margin: "8px 0 2px", fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {channel.name}
        </p>
        <p className="mono" style={{ margin: 0, fontSize: 10, color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[countryName, languageLabel].filter(Boolean).join(" · ")}
        </p>
      </Link>
      <div style={{ position: "absolute", top: 6, right: 6 }}>
        <LiveFavoriteButton channelName={channel.name} isFavorite={isFavorite} onToggle={onToggleFavorite} />
      </div>
    </div>
  );
}
