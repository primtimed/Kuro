import type { Media, Episode, StreamResult, Provider, CastMember } from "../types/media.js";
import { cache } from "../cache/index.js";

const BASE = "https://api.tvmaze.com";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TVMaze ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

interface TVMazeShow {
  id: number;
  name: string;
  genres: string[];
  status: string;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  rating: { average: number | null };
  weight: number;
  image?: { medium: string; original: string } | null;
  summary?: string | null;
  network?: { name: string; country?: { name: string } | null } | null;
  webChannel?: { name: string } | null;
  externals?: { imdb?: string | null; thetvdb?: number | null };
  _embedded?: {
    episodes?: TVMazeEpisode[];
    cast?: TVMazeCastEntry[];
  };
}

interface TVMazeEpisode {
  name: string;
  season: number;
  number: number | null;
  runtime?: number | null;
  image?: { medium: string } | null;
  summary?: string | null;
}

interface TVMazeCastEntry {
  person: { name: string; image?: { medium: string } | null };
  character: { name: string };
  voice: boolean;
}

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, "").trim();
}

export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapShow(s: TVMazeShow): Media {
  const cast: CastMember[] = (s._embedded?.cast ?? [])
    .filter((c) => !c.voice)
    .slice(0, 20)
    .map((c) => ({
      name: c.person.name,
      role: c.character.name,
      image: c.person.image?.medium ?? undefined,
    }));

  const network = s.network?.name ?? s.webChannel?.name;

  return {
    id: `tvmaze:${s.id}`,
    type: "series",
    title: s.name,
    poster: s.image?.original ?? s.image?.medium ?? "",
    synopsis: stripHtml(s.summary),
    year: s.premiered ? parseInt(s.premiered.slice(0, 4), 10) : undefined,
    rating: s.rating.average ?? undefined,
    genres: s.genres,
    status: s.status,
    cast,
    country: s.network?.country?.name ?? undefined,
    airedFrom: s.premiered ?? undefined,
    airedTo: s.ended ?? undefined,
    duration: s.averageRuntime ?? undefined,
    studios: network ? [network] : undefined,
  };
}

function mapEpisodes(eps: TVMazeEpisode[]): Episode[] {
  const bySeason = new Map<number, TVMazeEpisode[]>();
  for (const ep of eps) {
    if (ep.number === null) continue;
    const arr = bySeason.get(ep.season) ?? [];
    arr.push(ep);
    bySeason.set(ep.season, arr);
  }

  const result: Episode[] = [];
  let globalNum = 0;
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    const seasonEps = (bySeason.get(season) ?? []).sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0)
    );
    for (const ep of seasonEps) {
      globalNum++;
      result.push({
        number: globalNum,
        episodeInSeason: ep.number ?? globalNum,
        seasonNumber: ep.season,
        title: ep.name || `Episode ${ep.number}`,
        thumbnail: ep.image?.medium ?? undefined,
        description: stripHtml(ep.summary) || undefined,
        duration: ep.runtime ?? undefined,
      });
    }
  }
  return result;
}

const tvmaze: Provider & {
  getTrending(): Promise<Media[]>;
  getOnAir(): Promise<Media[]>;
  getByGenre(genre: string): Promise<Media[]>;
  getSimilar(externalId: string): Promise<Media[]>;
} = {
  async search(query: string): Promise<Media[]> {
    const data = await apiFetch<{ score: number; show: TVMazeShow }[]>(
      `/search/shows?q=${encodeURIComponent(query)}`
    );
    return data.map((r) => mapShow(r.show));
  },

  async getDetail(externalId: string): Promise<Media> {
    const key = `tvmaze-detail:${externalId}`;
    const hit = cache.get<Media>(key);
    if (hit) return hit;
    const data = await apiFetch<TVMazeShow>(`/shows/${externalId}?embed[]=cast`);
    const media = mapShow(data);
    cache.set(key, media, 60 * 60 * 1000);
    return media;
  },

  async getEpisodes(externalId: string): Promise<Episode[]> {
    const key = `tvmaze-eps:${externalId}`;
    const hit = cache.get<Episode[]>(key);
    if (hit) return hit;
    const data = await apiFetch<TVMazeEpisode[]>(`/shows/${externalId}/episodes`);
    const episodes = mapEpisodes(data);
    cache.set(key, episodes, 60 * 60 * 1000);
    return episodes;
  },

  async getStream(_externalId: string, _episode: number): Promise<StreamResult> {
    throw new Error("Use the /tv/:id/stream route for TV streaming.");
  },

  async getSimilar(externalId: string): Promise<Media[]> {
    const show = await tvmaze.getDetail(externalId);
    if (!show.genres.length) return [];
    const byGenre = await tvmaze.getByGenre(show.genres[0]);
    return byGenre.filter((m) => m.id !== show.id).slice(0, 16);
  },

  async getTrending(): Promise<Media[]> {
    const key = "tvmaze-trending";
    const hit = cache.get<Media[]>(key);
    if (hit) return hit;
    const data = await apiFetch<TVMazeShow[]>(`/shows?page=0`);
    const sorted = [...data].sort((a, b) => b.weight - a.weight).slice(0, 25);
    const result = sorted.map(mapShow);
    cache.set(key, result, 60 * 60 * 1000);
    return result;
  },

  async getByGenre(genre: string): Promise<Media[]> {
    const key = `tvmaze-genre:${genre.toLowerCase()}`;
    const hit = cache.get<Media[]>(key);
    if (hit) return hit;

    const pages = await Promise.allSettled([
      apiFetch<TVMazeShow[]>(`/shows?page=0`),
      apiFetch<TVMazeShow[]>(`/shows?page=1`),
      apiFetch<TVMazeShow[]>(`/shows?page=2`),
    ]);

    const all: TVMazeShow[] = pages.flatMap((p) =>
      p.status === "fulfilled" ? p.value : []
    );

    const result = all
      .filter((s) => s.genres.includes(genre))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 30)
      .map(mapShow);

    if (result.length > 0) cache.set(key, result, 60 * 60 * 1000);
    return result;
  },

  async getOnAir(): Promise<Media[]> {
    const key = "tvmaze-onair";
    const hit = cache.get<Media[]>(key);
    if (hit) return hit;
    const today = new Date().toISOString().slice(0, 10);
    const data = await apiFetch<{ show: TVMazeShow }[]>(
      `/schedule?country=US&date=${today}`
    );
    const seen = new Set<number>();
    const result: Media[] = [];
    for (const { show } of data) {
      if (!seen.has(show.id) && show.weight > 20) {
        seen.add(show.id);
        result.push(mapShow(show));
        if (result.length >= 20) break;
      }
    }
    cache.set(key, result, 30 * 60 * 1000);
    return result;
  },
};

export default tvmaze;
