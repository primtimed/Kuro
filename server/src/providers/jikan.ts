import type { Media, Episode, StreamResult, Provider, CastMember } from "../types/media.js";

const BASE = "https://api.jikan.moe/v4";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Jikan ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAnime(a: any): Media {
  return {
    id: `jikan:${a.mal_id}`,
    type: "anime",
    title: a.title_english ?? a.title,
    altTitles: [a.title, a.title_japanese].filter(Boolean),
    poster: a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? "",
    banner: a.images?.jpg?.large_image_url,
    synopsis: a.synopsis ?? "",
    year: a.year ?? a.aired?.prop?.from?.year,
    rating: a.score,
    genres: (a.genres ?? []).map((g: { name: string }) => g.name),
    status: a.status,
    cast: [],
    totalEpisodes: a.episodes,
  };
}

const jikan: Provider = {
  async search(query: string): Promise<Media[]> {
    const data = await apiFetch<{ data: unknown[] }>(`/anime?q=${encodeURIComponent(query)}&limit=20`);
    return (data.data ?? []).map(mapAnime);
  },

  async getDetail(externalId: string): Promise<Media> {
    const [animeData, charactersData] = await Promise.all([
      apiFetch<{ data: unknown }>(`/anime/${externalId}/full`),
      apiFetch<{ data: Array<{ character: { name: string; images: { jpg: { image_url: string } } }; role: string }> }>(`/anime/${externalId}/characters`),
    ]);

    const media = mapAnime(animeData.data);
    media.cast = (charactersData.data ?? []).slice(0, 20).map(
      (c): CastMember => ({
        name: c.character.name,
        role: c.role,
        image: c.character.images?.jpg?.image_url,
      })
    );
    return media;
  },

  async getEpisodes(externalId: string): Promise<Episode[]> {
    type JikanEp = { mal_id: number; title: string };
    type JikanPage = { data: JikanEp[]; pagination: { last_visible_page: number; has_next_page: boolean } };

    const first = await apiFetch<JikanPage>(`/anime/${externalId}/episodes?page=1`);
    const all: JikanEp[] = [...(first.data ?? [])];

    const lastPage = first.pagination?.last_visible_page ?? 1;
    if (lastPage > 1) {
      // Fetch remaining pages sequentially to respect Jikan's rate limit (3 req/s)
      for (let p = 2; p <= Math.min(lastPage, 20); p++) {
        try {
          const page = await apiFetch<JikanPage>(`/anime/${externalId}/episodes?page=${p}`);
          all.push(...(page.data ?? []));
          if (!page.pagination?.has_next_page) break;
        } catch { break; }
      }
    }

    return all.map((ep) => ({
      number: ep.mal_id,
      title: ep.title ?? `Episode ${ep.mal_id}`,
    }));
  },

  async getStream(_externalId: string, _episode: number): Promise<StreamResult> {
    throw new Error("Jikan does not provide stream URLs. Use Consumet.");
  },
};

export default jikan;
