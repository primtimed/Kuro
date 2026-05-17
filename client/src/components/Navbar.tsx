import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Home, Compass, BookMarked, ChevronDown, Tags, Settings, Menu, X } from "lucide-react";
import { useAccount } from "../context/AccountContext";
import { useMediaMode } from "../context/MediaModeContext";
import { ACCOUNTS, GUEST_ACCOUNT } from "../lib/accounts";
import { api } from "../lib/api";
import type { Media } from "../lib/types";
import { AnimeCover } from "../lib/procedural";
import { useIsMobile } from "../hooks/useIsMobile";

export function KuroLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#e50914" />
        <path d="M9 8 L9 24 L13 24 L13 16 L19 24 L23 24 L17 15.5 L23 8 L19 8 L13 14.5 L13 8 Z" fill="#fff" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ fontWeight: 800, letterSpacing: "-0.02em", fontSize: 16 }}>Kuro</span>
        <span className="mono" style={{ fontSize: 9, color: "var(--dim)", marginTop: 2, letterSpacing: 1 }}>LIBRARY</span>
      </div>
    </div>
  );
}

const ANIME_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy",
  "Horror", "Mecha", "Music", "Mystery", "Psychological",
  "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

const TV_GENRES = [
  "Action", "Adventure", "Comedy", "Crime", "Drama",
  "Fantasy", "History", "Horror", "Mystery", "Romance",
  "Science-Fiction", "Supernatural", "Thriller", "Western",
];

export function Navbar() {
  const { mode, setMode } = useMediaMode();
  const GENRES = mode === "tv" ? TV_GENRES : ANIME_GENRES;
  const [query, setQuery] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [genreOpen, setGenreOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalResults, setModalResults] = useState<Media[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  const [modalLoading, setModalLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { account, setAccount } = useAccount();
  const switchRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const genreRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearSearch() {
    setQuery("");
    setModalOpen(false);
    setModalResults([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  // Clear search and close mobile menu whenever the user navigates to a different page
  useEffect(() => {
    clearSearch();
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  useEffect(() => {
    if (!switchOpen) return;
    function close(e: MouseEvent) {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) {
        setSwitchOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSwitchOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [switchOpen]);

  useEffect(() => {
    if (!genreOpen) return;
    function close(e: MouseEvent) {
      if (genreRef.current && !genreRef.current.contains(e.target as Node)) {
        setGenreOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setGenreOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [genreOpen]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setModalOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setModalOpen(false);
      setModalResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setModalLoading(true);
      setModalOpen(true);
      const searchFn = mode === "tv" ? api.tv.search : api.search;
      searchFn(value.trim())
        .then((r) => setModalResults(r))
        .catch(() => setModalResults([]))
        .finally(() => setModalLoading(false));
    }, 400);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      setModalOpen(false);
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function handleResultClick(id: string) {
    setModalOpen(false);
    setQuery("");
    navigate(`/title/${encodeURIComponent(id)}`);
  }

  const path = location.pathname;

  if (isMobile) {
    return (
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(10,10,10,0.95)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--line)",
      }}>
        <div style={{
          padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <button onClick={() => navigate("/")} style={{ display: "flex", alignItems: "center" }}>
            <KuroLogo />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 6,
              background: account
                ? `linear-gradient(135deg, ${account.color}, ${account.color}88)`
                : "linear-gradient(135deg, #e50914, #7c1d1d)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800,
            }}>
              {account?.initial ?? "?"}
            </div>
            <button
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 38, height: 38, borderRadius: 7,
                border: "1px solid var(--line-2)", background: "var(--surf)",
                color: "var(--muted)",
              }}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "var(--bg)", overflowY: "auto",
            }}
          >
            {/* Dialog header */}
            <div style={{
              position: "sticky", top: 0, zIndex: 1,
              background: "rgba(10,10,10,0.95)",
              backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
              borderBottom: "1px solid var(--line)",
              padding: "10px 16px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <button onClick={() => { navigate("/"); setMobileOpen(false); }}>
                <KuroLogo />
              </button>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 38, height: 38, borderRadius: 7,
                  border: "1px solid var(--line-2)", background: "var(--surf)",
                  color: "var(--muted)",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: "16px 16px 48px" }}>
              {/* Search */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim()) {
                    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                    setQuery("");
                    setMobileOpen(false);
                  }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "var(--surf)", border: "1px solid var(--line)", borderRadius: 8,
                  padding: "10px 14px", marginBottom: 20,
                }}
              >
                <Search size={15} color="var(--dim)" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={mode === "tv" ? "Search TV series…" : "Search anime…"}
                  aria-label="Search titles"
                  style={{
                    flex: 1, background: "transparent", border: 0, outline: 0,
                    color: "var(--text)", fontFamily: "inherit", fontSize: 16,
                  }}
                />
              </form>

              {/* Mode toggle */}
              <div style={{
                display: "flex", borderRadius: 8, overflow: "hidden",
                border: "1px solid var(--line-2)", marginBottom: 20,
              }}>
                {(["anime", "tv"] as const).map((m, i) => (
                  <button
                    key={m}
                    onClick={() => {
                      if (mode !== m) { setMode(m); clearSearch(); navigate("/"); }
                      setMobileOpen(false);
                    }}
                    style={{
                      flex: 1, padding: "12px", fontSize: 14, fontWeight: 600,
                      background: mode === m ? "var(--accent)" : "transparent",
                      color: mode === m ? "#fff" : "var(--muted)",
                      borderRight: i === 0 ? "1px solid var(--line-2)" : "none",
                    }}
                  >
                    {m === "anime" ? "Anime" : "TV Series"}
                  </button>
                ))}
              </div>

              {/* Nav links */}
              <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 24 }}>
                {([
                  { label: "Home", icon: <Home size={16} />, to: "/" },
                  { label: "Browse", icon: <Compass size={16} />, to: "/browse" },
                  { label: "Library", icon: <BookMarked size={16} />, to: "/library" },
                  { label: "Settings", icon: <Settings size={16} />, to: "/settings" },
                ] as const).map(({ label, icon, to }) => (
                  <button
                    key={to}
                    onClick={() => { navigate(to); setMobileOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 12px", borderRadius: 8, fontSize: 15, fontWeight: 500,
                      background: path === to ? "var(--surf-2)" : "transparent",
                      color: path === to ? "#fff" : "var(--muted)",
                      border: path === to ? "1px solid var(--line-2)" : "1px solid transparent",
                      textAlign: "left",
                    }}
                  >
                    {icon} {label}
                  </button>
                ))}
              </nav>

              {/* Genres */}
              <div style={{ marginBottom: 24 }}>
                <p className="mono" style={{ margin: "0 0 10px", fontSize: 10, color: "var(--dim)", letterSpacing: 1.5 }}>GENRES</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {GENRES.map((g) => (
                    <button
                      key={g}
                      onClick={() => { navigate(`/genre/${encodeURIComponent(g)}`); setMobileOpen(false); }}
                      style={{
                        padding: "8px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500,
                        background: path === `/genre/${encodeURIComponent(g)}` ? "var(--accent)" : "var(--surf-2)",
                        color: path === `/genre/${encodeURIComponent(g)}` ? "#fff" : "var(--muted)",
                        border: `1px solid ${path === `/genre/${encodeURIComponent(g)}` ? "var(--accent)" : "var(--line-2)"}`,
                      }}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Account switcher */}
              <div>
                <p className="mono" style={{ margin: "0 0 10px", fontSize: 10, color: "var(--dim)", letterSpacing: 1.5 }}>ACCOUNT</p>
                {[...ACCOUNTS, GUEST_ACCOUNT].map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setAccount(a); window.location.href = "/"; }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      width: "100%", padding: "11px 0", fontSize: 14,
                      borderBottom: "1px solid var(--line)",
                      background: "transparent",
                      color: a.id === account?.id ? "#fff" : "var(--muted)",
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 5, flexShrink: 0,
                      background: `linear-gradient(135deg, ${a.color}, ${a.color}88)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, color: "#fff",
                    }}>
                      {a.initial}
                    </div>
                    {a.name}
                    {a.id === account?.id && (
                      <span style={{ marginLeft: "auto", fontSize: 12, color: a.color }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>
    );
  }

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(10,10,10,0.85)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderBottom: "1px solid var(--line)",
    }}>
      <div style={{
        maxWidth: 1600, margin: "0 auto", padding: "12px 32px",
        display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 28,
      }}>
        {/* Left: logo + mode toggle + nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <button onClick={() => navigate("/")} style={{ display: "flex", alignItems: "center" }}>
            <KuroLogo />
          </button>

          {/* Anime / TV Series mode toggle */}
          <div
            role="group"
            aria-label="Content type"
            style={{
              display: "flex", alignItems: "center",
              background: "var(--surf)", border: "1px solid var(--line-2)",
              borderRadius: 8, padding: 3, gap: 2,
            }}
          >
            {(["anime", "tv"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (mode === m) return;
                  setMode(m);
                  clearSearch();
                  navigate("/");
                }}
                aria-pressed={mode === m}
                style={{
                  padding: "5px 13px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  transition: "background 150ms, color 150ms, box-shadow 150ms",
                  background: mode === m ? "var(--accent)" : "transparent",
                  color: mode === m ? "#fff" : "var(--dim)",
                  boxShadow: mode === m ? "0 1px 4px rgba(229,9,20,0.4)" : "none",
                  border: mode === m ? "1px solid var(--accent)" : "1px solid transparent",
                  letterSpacing: 0.2,
                }}
              >
                {m === "anime" ? "Anime" : "TV Series"}
              </button>
            ))}
          </div>

          <nav style={{ display: "flex", gap: 4 }}>
            <NavBtn icon={<Home size={13} />} label="Home" active={path === "/"} onClick={() => navigate("/")} />
            <NavBtn icon={<Compass size={13} />} label="Browse" active={path === "/browse" || path.startsWith("/browse/")} onClick={() => navigate("/browse")} />
            <NavBtn icon={<BookMarked size={13} />} label="Library" active={path === "/library"} onClick={() => navigate("/library")} />

            <div ref={genreRef} style={{ position: "relative" }}>
              <button
                onClick={() => setGenreOpen((o) => !o)}
                aria-expanded={genreOpen}
                aria-haspopup="true"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                  color: path.startsWith("/genre/") ? "#fff" : "var(--muted)",
                  background: path.startsWith("/genre/") ? "var(--surf-2)" : "transparent",
                  border: path.startsWith("/genre/") ? "1px solid var(--line-2)" : "1px solid transparent",
                }}
              >
                <Tags size={13} /> Genres <ChevronDown size={11} color="var(--dim)" style={{ marginLeft: -2, transform: genreOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
              </button>
              {genreOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0,
                  background: "var(--surf-2)", border: "1px solid var(--line-2)",
                  borderRadius: 10, padding: 12,
                  boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
                  zIndex: 200, width: 280,
                }}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                  }}>
                    {GENRES.map((g) => (
                      <button
                        key={g}
                        onClick={() => { setGenreOpen(false); navigate(`/genre/${encodeURIComponent(g)}`); }}
                        style={{
                          padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          textAlign: "left",
                          background: path === `/genre/${encodeURIComponent(g)}` ? "var(--accent)" : "var(--surf-3)",
                          color: path === `/genre/${encodeURIComponent(g)}` ? "#fff" : "var(--muted)",
                          border: "1px solid var(--line)",
                          transition: "background 120ms, color 120ms",
                        }}
                        onMouseEnter={(e) => {
                          if (path !== `/genre/${encodeURIComponent(g)}`) {
                            e.currentTarget.style.background = "var(--surf-4, var(--line))";
                            e.currentTarget.style.color = "var(--text)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (path !== `/genre/${encodeURIComponent(g)}`) {
                            e.currentTarget.style.background = "var(--surf-3)";
                            e.currentTarget.style.color = "var(--muted)";
                          }
                        }}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Center: search */}
        <div ref={searchRef} style={{ position: "relative", maxWidth: 520, justifySelf: "center", width: "100%" }}>
          <form onSubmit={handleSearch} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "var(--surf)", border: "1px solid var(--line)", borderRadius: 8,
            padding: "8px 12px",
          }}>
            <Search size={14} color="var(--dim)" />
            <input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={mode === "tv" ? 'Search TV series — try "The Boys", "Breaking Bad"…' : 'Search titles — try "Frieren", "MAPPA"…'}
              aria-label="Search titles"
              style={{
                flex: 1, background: "transparent", border: 0, outline: 0,
                color: "var(--text)", fontFamily: "inherit", fontSize: 13,
              }}
            />
          </form>

          {modalOpen && (
            <div role="listbox" aria-label="Search results" style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
              background: "var(--surf-2)", border: "1px solid var(--line-2)",
              borderRadius: 10, overflow: "hidden",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
              zIndex: 200, maxHeight: 420, overflowY: "auto",
            }}>
              {modalLoading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderBottom: "1px solid var(--line)",
                  }}>
                    <div style={{ width: 36, height: 50, borderRadius: 4, background: "var(--surf-3)", animation: "pulse 1.5s ease-in-out infinite", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 13, width: "65%", background: "var(--surf-3)", borderRadius: 3, animation: "pulse 1.5s ease-in-out infinite" }} />
                      <div style={{ height: 10, width: "35%", background: "var(--surf-3)", borderRadius: 3, marginTop: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
                    </div>
                  </div>
                ))
              )}

              {!modalLoading && modalResults.length === 0 && (
                <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
                  No results for "{query}"
                </div>
              )}

              {!modalLoading && modalResults.slice(0, 8).map((m) => (
                <button
                  key={m.id}
                  role="option"
                  onClick={() => handleResultClick(m.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, width: "100%",
                    padding: "10px 14px", borderBottom: "1px solid var(--line)",
                    background: "transparent", textAlign: "left",
                    transition: "background 150ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surf-3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ width: 36, height: 50, borderRadius: 4, overflow: "hidden", flexShrink: 0, border: "1px solid var(--line)" }}>
                    {m.poster
                      ? <img src={m.poster} alt={m.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      : <AnimeCover title={m.title} w={36} h={50} />
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--dim)", marginTop: 3, letterSpacing: 0.5 }}>
                      {m.type.toUpperCase()}{m.year ? ` · ${m.year}` : ""}{m.totalEpisodes ? ` · ${m.totalEpisodes}EP` : ""}
                    </div>
                  </div>
                  {m.rating && (
                    <div style={{ fontSize: 11, color: "var(--rating)", fontWeight: 700, flexShrink: 0 }}>★ {m.rating.toFixed(1)}</div>
                  )}
                </button>
              ))}

              {!modalLoading && modalResults.length > 8 && (
                <button
                  onClick={() => { setModalOpen(false); navigate(`/search?q=${encodeURIComponent(query.trim())}`); }}
                  style={{
                    display: "block", width: "100%", padding: "11px 14px",
                    textAlign: "center", fontSize: 12, color: "var(--accent)",
                    fontWeight: 600, background: "transparent",
                    transition: "background 150ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surf-3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  See all results for "{query}"
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: settings + account switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => navigate("/settings")}
          aria-label="Settings"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 7,
            border: "1px solid var(--line-2)", background: path === "/settings" ? "var(--surf-2)" : "var(--surf)",
            color: "var(--muted)",
          }}
        >
          <Settings size={14} />
        </button>
        <div ref={switchRef} style={{ position: "relative" }}>
          <button
            onClick={() => setSwitchOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px 4px 4px", borderRadius: 7,
              border: "1px solid var(--line-2)", background: "var(--surf)",
            }}
            aria-label="Switch account"
            aria-expanded={switchOpen}
            aria-haspopup="true"
          >
            <div style={{
              width: 26, height: 26, borderRadius: 5,
              background: account
                ? `linear-gradient(135deg, ${account.color}, ${account.color}88)`
                : "linear-gradient(135deg, #e50914, #7c1d1d)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800,
            }}>
              {account?.initial ?? "?"}
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
              {account?.name ?? ""}
            </span>
            <ChevronDown size={11} color="var(--dim)" />
          </button>

          {switchOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              background: "var(--surf-2)", border: "1px solid var(--line-2)",
              borderRadius: 8, overflow: "hidden", minWidth: 160,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)", zIndex: 100,
            }}>
              {ACCOUNTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setAccount(a); window.location.href = "/"; }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "10px 12px", fontSize: 13,
                    background: a.id === account?.id ? "var(--surf-3)" : "transparent",
                    color: a.id === account?.id ? "#fff" : "var(--muted)",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                    background: `linear-gradient(135deg, ${a.color}, ${a.color}88)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: 800, color: "#fff",
                  }}>
                    {a.initial}
                  </div>
                  {a.name}
                  {a.id === account?.id && (
                    <span style={{ marginLeft: "auto", fontSize: 10, color: a.color }}>✓</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => { setAccount(GUEST_ACCOUNT); window.location.href = "/"; }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "10px 12px", fontSize: 13,
                  background: account?.isGuest ? "var(--surf-3)" : "transparent",
                  color: account?.isGuest ? "#fff" : "var(--muted)",
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                  background: `linear-gradient(135deg, ${GUEST_ACCOUNT.color}, ${GUEST_ACCOUNT.color}88)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 800, color: "#fff",
                }}>
                  {GUEST_ACCOUNT.initial}
                </div>
                {GUEST_ACCOUNT.name}
                {account?.isGuest && (
                  <span style={{ marginLeft: "auto", fontSize: 10, color: GUEST_ACCOUNT.color }}>✓</span>
                )}
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
    </header>
  );
}

function NavBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", borderRadius: 6, fontSize: 13, fontWeight: 500,
      color: active ? "#fff" : "var(--muted)",
      background: active ? "var(--surf-2)" : "transparent",
      border: active ? "1px solid var(--line-2)" : "1px solid transparent",
    }}>
      {icon} {label}
    </button>
  );
}
