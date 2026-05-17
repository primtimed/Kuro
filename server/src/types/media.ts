export type MediaType = "anime" | "movie" | "series" | "twitch";

export interface CastMember {
  name: string;
  role: string;
  image?: string;
}

export interface Episode {
  number: number;         // global key (unique across all seasons)
  episodeInSeason?: number; // display number within its season
  title: string;
  thumbnail?: string;
  description?: string;
  seasonNumber?: number;
  streamUrl?: string;
  duration?: number;      // minutes
}

export interface Media {
  id: string; // "{provider}:{externalId}"
  type: MediaType;
  title: string;
  altTitles?: string[];
  poster: string;
  banner?: string;
  synopsis: string;
  year?: number;
  rating?: number;
  popularity?: number;
  genres: string[];
  status?: string;
  cast: CastMember[];
  episodes?: Episode[];
  totalEpisodes?: number;
  trailer?: { site: string; id: string };
  country?: string;
  premiered?: string;
  airedFrom?: string;
  airedTo?: string;
  broadcast?: string;
  duration?: number;
  studios?: string[];
  producers?: string[];
  malId?: number;
  siteUrl?: string;
  mediaFormat?: string; // AniList format: TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL, MUSIC
}

export interface StreamResult {
  url: string;
  type: "hls" | "mp4" | "embed";
  subtitles: SubtitleTrack[];
  headers?: Record<string, string>;
  dubbed?: boolean;
  watchUrl?: string; // fallback: direct link to source site when embed isn't available
}

export interface SubtitleTrack {
  url: string;
  lang: string;
  label: string;
}

export interface Provider {
  search(query: string): Promise<Media[]>;
  getDetail(externalId: string): Promise<Media>;
  getEpisodes(externalId: string): Promise<Episode[]>;
  getStream(externalId: string, episode: number): Promise<StreamResult>;
}
