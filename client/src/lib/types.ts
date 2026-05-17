export type MediaType = "anime" | "movie" | "series" | "twitch";

export interface CustomScraper {
  id: string;
  name: string;
  url: string;
  source: string;
  audio: ("sub" | "dub")[];
}

export interface ScraperSettings {
  sub_order: string[];
  dub_order: string[];
  scraper_urls: Record<string, string>;
  custom_scrapers: CustomScraper[];
}

export interface ScraperDef {
  id: string;
  name: string;
  defaultUrl: string;
  note: string;
  audio: ("sub" | "dub")[];
  knownDomains: readonly string[];
}

export interface CastMember {
  name: string;
  role: string;
  image?: string;
}

export interface Episode {
  number: number;           // global key (unique across all seasons)
  episodeInSeason?: number; // display number within its season
  title: string;
  thumbnail?: string;
  description?: string;
  seasonNumber?: number;
  streamUrl?: string;
  duration?: number;        // minutes
}

export interface Media {
  id: string;
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

export interface EpisodeAvail {
  hasSub: boolean;
  hasDub: boolean;
}

export interface SkipTimes {
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
}

export interface StreamResult {
  url: string;
  type: "hls" | "mp4" | "embed";
  subtitles: SubtitleTrack[];
  headers?: Record<string, string>;
  dubbed?: boolean;
  watchUrl?: string; // fallback link to source site when embed couldn't be extracted
}

export interface SubtitleTrack {
  url: string;
  lang: string;
  label: string;
}

export interface HistoryEntry {
  media_id: string;
  episode_number: number;
  progress_seconds: number;
  duration_seconds?: number;
  last_watched: number;
  is_dub?: number;
  content_tag?: string;
}

export interface FavoriteEntry {
  media_id: string;
  type: string;
  title: string;
  poster?: string;
  added_at: number;
  content_tag?: string;
}

export interface LikeEntry {
  media_id: string;
  rating: number;
  title: string;
  poster?: string;
  liked_at: number;
  content_tag?: string;
}
