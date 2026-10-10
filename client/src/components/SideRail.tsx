import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Compass, CalendarDays, BookMarked, Tv, Settings, Lock, LogOut } from "lucide-react";

import { useAccount } from "../context/AccountContext";
import { useMediaMode } from "../context/MediaModeContext";
import { useIsMobile } from "../hooks/useIsMobile";

/** Desktop-only fixed navigation rail. Mobile keeps the hamburger menu in Navbar. */
export function SideRail() {
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const { mode } = useMediaMode();
  const isMobile = useIsMobile();

  if (isMobile) return null;

  const items = [
    { label: "HOME", icon: <Home size={20} />, to: "/", isActive: path === "/" },
    { label: "BROWSE", icon: <Compass size={20} />, to: "/browse", isActive: path.startsWith("/browse") || path.startsWith("/genre/") },
    ...(mode === "anime" ? [{ label: "SCHEDULE", icon: <CalendarDays size={20} />, to: "/schedule", isActive: path === "/schedule" }] : []),
    { label: "LIBRARY", icon: <BookMarked size={20} />, to: "/library", isActive: path === "/library" },
    ...(mode === "tv" ? [{ label: "LIVE", icon: <Tv size={20} />, to: "/live", isActive: path === "/live" }] : []),
  ];

  return (
    <nav aria-label="Main" style={{
      position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 60,
      width: "var(--rail-w)", background: "var(--bg-deep)", borderRight: "1px solid var(--line)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "18px 0",
    }}>
      <button onClick={() => navigate("/")} aria-label="Kuro home" style={{ marginBottom: 18 }}>
        <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block", filter: "drop-shadow(0 6px 14px var(--accent-glow))" }}>
          <rect width="32" height="32" rx="8" fill="var(--accent)" />
          <path d="M9 8 L9 24 L13 24 L13 16 L19 24 L23 24 L17 15.5 L23 8 L19 8 L13 14.5 L13 8 Z" fill="var(--text)" />
        </svg>
      </button>

      {items.map((item) => (
        <button
          key={item.to}
          className="rail-btn"
          aria-current={item.isActive ? "page" : undefined}
          onClick={() => navigate(item.to)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <button
          className="rail-btn"
          aria-label="Settings"
          aria-current={path === "/settings" ? "page" : undefined}
          onClick={() => navigate("/settings")}
        >
          <Settings size={20} />
        </button>
        <ProfileMenu />
      </div>
    </nav>
  );
}

function ProfileMenu() {
  const navigate = useNavigate();
  const { account, profiles, requestProfile, signOut } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen((o) => !o)}
        aria-label={`Switch profile (current: ${account?.name ?? "none"})`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        style={{
          width: 44, height: 44, borderRadius: 10,
          background: account ? `linear-gradient(135deg, ${account.color}, ${account.color}88)` : "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, fontWeight: 800,
        }}
      >
        {account?.initial ?? "?"}
      </button>

      {isOpen && (
        <div style={{
          position: "absolute", left: "calc(100% + 12px)", bottom: 0, minWidth: 200,
          background: "var(--surf-2)", border: "1px solid var(--line-2)", borderRadius: 8,
          overflow: "hidden", boxShadow: "0 8px 32px var(--glass-strong)", zIndex: 100,
        }}>
          <button
            onClick={() => { setIsOpen(false); navigate("/profiles"); }}
            className="mono"
            style={{
              width: "100%", minHeight: 40, padding: "0 12px", fontSize: 10, letterSpacing: 1, textAlign: "left",
              color: "var(--dim)", borderBottom: "1px solid var(--line)",
            }}
          >
            WHO'S WATCHING?
          </button>
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => { setIsOpen(false); requestProfile(p); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", minHeight: 44, padding: "0 12px", fontSize: 13,
                background: p.id === account?.id ? "var(--surf-3)" : "transparent",
                color: p.id === account?.id ? "var(--text)" : "var(--muted)",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                background: `linear-gradient(135deg, ${p.color}, ${p.color}88)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 800, color: "var(--text)",
              }}>
                {p.initial}
              </span>
              {p.name}
              {p.needsPin && <Lock size={11} aria-label="PIN protected" style={{ color: "var(--dim)" }} />}
              {p.id === account?.id && <span style={{ marginLeft: "auto", fontSize: 10, color: p.color }}>✓</span>}
            </button>
          ))}
          <button
            onClick={() => void signOut()}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", minHeight: 44, padding: "0 12px", fontSize: 13, color: "var(--muted)",
            }}
          >
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
