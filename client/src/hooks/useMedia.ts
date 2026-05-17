import { useState, useEffect } from "react";
import type { Media, Episode } from "../lib/types";
import { api } from "../lib/api";
import { lcGet, lcSet } from "../lib/localCache";

const MEDIA_TTL = 24 * 60 * 60 * 1000;
const LIST_TTL = 15 * 60 * 1000;

export function useMedia(id: string | undefined) {
  const cached = id ? lcGet<Media>(`media:${id}`) : null;
  const [media, setMedia] = useState<Media | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Only show loading spinner when there's nothing to show yet
    if (!lcGet<Media>(`media:${id}`)) setLoading(true);
    setError(null);

    api
      .getMedia(id)
      .then((m) => {
        if (cancelled) return;
        lcSet(`media:${id}`, m, MEDIA_TTL);
        setMedia(m);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id]);

  return { media, loading, error };
}

export function useEpisodes(id: string | undefined) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getEpisodes(id)
      .then((eps) => { if (!cancelled) setEpisodes(eps); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id]);

  return { episodes, loading, error };
}

export function useTrending(type = "anime") {
  const cacheKey = `trending:${type}`;
  const cached = lcGet<Media[]>(cacheKey);
  const [items, setItems] = useState<Media[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!lcGet<Media[]>(cacheKey)) setLoading(true);
    api
      .trending(type)
      .then((m) => {
        if (cancelled) return;
        lcSet(cacheKey, m, LIST_TTL);
        setItems(m);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type]);

  return { items, loading, error };
}

export function useSeasonal(type = "anime") {
  const cacheKey = `seasonal:${type}`;
  const cached = lcGet<Media[]>(cacheKey);
  const [items, setItems] = useState<Media[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!lcGet<Media[]>(cacheKey)) setLoading(true);
    api
      .seasonal(type)
      .then((m) => {
        if (cancelled) return;
        lcSet(cacheKey, m, LIST_TTL);
        setItems(m);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type]);

  return { items, loading, error };
}
