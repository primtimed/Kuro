import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Heart, History, Search as SearchIcon } from "lucide-react";

import { LiveFavoriteButton } from "../components/LiveFavoriteButton";
import { LivePlayer } from "../components/LivePlayer";
import { api } from "../lib/api";
import { CATEGORY_ICONS } from "../lib/live-categories";
import { addRecentChannel, getRecentChannels } from "../lib/live-recent";
import { useLiveFavorites } from "../hooks/useLiveFavorites";

import type { LiveChannel, LiveChannelSummary, LiveFilters } from "../lib/types";

const LIST_PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;
const FAVORITES = "favorites";
const RECENT = "recent";

/** One channel playing, with a channel list next to it so the viewer can zap without leaving the page. */
export function LiveWatch() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<LiveChannel | null>(null);
  const [hasError, setHasError] = useState(false);
  const [filters, setFilters] = useState<LiveFilters | null>(null);
  // Which list the right column shows: a category id, favourites or recently watched.
  const [listSource, setListSource] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [list, setList] = useState<LiveChannelSummary[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [isListLoading, setIsListLoading] = useState(false);
  const latestListRequest = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const { favoriteIds, toggleFavorite } = useLiveFavorites();

  useEffect(() => {
    api.live.filters().then(setFilters).catch((err: unknown) => console.error("[live] loading filters failed:", err));
  }, []);

  useEffect(() => {
    setChannel(null);
    setHasError(false);
    api.live.channel(id)
      .then((c) => {
        setChannel(c);
        // The list starts on the channel's own genre and then stays where the viewer put it.
        setListSource((current) => current ?? c.categories[0] ?? FAVORITES);
        addRecentChannel({ id: c.id, name: c.name, logo: c.logo, country: c.country, categories: c.categories, languages: c.languages, website: c.website, streamCount: c.streams.length });
      })
      .catch(() => setHasError(true));
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(listQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [listQuery]);

  useEffect(() => {
    if (!listSource) return;
    loadList(0);
  }, [listSource, debouncedQuery]);

  function loadList(offset: number) {
    if (listSource === RECENT) {
      const recent = getRecentChannels().filter((c) => !debouncedQuery || c.name.toLowerCase().includes(debouncedQuery.toLowerCase()));
      setList(recent);
      setListTotal(recent.length);
      return;
    }
    const requestId = ++latestListRequest.current;
    setIsListLoading(true);
    api.live.channels({
      ...(listSource === FAVORITES ? { favorites: "1" as const } : { category: listSource ?? undefined }),
      q: debouncedQuery || undefined,
      offset,
      limit: LIST_PAGE_SIZE,
    })
      .then((page) => {
        if (requestId !== latestListRequest.current) return;
        setList((prev) => (offset === 0 ? page.channels : [...prev, ...page.channels]));
        setListTotal(page.total);
      })
      .catch((err: unknown) => console.error("[live] loading channel list failed:", err))
      .finally(() => { if (requestId === latestListRequest.current) setIsListLoading(false); });
  }

  // Keep the playing channel in view when zapping through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-channel="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, list]);

  const position = list.findIndex((c) => c.id === id);

  // PageUp/PageDown are what most TV remotes send for CH+/CH−.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      if (position < 0 || list.length < 2) return;
      e.preventDefault();
      const next = e.key === "PageDown" ? position + 1 : position - 1;
      const target = list[(next + list.length) % list.length];
      navigate(`/live/${encodeURIComponent(target.id)}`, { replace: true });
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [position, list, navigate]);

  const countryNames = useMemo(() => new Map((filters?.countries ?? []).map((c) => [c.code, c.name])), [filters]);
  const countryFlags = useMemo(() => new Map((filters?.countries ?? []).map((c) => [c.code, c.flag])), [filters]);
  const languageNames = useMemo(() => new Map((filters?.languages ?? []).map((l) => [l.code, l.name])), [filters]);
  const categoryNames = useMemo(() => new Map((filters?.categories ?? []).map((c) => [c.id, c.name])), [filters]);

  const metaFor = (c: { country: string | null; languages: string[] }) =>
    [c.country ? countryNames.get(c.country) ?? c.country : null, c.languages[0] ? languageNames.get(c.languages[0]) ?? c.languages[0] : null].filter(Boolean).join(" · ");
  const listTitle = listSource === FAVORITES ? "Favourites" : listSource === RECENT ? "Recently watched" : categoryNames.get(listSource ?? "") ?? "Channels";

  const sources: { id: string; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: FAVORITES, label: "Favourites", icon: <Heart size={16} />, count: favoriteIds.size },
    { id: RECENT, label: "Recently watched", icon: <History size={16} /> },
    ...(filters?.categories ?? []).map((c) => ({ id: c.id, label: c.name, icon: <span aria-hidden="true">{CATEGORY_ICONS[c.id] ?? "📺"}</span>, count: c.count })),
  ];

  return (
    <main className="zap-page">
      <Link to="/live" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 40, marginBottom: 10, fontSize: 13, color: "var(--muted)" }}>
        <ArrowLeft size={15} aria-hidden="true" /> Live TV
      </Link>

      <div className="zap-layout">
        {/* Lists to zap through */}
        <nav aria-label="Channel lists" className="zap-sources">
          {sources.map((s, i) => (
            <div key={s.id} style={{ display: "contents" }}>
              {i === 2 && <span aria-hidden="true" className="settings-nav-sep" />}
              <button
                className="zap-source"
                aria-current={listSource === s.id ? "true" : undefined}
                onClick={() => { setListSource(s.id); setListQuery(""); }}
              >
                <span className="zap-source-icon">{s.icon}</span>
                <span className="clip-1" style={{ flex: 1, textAlign: "left" }}>{s.label}</span>
                {s.count !== undefined && <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{s.count.toLocaleString()}</span>}
              </button>
            </div>
          ))}
        </nav>

        {/* Player + now playing */}
        <section aria-label="Now playing" style={{ minWidth: 0 }}>
          {hasError && (
            <p role="alert" style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
              This channel couldn't be found. It may have been removed from the directory.
            </p>
          )}
          {!hasError && !channel && (
            <div style={{ aspectRatio: "16 / 9", borderRadius: 12, background: "var(--surf)", border: "1px solid var(--line)", animation: "pulse 1.5s ease-in-out infinite" }} />
          )}
          {channel && (
            <>
              <div style={{ borderRadius: 12, overflow: "hidden" }}>
                <LivePlayer key={channel.id} streams={channel.streams} channelName={channel.name} />
              </div>
              <div className="zap-now">
                <div style={{ width: 96, height: 54, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--surf-2)", flexShrink: 0 }}>
                  {channel.logo
                    ? <img src={channel.logo} alt="" width={96} height={54} style={{ maxWidth: "72%", maxHeight: "72%", objectFit: "contain" }} />
                    : <span aria-hidden="true" style={{ fontWeight: 800, color: "var(--dim)" }}>{channel.name.slice(0, 2).toUpperCase()}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="mono" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 11, color: "var(--dim)", letterSpacing: 0.5 }}>
                    <span className="live-badge">LIVE</span>
                    {position >= 0 && <span>CH {position + 1}</span>}
                    {channel.categories[0] && <span>· {(categoryNames.get(channel.categories[0]) ?? channel.categories[0]).toUpperCase()}</span>}
                  </p>
                  <h1 className="clip-1" style={{ margin: "6px 0 2px", fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase" }}>{channel.name}</h1>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
                    {channel.country && countryFlags.get(channel.country)} {metaFor(channel)}
                  </p>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <LiveFavoriteButton size="large" channelName={channel.name} isFavorite={favoriteIds.has(channel.id)} onToggle={() => toggleFavorite(channel.id)} />
                  {channel.website && (
                    <a href={channel.website} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px", borderRadius: 8, fontSize: 14, fontWeight: 600, background: "var(--surf-2)", border: "1px solid var(--line-2)", color: "var(--text)" }}>
                      <ExternalLink size={15} aria-hidden="true" /> Website
                    </a>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Channel list */}
        <aside aria-label={`${listTitle} channels`} className="zap-list">
          <div style={{ padding: 14, borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{listTitle}</h2>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--dim)" }}>{listTotal.toLocaleString()} CHANNELS</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 12px", borderRadius: 8, background: "var(--surf-2)", border: "1px solid var(--line)" }}>
              <SearchIcon size={14} color="var(--dim)" aria-hidden="true" />
              <input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder={`Search ${listTitle.toLowerCase()}…`}
                aria-label={`Search ${listTitle}`}
                style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}
              />
            </label>
          </div>
          <ol ref={listRef} className="zap-list-items">
            {list.map((c, i) => (
              <li key={c.id} data-channel={c.id} style={{ position: "relative" }}>
                <Link
                  to={`/live/${encodeURIComponent(c.id)}`}
                  replace
                  aria-current={c.id === id ? "true" : undefined}
                  className="zap-row"
                >
                  <span className="mono" style={{ width: 28, fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ width: 60, height: 34, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--surf-2)", flexShrink: 0 }}>
                    {c.logo && <img src={c.logo} alt="" loading="lazy" width={60} height={34} style={{ maxWidth: "74%", maxHeight: "74%", objectFit: "contain" }} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="clip-1" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{c.name}</span>
                    <span className="clip-1" style={{ fontSize: 11.5, color: "var(--dim)" }}>{c.country && countryFlags.get(c.country)} {metaFor(c)}</span>
                  </span>
                </Link>
                <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>
                  <LiveFavoriteButton channelName={c.name} isFavorite={favoriteIds.has(c.id)} onToggle={() => toggleFavorite(c.id)} />
                </div>
              </li>
            ))}
          </ol>
          {listSource !== RECENT && list.length < listTotal && (
            <button onClick={() => loadList(list.length)} disabled={isListLoading} style={{ minHeight: 44, margin: 10, borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--surf-2)", border: "1px solid var(--line-2)", color: "var(--text)" }}>
              {isListLoading ? "Loading…" : `Load more (${(listTotal - list.length).toLocaleString()} left)`}
            </button>
          )}
          {!isListLoading && list.length === 0 && (
            <p style={{ margin: 16, fontSize: 13, color: "var(--dim)" }}>
              {listSource === RECENT ? "Channels you open show up here." : listSource === FAVORITES ? "No favourite channels yet." : "No channels found."}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

