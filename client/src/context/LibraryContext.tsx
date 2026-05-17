import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAccount } from "./AccountContext";

interface LibraryContextValue {
  watchedIds: Set<string>;
  ratingMap: Map<string, number>;
  favSeriesIds: Set<string>;
  refresh: () => void;
}

const LibraryContext = createContext<LibraryContextValue>({
  watchedIds: new Set(),
  ratingMap: new Map(),
  favSeriesIds: new Set(),
  refresh: () => {},
});

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [ratingMap, setRatingMap] = useState<Map<string, number>>(new Map());
  const [favSeriesIds, setFavSeriesIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    if (!account || account.isGuest) {
      setWatchedIds(new Set());
      setRatingMap(new Map());
      setFavSeriesIds(new Set());
      return;
    }
    Promise.allSettled([
      api.library.watchedShows(),
      api.library.likes(),
      api.library.favoriteSeries(),
    ]).then(([watchedRes, likesRes, favRes]) => {
      if (watchedRes.status === "fulfilled") {
        const ids = new Set(watchedRes.value.map((r) => r.media_id));
        // Liked shows are also "watched"
        if (likesRes.status === "fulfilled") likesRes.value.forEach((l) => ids.add(l.media_id));
        setWatchedIds(ids);
      }
      if (likesRes.status === "fulfilled") {
        setRatingMap(new Map(likesRes.value.map((l) => [l.media_id, l.rating])));
      }
      if (favRes.status === "fulfilled") {
        setFavSeriesIds(new Set(favRes.value.map((f) => f.media_id)));
      }
    });
  }, [account]);

  useEffect(() => { load(); }, [load]);

  return (
    <LibraryContext.Provider value={{ watchedIds, ratingMap, favSeriesIds, refresh: load }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  return useContext(LibraryContext);
}
