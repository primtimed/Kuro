import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { Card, CardSkeleton } from "../components/Card";
import { api } from "../lib/api";
import { useMediaMode } from "../context/MediaModeContext";
import type { Media } from "../lib/types";
import { useIsMobile } from "../hooks/useIsMobile";

export function Search() {
  const { mode } = useMediaMode();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function doSearch(q: string) {
    setSearchParams(q ? { q } : {}, { replace: true });
    setLoading(true);
    const searchFn = mode === "tv" ? api.tv.search : api.search;
    searchFn(q)
      .then((r) => { setResults(r); setSearched(true); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (initialQ) doSearch(initialQ);
  }, []);

  useEffect(() => {
    setResults([]);
    setSearched(false);
  }, [mode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(query), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, mode]);

  const placeholder = mode === "tv" ? 'Search TV series — try "Breaking Bad"…' : "Search for anime…";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "70px 16px 64px" : "80px 32px 64px" }}>
      <div style={{ maxWidth: 640, marginBottom: 40 }}>
        <div style={{ position: "relative" }}>
          <SearchIcon size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--dim)", pointerEvents: "none" }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            autoFocus
            style={{
              width: "100%", background: "var(--surf)", border: "1px solid var(--line-2)",
              color: "var(--text)", paddingLeft: 44, paddingRight: 16, paddingTop: 13, paddingBottom: 13,
              borderRadius: 10, fontSize: 15, outline: "none", fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {loading && (
        <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
          {Array.from({ length: 14 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
          {query ? `No results for "${query}"` : "Nothing found."}
        </p>
      )}

      {!loading && results.length > 0 && (
        <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 178px)", gap: 12 }}>
          {results.map((m) => <Card key={m.id} media={m} />)}
        </div>
      )}
    </div>
  );
}
