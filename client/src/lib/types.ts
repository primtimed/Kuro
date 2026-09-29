export type MediaType = "anime" | "movie" | "series" | "twitch";

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
  servers?: { name: string; url: string }[]; // alternative embeds for the same episode
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

export interface StreamingSite {
  rank: number;
  slug: string;
  name: string;
  url: string;
  isSupported: boolean;
}

export interface LiveStream {
  url: string;
  quality: string | null;
  referrer: string | null;
  userAgent: string | null;
  isGeoBlocked: boolean;
  isNot247: boolean;
}

export interface LiveChannelSummary {
  id: string;
  name: string;
  logo: string | null;
  country: string | null;
  categories: string[];
  languages: string[];
  website: string | null;
  streamCount: number;
}

export interface LiveChannel extends Omit<LiveChannelSummary, "streamCount"> {
  streams: LiveStream[];
}

export interface LiveFilters {
  total: number;
  updatedAt: number;
  categories: { id: string; name: string; count: number }[];
  languages: { code: string; name: string; count: number }[];
  countries: { code: string; name: string; flag: string; count: number }[];
}

export interface LiveChannelQuery {
  category?: string;
  language?: string;
  country?: string;
  q?: string;
  favorites?: "1";
  offset?: number;
  limit?: number;
}

export interface HouseholdProfile {
  id: string;
  name: string;
  color: string;
  initial: string;
  isShared: boolean;
  isOwner: boolean;
  needsPin: boolean;
  hasPin: boolean;
}

export interface Me {
  owner: { id: string; name: string; isAdmin: boolean };
  activeProfileId: string;
  device: { name: string; kind: "browser" | "tv" };
  profiles: HouseholdProfile[];
}

export interface SignedInDevice {
  id: string;
  name: string;
  kind: "browser" | "tv";
  ownerName: string;
  createdAt: number;
  lastUsedAt: number;
  isCurrent: boolean;
}

export interface FamilyProfile {
  id: string;
  name: string;
  color: string;
  initial: string;
  isAdmin: boolean;
  isShared: boolean;
  googleEmail: string | null;
  isLinked: boolean;
  hasPin: boolean;
  lastActiveAt: number | null;
  inviteExpiresAt: number | null;
}

export interface InviteInfo {
  kind: "invite" | "setup";
  profile: { name: string; color: string; initial: string };
}
