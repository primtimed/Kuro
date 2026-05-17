import WebTorrent from "webtorrent";
import path from "path";
import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";

const DOWNLOAD_DIR = process.env.TORRENT_DIR ?? path.join(process.cwd(), "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const MIN_SEEDERS = 3; // prefer torrents with at least this many seeders
const STREAM_TIMEOUT_MS = 25000; // give up if no data within 25 seconds
const PREFETCH_BYTES = 10 * 1024 * 1024; // 10 MB pre-buffered per active episode

// Singleton client — persists across requests
let _client: WebTorrent.Instance | null = null;
function client(): WebTorrent.Instance {
  if (!_client) {
    _client = new WebTorrent();
    _client.on("error", (err) => {
      console.error("[webtorrent] client error:", err);
    });
  }
  return _client;
}

interface ActiveDownload {
  infoHash: string;
  filePath: string; // absolute path to the selected video file on disk
}
// key = `${mediaId}:${episode}`
const active = new Map<string, ActiveDownload>();
// filePath → first PREFETCH_BYTES, filled in background after addTorrent resolves
const ramBuffer = new Map<string, Buffer>();

function bufferFileHead(file: WebTorrent.TorrentFile, filePath: string): void {
  if (ramBuffer.has(filePath)) return;
  const stream = file.createReadStream({ start: 0, end: PREFETCH_BYTES - 1 }) as import("stream").Readable;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => ramBuffer.set(filePath, Buffer.concat(chunks)));
  stream.on("error", () => {}); // torrent not ready yet — buffer fills later when pieces arrive
}

// ── nyaa.si search ──────────────────────────────────────────────────────────

interface NyaaResult {
  title: string;
  magnet: string; // may be a magnet URI or a .torrent URL
  seeders: number;
}

export async function searchNyaa(query: string): Promise<NyaaResult[]> {
  const url = `https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=1_2&f=0`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`nyaa.si ${res.status}`);
  const xml = await res.text();

  const out: NyaaResult[] = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const item = m[1];
    const title =
      item.match(/<title><!\[CDATA\[([^\]]+)\]\]>/)?.[1] ??
      item.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    // Prefer the .torrent download link (has full tracker list) over a constructed magnet
    const torrentUrl = item.match(/<link>(https?:\/\/nyaa\.si\/download\/[^<]+)<\/link>/)?.[1] ?? "";
    const magnet = torrentUrl || (item.match(/magnet:\?[^<"&\s]+/)?.[0] ?? "");
    const seeders = parseInt(item.match(/<nyaa:seeders>(\d+)<\/nyaa:seeders>/)?.[1] ?? "0", 10);
    if (title && magnet) out.push({ title, magnet, seeders });
  }
  return out;
}

const isDubRelease = (t: string) => /\bdub\b|dual.?audio/i.test(t);
const isHevc = (t: string) => /hevc|x265|h\.265/i.test(t);

// Returns true if the title has NO explicit season marker OR the season matches
function matchesSeason(title: string, season: number): boolean {
  // Match "S01E01" or "S01 " style, or "Season 1"
  const m = title.match(/S(?:eason\s*)?0*(\d+)(?:E\d|[^\d]|$)/i);
  if (!m) return true; // no season marker — assume it could be any season
  return parseInt(m[1], 10) === season;
}

function pickBest(results: NyaaResult[], episode: number, season: number, wantDub: boolean): NyaaResult | null {
  const ep = String(episode).padStart(2, "0");
  const epRx = [new RegExp(`- ${ep}[^\\d]`), new RegExp(`E${ep}\\b`, "i"), new RegExp(`\\b${ep}\\b`)];
  const matching = results.filter((r) => epRx.some((rx) => rx.test(r.title)));
  if (!matching.length) return null;

  // Prefer results that match the requested season; fall back if nothing matches
  const seasonFiltered = matching.filter((r) => matchesSeason(r.title, season));
  const episodePool = seasonFiltered.length > 0 ? seasonFiltered : matching;

  let pool = wantDub
    ? episodePool.filter((r) => isDubRelease(r.title))
    : episodePool.filter((r) => !isDubRelease(r.title));
  // Don't fall back to wrong type — return null so findTorrent can try more queries
  if (!pool.length) return null;

  // Exclude HEVC (browser-incompatible)
  const noHevc = pool.filter((r) => !isHevc(r.title));
  const candidates = (noHevc.length ? noHevc : pool).sort((a, b) => b.seeders - a.seeders);

  if (wantDub) {
    // Prefer dedicated dub releases over Dual-Audio if well-seeded
    const dedicated = candidates.filter((r) => /\bdub\b/i.test(r.title) && !/dual.?audio/i.test(r.title));
    if (dedicated.length > 0 && dedicated[0].seeders >= 5) return dedicated[0];
  }

  return candidates[0] ?? null;
}

// Pick a season-batch result (season marker preferred, but also accepts no-marker batches)
function pickBestBatch(results: NyaaResult[], season: number, wantDub: boolean): NyaaResult | null {
  const s = String(season).padStart(2, "0");
  const seasonRx = [new RegExp(`S${s}(?!E)`, "i"), new RegExp(`Season ${season}\\b`, "i")];
  const episodeMarker = /E\d{2}\b|- \d{2}[^\d]/i;

  const seasonBatches = results.filter(
    (r) => seasonRx.some((rx) => rx.test(r.title)) && !episodeMarker.test(r.title)
  );
  // Single-season shows often omit the S01 marker in batch releases — use those too
  const anyBatch = results.filter((r) => !episodeMarker.test(r.title));
  const candidatePool = seasonBatches.length > 0 ? seasonBatches : anyBatch;

  if (!candidatePool.length) return null;

  const pool = wantDub
    ? candidatePool.filter((r) => isDubRelease(r.title))
    : candidatePool.filter((r) => !isDubRelease(r.title));
  if (!pool.length) return null;

  const noHevc = pool.filter((r) => !isHevc(r.title));
  return (noHevc.length ? noHevc : pool).sort((a, b) => b.seeders - a.seeders)[0] ?? null;
}

export async function findTorrent(
  titles: string[],
  episode: number,
  season: number,
  wantDub: boolean
): Promise<NyaaResult> {
  const ep = String(episode).padStart(2, "0");
  const s = String(season).padStart(2, "0");

  const queries: string[] = [];
  for (const t of titles.slice(0, 3)) {
    queries.push(`${t} S${s}E${ep}`, `${t} - ${ep}`, `${t} ${ep}`);
    if (wantDub) queries.push(`${t} dual S${s}E${ep}`, `${t} dual ${ep}`, `${t} dub S${s}E${ep}`, `${t} dub ${ep}`);
  }

  // Run all episode queries in parallel to avoid multi-minute sequential waits
  const episodeResults = await Promise.allSettled(queries.map((q) => searchNyaa(q)));
  let bestIndividual: NyaaResult | null = null;

  for (const r of episodeResults) {
    if (r.status === "rejected") continue;
    const best = pickBest(r.value, episode, season, wantDub);
    if (!best) continue;
    if (best.seeders >= MIN_SEEDERS) return best;
    if (!bestIndividual || best.seeders > bestIndividual.seeders) bestIndividual = best;
  }

  // Episode queries returned low-seeder results — try season batch as fallback
  const batchQueries: string[] = [];
  for (const t of titles.slice(0, 3)) {
    if (wantDub) {
      batchQueries.push(`${t} S${s} dub`, `${t} dub`);
    } else {
      batchQueries.push(`${t} S${s}`, `${t} batch`);
    }
  }

  const batchResults = await Promise.allSettled(batchQueries.map((q) => searchNyaa(q)));
  for (const r of batchResults) {
    if (r.status === "rejected") continue;
    const batch = pickBestBatch(r.value, season, wantDub);
    if (batch && batch.seeders >= MIN_SEEDERS) {
      if (!bestIndividual || batch.seeders > bestIndividual.seeders + 2) {
        console.log(`[torrent] Using batch "${batch.title}" (${batch.seeders} seeders) for ep ${episode}`);
        return batch;
      }
    }
  }

  if (bestIndividual) return bestIndividual; // best we found, even if low-seeded
  throw new Error("No torrent found on nyaa.si for this episode");
}

// ── Torrent management ──────────────────────────────────────────────────────

// Episode-aware file picker: for batch torrents, find the specific episode file
function findVideoFile(torrent: WebTorrent.Torrent, episode?: number): WebTorrent.TorrentFile | undefined {
  const videoFiles = torrent.files.filter((f) => /\.(mp4|mkv|webm|avi)$/i.test(f.name));
  if (!videoFiles.length) return undefined;

  if (episode !== undefined && videoFiles.length > 1) {
    const ep = String(episode).padStart(2, "0");
    const epPatterns = [
      new RegExp(`E${ep}\\b`, "i"),
      new RegExp(`- ${ep}[^\\d]`),
      new RegExp(`[ _]${ep}[ _\\[\\(\\.]`),
    ];
    const match = videoFiles.find((f) => epPatterns.some((rx) => rx.test(f.name)));
    if (match) return match;
  }

  return videoFiles.sort((a, b) => b.length - a.length)[0];
}

// Extract episode number from key format "mediaId:episode" (e.g. "anilist:146850:1")
function episodeFromKey(key: string): number | undefined {
  const n = parseInt(key.split(":").pop() ?? "", 10);
  return isNaN(n) ? undefined : n;
}

const ADD_TORRENT_TIMEOUT_MS = 30000;

export function addTorrent(
  key: string,
  torrentId: string
): Promise<{ infoHash: string; fileName: string; fileSize: number }> {
  const episode = episodeFromKey(key);

  return new Promise((resolve, reject) => {
    // Re-use if this key is already tracked
    const tracked = active.get(key);
    if (tracked) {
      const t = client().torrents.find((t) => t.infoHash === tracked.infoHash);
      if (t) {
        const file = findVideoFile(t, episode);
        if (file) return resolve({ infoHash: t.infoHash, fileName: file.name, fileSize: file.length });
      }
    }

    const timer = setTimeout(() => {
      reject(new Error("Torrent metadata fetch timed out — no peers available"));
    }, ADD_TORRENT_TIMEOUT_MS);

    client().add(torrentId, { path: DOWNLOAD_DIR }, (torrent) => {
      clearTimeout(timer);
      torrent.on("error", (err) => console.error("[webtorrent] torrent error:", err));
      const file = findVideoFile(torrent, episode);
      if (!file) return reject(new Error("No video file in torrent"));
      const filePath = path.join(DOWNLOAD_DIR, file.path);
      active.set(key, { infoHash: torrent.infoHash, filePath });
      bufferFileHead(file, filePath);
      resolve({ infoHash: torrent.infoHash, fileName: file.name, fileSize: file.length });
    });
  });
}

export function streamTorrentFile(
  key: string,
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const dl = active.get(key);
  if (!dl) return false;

  const torrent = client().torrents.find((t) => t.infoHash === dl.infoHash);
  if (!torrent) return false;

  // Use the stored file path to find the specific file (handles batch torrents correctly)
  const file =
    torrent.files.find((f) => path.join(DOWNLOAD_DIR, f.path) === dl.filePath) ??
    findVideoFile(torrent, episodeFromKey(key));
  if (!file) return false;

  const fileSize = file.length;
  const ext = path.extname(file.name).toLowerCase();
  const mime = ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : "video/x-matroska";

  const rangeHeader = req.headers.range;
  let start = 0;
  let end = fileSize - 1;
  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    start = parseInt(startStr, 10);
    end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
  }

  // Serve from RAM buffer if the entire requested range is already buffered
  const buf = ramBuffer.get(dl.filePath);
  if (buf && end < buf.length) {
    const slice = buf.subarray(start, end + 1);
    if (rangeHeader) {
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": slice.length,
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
      });
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
      });
    }
    res.end(slice);
    return true;
  }

  const readStream = file.createReadStream({ start, end }) as import("stream").Readable;

  // If no data arrives within STREAM_TIMEOUT_MS the torrent has no peers yet
  const noDataTimer = setTimeout(() => {
    readStream.destroy(new Error("torrent has no peers"));
  }, STREAM_TIMEOUT_MS);

  readStream.once("readable", () => {
    clearTimeout(noDataTimer);
    if (!res.headersSent) {
      if (rangeHeader) {
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": end - start + 1,
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
        });
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
        });
      }
      readStream.pipe(res);
    }
  });

  readStream.on("error", (err) => {
    clearTimeout(noDataTimer);
    if (!res.headersSent) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Torrent not ready: ${(err as Error).message}` }));
    } else {
      res.destroy();
    }
  });

  return true;
}

export function getTorrentProgress(key: string): number | null {
  const dl = active.get(key);
  if (!dl) return null;
  const t = client().torrents.find((t) => t.infoHash === dl.infoHash);
  return t ? Math.round(t.progress * 100) : null;
}

export function deleteTorrentFile(key: string): boolean {
  const dl = active.get(key);
  if (!dl) return false;

  const torrent = client().torrents.find((t) => t.infoHash === dl.infoHash);
  if (torrent) {
    torrent.destroy({ destroyStore: true });
  } else if (fs.existsSync(dl.filePath)) {
    // Torrent already gone but file remains
    try { fs.unlinkSync(dl.filePath); } catch { /* ignore */ }
  }

  ramBuffer.delete(dl.filePath);
  active.delete(key);
  return true;
}
