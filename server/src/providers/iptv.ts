// Live TV directory from iptv-org (github.com/iptv-org/iptv): a community-maintained index of
// publicly available streams, tagged with category, language and country.
// The raw API is ~25 MB across several files, so it is joined once into a compact catalog
// and refreshed every 12 hours. A failed refresh keeps serving the previous catalog.

const API = "https://iptv-org.github.io/api";
const REFRESH_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 90_000;
const UNCATEGORIZED = { id: "uncategorized", name: "Other" };

// hls.js plays HLS; these formats need other players (DASH, Flash, web pages)
const UNPLAYABLE_EXT = /\.(mpd|flv|htm|html|smil)$/i;

export interface LiveStream {
  url: string;
  quality: string | null;
  referrer: string | null;
  userAgent: string | null;
  isGeoBlocked: boolean;
  isNot247: boolean;
}

export interface LiveChannel {
  id: string;
  name: string;
  logo: string | null;
  country: string | null;
  categories: string[];
  languages: string[];
  website: string | null;
  streams: LiveStream[];
}

export interface LiveCatalog {
  channels: LiveChannel[];
  categories: { id: string; name: string }[];
  languages: { code: string; name: string }[];
  countries: { code: string; name: string; flag: string }[];
  updatedAt: number;
}

interface RawChannel {
  id: string; name: string; country: string | null; categories: string[];
  is_nsfw: boolean; closed: string | null; website: string | null;
}
interface RawStream {
  channel: string | null; feed: string | null; url: string; quality: string | null;
  labels: string[]; user_agent: string | null; referrer: string | null;
}
interface RawFeed { channel: string; id: string; is_main: boolean; languages: string[] }
interface RawLogo { channel: string; feed: string | null; in_use: boolean; width: number; url: string }

let catalog: LiveCatalog | null = null;
let inFlight: Promise<LiveCatalog> | null = null;

export async function getLiveCatalog(): Promise<LiveCatalog> {
  if (catalog && Date.now() - catalog.updatedAt < REFRESH_MS) return catalog;
  if (inFlight) return inFlight;

  inFlight = buildCatalog()
    .then((fresh) => (catalog = fresh))
    .catch((err: unknown) => {
      if (catalog) {
        console.error("[iptv] refresh failed, serving previous catalog:", err);
        return catalog;
      }
      throw err;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${API}/${file}.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`iptv-org ${file}.json → ${res.status}`);
  return res.json() as Promise<T>;
}

async function buildCatalog(): Promise<LiveCatalog> {
  const [rawChannels, rawStreams, rawFeeds, rawLogos, rawCategories, rawLanguages, rawCountries, blocklist] =
    await Promise.all([
      fetchJson<RawChannel[]>("channels"),
      fetchJson<RawStream[]>("streams"),
      fetchJson<RawFeed[]>("feeds"),
      fetchJson<RawLogo[]>("logos"),
      fetchJson<{ id: string; name: string }[]>("categories"),
      fetchJson<{ code: string; name: string }[]>("languages"),
      fetchJson<{ code: string; name: string; flag: string }[]>("countries"),
      fetchJson<{ channel: string }[]>("blocklist"),
    ]);

  const blocked = new Set(blocklist.map((b) => b.channel));
  const channelsById = new Map(
    rawChannels
      .filter((c) => !c.is_nsfw && !c.closed && !blocked.has(c.id))
      .map((c) => [c.id, c])
  );

  // A stream's language lives on its feed; streams without a feed use the channel's main feed.
  const feedLanguages = new Map<string, string[]>();
  for (const f of rawFeeds) {
    feedLanguages.set(`${f.channel}@${f.id}`, f.languages);
    if (f.is_main) feedLanguages.set(`${f.channel}@`, f.languages);
  }

  const logoByChannel = new Map<string, RawLogo>();
  for (const logo of rawLogos) {
    if (!logo.in_use || logo.feed) continue;
    const current = logoByChannel.get(logo.channel);
    if (!current || logo.width > current.width) logoByChannel.set(logo.channel, logo);
  }

  const byChannel = new Map<string, LiveChannel>();
  for (const s of rawStreams) {
    if (!s.channel || UNPLAYABLE_EXT.test(safePathname(s.url))) continue;
    const raw = channelsById.get(s.channel);
    if (!raw) continue;

    let channel = byChannel.get(raw.id);
    if (!channel) {
      channel = {
        id: raw.id,
        name: raw.name,
        logo: logoByChannel.get(raw.id)?.url ?? null,
        country: raw.country,
        categories: raw.categories.length > 0 ? raw.categories : [UNCATEGORIZED.id],
        languages: [],
        website: raw.website,
        streams: [],
      };
      byChannel.set(raw.id, channel);
    }

    const languages = feedLanguages.get(`${raw.id}@${s.feed ?? ""}`) ?? feedLanguages.get(`${raw.id}@`) ?? [];
    for (const lang of languages) if (!channel.languages.includes(lang)) channel.languages.push(lang);

    channel.streams.push({
      url: s.url,
      quality: s.quality,
      referrer: s.referrer,
      userAgent: s.user_agent,
      isGeoBlocked: s.labels.includes("Geo-blocked"),
      isNot247: s.labels.includes("Not 24/7"),
    });
  }

  const channels = [...byChannel.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of channels) c.streams.sort(compareStreams);

  const usedLanguages = new Set(channels.flatMap((c) => c.languages));
  const usedCountries = new Set(channels.map((c) => c.country));

  return {
    channels,
    categories: [...rawCategories, UNCATEGORIZED],
    languages: rawLanguages.filter((l) => usedLanguages.has(l.code)),
    countries: rawCountries.filter((c) => usedCountries.has(c.code)),
    updatedAt: Date.now(),
  };
}

// Try streams that are most likely to play first: always-on, not geo-blocked, higher quality.
function compareStreams(a: LiveStream, b: LiveStream): number {
  const penalty = (s: LiveStream) => (s.isGeoBlocked ? 2 : 0) + (s.isNot247 ? 1 : 0);
  return penalty(a) - penalty(b) || parseInt(b.quality ?? "0", 10) - parseInt(a.quality ?? "0", 10);
}

function safePathname(url: string): string {
  try { return new URL(url).pathname; } catch { return ""; }
}
