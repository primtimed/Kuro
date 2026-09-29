import type {
  Media,
  StreamResult,
  HistoryEntry,
  FavoriteEntry,
  LikeEntry,
  EpisodeAvail,
  LiveChannel,
  LiveChannelQuery,
  LiveChannelSummary,
  LiveFilters,
  StreamingSite,
  Me,
  SignedInDevice,
  FamilyProfile,
  InviteInfo,
} from "./types";
import { ACCOUNT_STORAGE_KEY, GUEST_ACCOUNT } from "./accounts";

const BASE = "/api";

// Carries the server's error code (e.g. PIN_INCORRECT) so screens can react to specific cases.
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

function isGuestSession(): boolean {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY) === GUEST_ACCOUNT.id;
}

function libraryOp<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  return isGuestSession() ? Promise.resolve(fallback) : fn();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string | { code?: string; message?: string } };
    const error = payload.error;
    const message = typeof error === "string" ? error : error?.message ?? res.statusText;
    // An expired or revoked session anywhere sends the app back to the sign-in screen
    if (res.status === 401 && typeof error === "object" && error?.code === "UNAUTHENTICATED") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const { code, message: _message, ...details } = typeof error === "object" && error ? error : ({} as Record<string, unknown>);
    throw new ApiError(message, res.status, code as string | undefined, details);
  }
  return res.json() as Promise<T>;
}

export const UNAUTHORIZED_EVENT = "kuro:unauthorized";

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

export const api = {
  auth: {
    config: () => get<{ googleClientId: string | null }>("/auth/config"),
    me: () => get<Me>("/auth/me"),
    invite: (token: string) => get<InviteInfo>(`/auth/invite/${encodeURIComponent(token)}`),
    signInWithGoogle: (credential: string, invite?: string) => post<{ ok: true }>("/auth/google", { credential, invite }),
    signOut: () => post<{ ok: true }>("/auth/logout"),
    switchProfile: (profileId: string, pin?: string) => post<Me>("/auth/active-profile", { profileId, pin }),
    setPin: (pin: string | null) => post<{ ok: true; hasPin: boolean }>("/auth/pin", { pin }),
    startPairing: () => post<{ code: string; pollToken: string; expiresAt: number }>("/auth/pair/start"),
    pollPairing: (pollToken: string) => post<{ status: "pending" | "approved" | "expired" }>("/auth/pair/poll", { pollToken }),
    approvePairing: (code: string, deviceName: string) => post<{ ok: true }>("/auth/pair/approve", { code, deviceName }),
    devices: () => get<SignedInDevice[]>("/auth/devices"),
    renameDevice: (id: string, name: string) => patch<{ ok: true }>(`/auth/devices/${encodeURIComponent(id)}`, { name }),
    removeDevice: (id: string) => del<{ ok: true }>(`/auth/devices/${encodeURIComponent(id)}`),
  },

  family: {
    list: () => get<FamilyProfile[]>("/family"),
    addProfile: (name: string) => post<{ ok: true; id: string }>("/family/profiles", { name }),
    renameProfile: (id: string, name: string) => patch<{ ok: true }>(`/family/profiles/${encodeURIComponent(id)}`, { name }),
    removeProfile: (id: string) => del<{ ok: true }>(`/family/profiles/${encodeURIComponent(id)}`),
    createInvite: (id: string) => post<{ url: string; expiresAt: number }>(`/family/profiles/${encodeURIComponent(id)}/invite`),
    revokeInvite: (id: string) => del<{ ok: true }>(`/family/profiles/${encodeURIComponent(id)}/invite`),
    unlink: (id: string) => post<{ ok: true }>(`/family/profiles/${encodeURIComponent(id)}/unlink`),
  },

  trending: (type = "anime") => get<Media[]>(`/media/trending?type=${type}`),
  seasonal: (type = "anime") => get<Media[]>(`/media/seasonal?type=${type}`),
  search: (q: string, page: number, format?: string, genre?: string) =>
    get<{ items: Media[]; hasNextPage: boolean }>(
      `/media/search?${new URLSearchParams({ q, page: String(page), ...(format && { format }), ...(genre && { genre }) })}`
    ),
  byAudio: (audio: "sub" | "dub", q: string, page: number, format?: string, genre?: string) =>
    get<{ items: Media[]; hasNextPage: boolean }>(
      `/media/by-audio?${new URLSearchParams({ audio, q, page: String(page), ...(format && { format }), ...(genre && { genre }) })}`
    ),


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
    recommendations: () => libraryOp([] as Media[], () => get<Media[]>("/tv/recommendations")),
    watchtvCatalog: () => get<Media[]>("/tv/watchtv/catalog"),
  },

  live: {
    filters: () => get<LiveFilters>("/live/filters"),
    channels: (query: LiveChannelQuery) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      return get<{ total: number; channels: LiveChannelSummary[] }>(`/live/channels?${params}`);
    },
    channel: (id: string) => get<LiveChannel>(`/live/channels/${encodeURIComponent(id)}`),
    favorites: () => libraryOp([] as string[], () => get<string[]>("/live/favorites")),
    addFavorite: (channelId: string) =>
      libraryOp({ ok: true }, () => post<{ ok: boolean }>("/live/favorites", { channel_id: channelId })),
    removeFavorite: (channelId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/live/favorites/${encodeURIComponent(channelId)}`)),
  },

  services: {
    extractStream: (pageUrl: string) =>
      get<{ url: string; type: "hls" | "mp4" }>(`/services/extract-stream?url=${encodeURIComponent(pageUrl)}`),
    directory: () => get<StreamingSite[]>("/services/directory"),
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
    dubAvailable: (mediaId: string) =>
      get<{ dubAvailable: boolean }>(`/torrent/dub-available?mediaId=${encodeURIComponent(mediaId)}`),
    dubAvailableBatch: (ids: string[]): Promise<Record<string, boolean>> =>
      ids.length === 0
        ? Promise.resolve({})
        : get<Record<string, boolean>>(`/torrent/dub-available-batch?ids=${ids.map(encodeURIComponent).join(",")}`),
  },

  library: {
    favorites: () => libraryOp([] as FavoriteEntry[], () => get("/library/favorites")),
    isFavorited: (mediaId: string) =>
      libraryOp({ favorited: false }, () => get<{ favorited: boolean }>(`/library/favorites/${encodeURIComponent(mediaId)}`)),
    addFavorite: (data: { media_id: string; type: string; title: string; poster?: string }) =>
      libraryOp({ ok: true }, () => post<{ ok: boolean }>("/library/favorites", data)),
    removeFavorite: (mediaId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/library/favorites/${encodeURIComponent(mediaId)}`)),

    history: () => libraryOp([] as HistoryEntry[], () => get("/library/history")),
    saveProgress: (data: {
      media_id: string;
      episode_number?: number;
      progress_seconds: number;
      duration_seconds?: number;
      is_dub?: boolean;
    }) => libraryOp({ ok: true }, () => post<{ ok: boolean }>("/library/progress", data)),
    getProgress: (mediaId: string) =>
      libraryOp([] as HistoryEntry[], () => get(`/library/progress/${encodeURIComponent(mediaId)}`)),
    removeHistory: (mediaId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/library/history/${encodeURIComponent(mediaId)}`)),

    likes: () => libraryOp([] as LikeEntry[], () => get("/library/likes")),
    isLiked: (mediaId: string) =>
      libraryOp({ liked: false, rating: null as number | null }, () => get<{ liked: boolean; rating: number | null }>(`/library/likes/${encodeURIComponent(mediaId)}`)),
    addLike: (data: { media_id: string; rating: number; title: string; poster?: string }) =>
      libraryOp({ ok: true }, () => post<{ ok: boolean }>("/library/likes", data)),
    removeLike: (mediaId: string) =>
      libraryOp({ ok: true }, () => del<{ ok: boolean }>(`/library/likes/${encodeURIComponent(mediaId)}`)),

    watchedShows: () =>
      libraryOp([] as { media_id: string; watched_count: number; last_watched: number }[], () => get("/library/watched-shows")),
    favoriteSeries: () =>
      libraryOp([] as { media_id: string; title: string; poster?: string; added_at: number }[], () => get("/library/favorite-series")),
    isFavoriteSeries: (mediaId: string) =>
      libraryOp({ isFavSeries: false }, () => get<{ isFavSeries: boolean }>(`/library/favorite-series/${encodeURIComponent(mediaId)}`)),
    addFavoriteSeries: (data: { media_id: string; title: string; poster?: string }) =>
      libraryOp({ ok: true as const }, () => post<{ ok: true }>("/library/favorite-series", data)),
    removeFavoriteSeries: (mediaId: string) =>
      libraryOp({ ok: true as const }, () => del<{ ok: true }>(`/library/favorite-series/${encodeURIComponent(mediaId)}`)),
    manuallyWatched: () =>
      libraryOp([] as { media_id: string; title: string; poster?: string; marked_at: number }[], () => get("/library/manually-watched")),
    isManuallyWatched: (mediaId: string) =>
      libraryOp({ watched: false }, () => get<{ watched: boolean }>(`/library/manually-watched/${encodeURIComponent(mediaId)}`)),
    markWatched: (data: { media_id: string; title: string; poster?: string }) =>
      libraryOp({ ok: true as const }, () => post<{ ok: true }>("/library/manually-watched", data)),
    unmarkWatched: (mediaId: string) =>
      libraryOp({ ok: true as const }, () => del<{ ok: true }>(`/library/manually-watched/${encodeURIComponent(mediaId)}`)),
    newSeasons: () => libraryOp([] as Media[], () => get("/library/new-seasons")),
    newEpisodes: () => libraryOp([] as Media[], () => get<Media[]>("/library/new-episodes")),
    recommendations: () => libraryOp([] as Media[], () => get("/library/recommendations")),
    refreshRecommendations: () => libraryOp({ ok: true }, () => del<{ ok: boolean }>("/library/recommendations")),
  },
};
