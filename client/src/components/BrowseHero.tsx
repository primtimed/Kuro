import { Search as SearchIcon, X } from "lucide-react";

import { useIsMobile } from "../hooks/useIsMobile";

type Audio = "sub" | "dub" | "";

interface BrowseHeroProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Poster URLs for the tilted background collage. */
  collage: string[];
  formats?: { label: string; value: string }[];
  format?: string;
  onFormatChange?: (f: string) => void;
  audio?: Audio;
  onAudioChange?: (a: Audio) => void;
  placeholder: string;
}

const COLLAGE_SIZE = 27;

export function BrowseHero({
  query, onQueryChange, onSubmit, inputRef, collage,
  formats, format, onFormatChange, audio, onAudioChange, placeholder,
}: BrowseHeroProps) {
  const isMobile = useIsMobile();

  return (
    <section style={{
      position: "relative", overflow: "hidden", marginBottom: isMobile ? 28 : 36,
      padding: isMobile ? "28px 18px 22px" : "44px 44px 36px",
      background: "var(--surf)", border: "1px solid var(--line)", borderRadius: "var(--radius-hero)",
    }}>
      {collage.length > 0 && (
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(9, 1fr)",
          opacity: 0.28, transform: "rotate(-6deg) scale(1.3)", pointerEvents: "none",
        }}>
          {Array.from({ length: COLLAGE_SIZE }, (_, i) => collage[i % collage.length]).map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" width={120} height={220} style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }} />
          ))}
        </div>
      )}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "linear-gradient(90deg, var(--bg) 25%, var(--glass-strong) 55%, var(--glass))",
      }} />

      <div style={{ position: "relative" }}>
        <p className="mono" style={{ margin: "0 0 12px", fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "var(--accent-hi)" }}>
          BROWSE THE CATALOG
        </p>
        <h1 style={{
          margin: 0, fontSize: isMobile ? 32 : 52, fontWeight: 900, lineHeight: 0.95,
          letterSpacing: isMobile ? "-0.03em" : "-0.04em", textTransform: "uppercase",
        }}>
          Find your next<br /><span style={{ color: "var(--accent)" }}>obsession.</span>
        </h1>

        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
          style={{
            display: "flex", alignItems: "center", gap: 12, marginTop: 22, maxWidth: 760,
            padding: "5px 5px 5px 18px", borderRadius: 12,
            background: "var(--glass-strong)", border: "1px solid var(--glass-line)",
          }}
        >
          <SearchIcon size={18} color="var(--dim)" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            aria-label="Search the catalog"
            style={{
              flex: 1, minWidth: 0, minHeight: 44, background: "transparent", border: 0, outline: 0,
              color: "var(--text)", fontFamily: "inherit", fontSize: isMobile ? 15 : 16,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { onQueryChange(""); inputRef.current?.focus(); }}
              aria-label="Clear search"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, color: "var(--dim)" }}
            >
              <X size={16} />
            </button>
          )}
          {!isMobile && (
            <button type="submit" className="btn-slant btn-slant--primary" style={{ padding: "0 26px" }}>
              Search
            </button>
          )}
        </form>

        {(formats || onAudioChange) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
            {formats && onFormatChange && (
              <div role="group" aria-label="Type" className="seg-group">
                {formats.map((f) => (
                  <button key={f.value} className="seg-btn" aria-pressed={format === f.value} onClick={() => onFormatChange(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            {onAudioChange && (
              <div role="group" aria-label="Audio" className="seg-group">
                <button className="seg-btn" aria-pressed={audio === ""} onClick={() => onAudioChange("")}>All audio</button>
                <button className="seg-btn seg-btn--sub" aria-pressed={audio === "sub"} onClick={() => onAudioChange("sub")}>SUB</button>
                <button className="seg-btn seg-btn--dub" aria-pressed={audio === "dub"} onClick={() => onAudioChange("dub")}>DUB</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
