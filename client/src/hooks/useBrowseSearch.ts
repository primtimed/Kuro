import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api";

import type { Media } from "../lib/types";

interface BrowseFilters {
  mode: "anime" | "tv";
  query: string;
  format: string;
  audio: "sub" | "dub" | "";
  genre: string;
  isEnabled?: boolean;
}

// Load the next page when the sentinel gets this close to the viewport
const PREFETCH_MARGIN = "800px";

/**
 * Paged Browse search with infinite scroll. Attach `sentinelRef` to an element after the
 * results grid; the next page loads when it nears the viewport.
 */
export function useBrowseSearch({ mode, query, format, audio, genre, isEnabled = true }: BrowseFilters) {
  const [results, setResults] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const pageRef = useRef(1);
  // Bumped per new search so responses for an outdated filter set are dropped
  const searchIdRef = useRef(0);

  const q = query.trim();
  const isActive = isEnabled && (mode === "tv" ? !!q : !!(q || format || genre || audio));

  const fetchPage = useCallback((page: number): Promise<{ items: Media[]; hasNextPage: boolean }> => {
    if (mode === "tv") return api.tv.search(q).then((items) => ({ items, hasNextPage: false }));
    // Sub/dub come from a separate catalog, since AniList has no audio metadata
    if (audio) return api.byAudio(audio, q, page, format || undefined, genre || undefined);
    return api.search(q, page, format || undefined, genre || undefined);
  }, [mode, q, format, audio, genre]);

  useEffect(() => {
    const searchId = ++searchIdRef.current;
    if (!isActive) {
      setResults([]);
      setHasSearched(false);
      setHasMore(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const timer = setTimeout(() => {
      fetchPage(1)
        .then((r) => {
          if (searchId !== searchIdRef.current) return;
          pageRef.current = 1;
          setResults(r.items);
          setHasMore(r.hasNextPage);
          setHasSearched(true);
        })
        .catch((err) => {
          if (searchId !== searchIdRef.current) return;
          console.error("Browse search failed", err);
          setResults([]);
          setHasMore(false);
          setHasSearched(true);
        })
        .finally(() => { if (searchId === searchIdRef.current) setIsLoading(false); });
    }, 350);
    return () => clearTimeout(timer);
  }, [fetchPage, isActive]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading || isLoadingMore) return;
    const searchId = searchIdRef.current;
    const nextPage = pageRef.current + 1;
    setIsLoadingMore(true);
    fetchPage(nextPage)
      .then((r) => {
        if (searchId !== searchIdRef.current) return;
        pageRef.current = nextPage;
        setResults((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...r.items.filter((m) => !ids.has(m.id))];
        });
        setHasMore(r.hasNextPage);
      })
      .catch((err) => {
        console.error("Loading more results failed", err);
        // Stop here so a failing page isn't retried on every scroll event
        if (searchId === searchIdRef.current) setHasMore(false);
      })
      .finally(() => setIsLoadingMore(false));
  }, [fetchPage, hasMore, isLoading, isLoadingMore]);

  // Re-observing after every load fires the callback immediately if the sentinel is still
  // on screen, so short pages (few catalog titles matched) keep loading until it scrolls away.
  useEffect(() => {
    if (!sentinel || !hasMore || isLoading || isLoadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: PREFETCH_MARGIN }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, isLoading, isLoadingMore, loadMore]);

  return { results, isLoading, isLoadingMore, hasSearched, hasMore, isActive, sentinelRef: setSentinel };
}
