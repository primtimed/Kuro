import type {
  Media,
  StreamResult,
  HistoryEntry,
  FavoriteEntry,
  LikeEntry,
  EpisodeAvail,
  ScraperSettings,
  ScraperDef,
  CustomScraper,
} from "./types";
import { ACCOUNT_STORAGE_KEY, GUEST_ACCOUNT } from "./accounts";

const BASE = "/api";

function accountHeaders(): Record<string, string> {
  const id = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  return id ? { "x-account-id": id } : {};
}

function isGuestSession(): boolean {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY) === GUEST_ACCOUNT.id;
}

function libraryOp<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  return isGuestSession() ? Promise.resolve(fallback) : fn();
}

async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: extraHeaders });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: extraHeaders });
  if (!res.ok) throw new Error(res.statusText);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  trending: (type = "anime") => get<Media[]>(`/media/trending?type=${type}`),
  seasonal: (type = "anime") => get<Media[]>(`/media/seasonal?type=${type}`),
  search: (q: string, format?: string) =>
    get<Media[]>(`/media/search?q=${encodeURIComponent(q)}${format ? `&format=${encodeURIComponent(format)}` : ""}`),

  genre: (genre: string) => get<Media[]>(`/media/genre/${encodeURIComponent(genre)}`),

  tv: {
    trending: () => get<Media[]>("/tv/trending"),
    onAir: () => get<Media[]>("/tv/onair"),
    search: (q: string) => get<Media[]>(`/tv/search?q=${encodeURIComponent(q)}`),
    getShow: (id: string) => get<Media>(`/tv/${encodeURIComponent(id)}`),
    getEpisodes: (id: string) => get<import("./types").Episode[]>(`/tv/${encodeURIComponent(id)}/episodes`),
    getStream: (id: string, season: number, episode: number) =>
      get<StreamResult>(`/tv/${encodeURIComponent(id)}/stream?season=${season}&episode=${episode}`),
    genre: (genre: string) => get<Media[]>(`/tv/genre/${encodeURIComponent(genre)}`),
    getSimilar: (id: string) => get<Media[]>(`/tv/${encodeURIComponent(id)}/similar`),
    recommendations: () => libraryOp([] as Media[], () => get<Media[]>("/tv/recommendations", accountHeaders())),
    watchtvCatalog: () => get<Media[]>("/tv/watchtv/catalog"),
  },

  services: {
    scrapers: () => get<ScraperDef[]>("/services/scrapers"),
    testScraper: (source: string) =>
      get<{ ok: boolean; count?: number; error?: string }>(`/services/scrapers/test?source=${encodeURIComponent(source)}`),
    extractStream: (pageUrl: string) =>
      get<{ url: string; type: "hls" | "mp4" }>(`/services/extract-stream?url=${encodeURIComponent(pageUrl)}`),
    settings: () => get<ScraperSettings>("/services/settings"),
    updateSettings: (data: Partial<ScraperSettings>) =>
      put<{ ok: boolean; settings: ScraperSettings }>("/services/settings", data),
  },

  getMedia: (id: string) => get<Media>(`/media/${encodeURIComponent(id)}`),
  getMediaBatch: (ids: string[]): Promise<Media[]> =>
    ids.length === 0
      ? Promise.resolve([])
      : get<Media[]>(`/media/batch?ids=${ids.map(encodeURIComponent).join(",")}`),
  getEpisodes: (id: string) =>
    get<import("./types").Episode[]>(`/media/${encodeURIComponent(id)}/episodes`),
  getAvailability: (id: string) =>
    get<{ episodes: Record<number, EpisodeAvail> }>(`/media/${encodeURIComponent(id)}/availability`),
  getSimilar: (id: string) => get<Media[]>(`/media/${encodeURIComponent(id)}/similar`),
  getRelations: (id: string) => get<{ relationType: string; media: Media }[]>(`/media/${encodeURIComponent(id)}/relations`),
  getStream: (id: string, episode: number, dub = false) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    return fetch(`${BASE}/media/${encodeURIComponent(id)}/stream?episode=${episode}${dub ? "&dub=1" : ""}`, { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error((err as { error: string }).error ?? res.statusText);
        }
        return res.json() as Promise<StreamResult>;
      })
      .catch((e: Error) => {
        clearTimeout(timer);
        if (e.name === "AbortError") throw new Error("Stream lookup timed out — try again");
        throw e;
      });
  },

  torrent: {
    find: (mediaId: string, episode: number, season: number, dub = false) =>
      get<{ streamUrl: string; title: string; fileName: string; fileSize: number; dubbed: boolean }>(
        `/torrent/find?mediaId=${encodeURIComponent(mediaId)}&episode=${episode}&season=${season}${dub ? "&dub=1" : ""}`
      ),
    dubAvailable: (mediaId: string) =>
      get<{ dubAvailable: boolean }>(`/torrent/dub-available?mediaId=${encodeURIComponent(mediaId)}`),
    dubAvailableBatch: (ids: string[]): Promise<Record<string, boolean>> =>
      ids.length === 0
        ? Promise.resolve({})
        : get<Record<string, boolean>>(`/torrent/dub-available-batch?ids=${ids.map(encodeURIComponent).join(",")}`),
  },

  library: {
    favorites: () => libraryOp([] as FavoriteEntry[], () => get("/library/favorites", accountHeaders())),
    isFavorited: (mediaId: string) =>
      libraryOp({ favorited: false }, () => get<{ favorited: boolean }>(`/library/favorites/${encodeURIComponent(mediaId)}`, accountHeaders())),
    addFavorite: (data: { media_id: string; type: string; title: string; poster?: string }) =>
      libraryOp({ ok: true }, () => post<{ ok: boolean }>("/library/favorites", data, accountHeaders())),
    removeFavorite: (mediaId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/library/favorites/${encodeURIComponent(mediaId)}`, accountHeaders())),

    history: () => libraryOp([] as HistoryEntry[], () => get("/library/history", accountHeaders())),
    saveProgress: (data: {
      media_id: string;
      episode_number?: number;
      progress_seconds: number;
      duration_seconds?: number;
      is_dub?: boolean;
    }) => libraryOp({ ok: true }, () => post<{ ok: boolean }>("/library/progress", data, accountHeaders())),
    getProgress: (mediaId: string) =>
      libraryOp([] as HistoryEntry[], () => get(`/library/progress/${encodeURIComponent(mediaId)}`, accountHeaders())),
    removeHistory: (mediaId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/library/history/${encodeURIComponent(mediaId)}`, accountHeaders())),

    likes: () => libraryOp([] as LikeEntry[], () => get("/library/likes", accountHeaders())),
    isLiked: (mediaId: string) =>
      libraryOp({ liked: false, rating: null as number | null }, () => get<{ liked: boolean; rating: number | null }>(`/library/likes/${encodeURIComponent(mediaId)}`, accountHeaders())),
    addLike: (data: { media_id: string; rating: number; title: string; poster?: string }) =>
      libraryOp({ ok: true }, () => post<{ ok: boolean }>("/library/likes", data, accountHeaders())),
    removeLike: (mediaId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/library/likes/${encodeURIComponent(mediaId)}`, accountHeaders())),

    watchedShows: () =>
      libraryOp([] as { media_id: string; watched_count: number; last_watched: number }[], () => get("/library/watched-shows", accountHeaders())),
    favoriteSeries: () =>
      libraryOp([] as { media_id: string; title: string; poster?: string; added_at: number }[], () => get("/library/favorite-series", accountHeaders())),
    isFavoriteSeries: (mediaId: string) =>
      libraryOp({ isFavSeries: false }, () => get<{ isFavSeries: boolean }>(`/library/favorite-series/${encodeURIComponent(mediaId)}`, accountHeaders())),
    addFavoriteSeries: (data: { media_id: string; title: string; poster?: string }) =>
      libraryOp({ ok: true as const }, () => post<{ ok: true }>("/library/favorite-series", data, accountHeaders())),
    removeFavoriteSeries: (mediaId: string) =>
      libraryOp({ ok: true as const }, () => del<{ ok: true }>(`/library/favorite-series/${encodeURIComponent(mediaId)}`, accountHeaders())),
    manuallyWatched: () =>
      libraryOp([] as { media_id: string; title: string; poster?: string; marked_at: number }[], () => get("/library/manually-watched", accountHeaders())),
    isManuallyWatched: (mediaId: string) =>
      libraryOp({ watched: false }, () => get<{ watched: boolean }>(`/library/manually-watched/${encodeURIComponent(mediaId)}`, accountHeaders())),
    markWatched: (data: { media_id: string; title: string; poster?: string }) =>
      libraryOp({ ok: true as const }, () => post<{ ok: true }>("/library/manually-watched", data, accountHeaders())),
    unmarkWatched: (mediaId: string) =>
      libraryOp({ ok: true as const }, () => del<{ ok: true }>(`/library/manually-watched/${encodeURIComponent(mediaId)}`, accountHeaders())),
    newSeasons: () => libraryOp([] as Media[], () => get("/library/new-seasons", accountHeaders())),
    recommendations: () => libraryOp([] as Media[], () => get("/library/recommendations", accountHeaders())),
    refreshRecommendations: () => libraryOp({ ok: true }, () => del<{ ok: boolean }>("/library/recommendations", accountHeaders())),
  },
};
