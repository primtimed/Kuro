import { spawn } from "node:child_process";

import type { LiveChannel } from "../providers/iptv.js";

// Channel tiles show a still from the live stream, refreshed about once a minute. Captures run
// in the background so a request never waits on ffmpeg: it gets the latest still (or nothing
// yet) and the next minute's request picks up the fresh one.
const PREVIEW_TTL_MS = 60_000;
// Dead or geo-blocked streams fail every time; leave them alone for a while instead of retrying.
const FAILURE_TTL_MS = 10 * 60_000;
const CAPTURE_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_CAPTURES = 6;
const MAX_QUEUED = 80;
const MAX_CACHED = 400;
const PREVIEW_WIDTH = 480;
const MIN_IMAGE_BYTES = 1_000;

interface PreviewEntry {
  image: Buffer | null;
  capturedAt: number;
  failedAt: number | null;
}

const cache = new Map<string, PreviewEntry>();
const queue: LiveChannel[] = [];
const queuedIds = new Set<string>();
let runningCount = 0;
let isFfmpegMissing = false;

/** Latest still for the channel (null until one exists); schedules a refresh when it's stale. */
export function getLivePreview(channel: LiveChannel): Buffer | null {
  const entry = cache.get(channel.id);
  if (!isFresh(entry)) enqueue(channel);
  return entry?.image ?? null;
}

function isFresh(entry: PreviewEntry | undefined): boolean {
  if (!entry) return false;
  const now = Date.now();
  if (entry.failedAt !== null && now - entry.failedAt < FAILURE_TTL_MS) return true;
  return entry.image !== null && now - entry.capturedAt < PREVIEW_TTL_MS;
}

function enqueue(channel: LiveChannel) {
  if (isFfmpegMissing || queuedIds.has(channel.id) || queue.length >= MAX_QUEUED) return;
  queuedIds.add(channel.id);
  queue.push(channel);
  pump();
}

function pump() {
  while (runningCount < MAX_CONCURRENT_CAPTURES && queue.length > 0) {
    // Newest first: the tiles someone is looking at right now beat ones they've scrolled past.
    const channel = queue.pop()!;
    runningCount++;
    captureStill(channel)
      .then((image) => store(channel.id, { image, capturedAt: Date.now(), failedAt: null }))
      .catch((err: unknown) => {
        // Keep the last good still on screen; just stop retrying for a while.
        const previous = cache.get(channel.id);
        store(channel.id, { image: previous?.image ?? null, capturedAt: previous?.capturedAt ?? 0, failedAt: Date.now() });
        if (err instanceof FfmpegMissingError) {
          isFfmpegMissing = true;
          console.error("[live-preview] ffmpeg is not installed; channel previews are disabled");
        }
      })
      .finally(() => {
        runningCount--;
        queuedIds.delete(channel.id);
        pump();
      });
  }
}

function store(id: string, entry: PreviewEntry) {
  // Map keeps insertion order, so re-inserting makes this the most recent and the first key the oldest.
  cache.delete(id);
  cache.set(id, entry);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

class FfmpegMissingError extends Error {}

function captureStill(channel: LiveChannel): Promise<Buffer> {
  const stream = channel.streams.find((s) => !s.isGeoBlocked && /^https?:\/\//i.test(s.url));
  if (!stream) return Promise.reject(new Error("no capturable stream"));

  const args = ["-hide_banner", "-loglevel", "error", "-rw_timeout", "10000000"];
  if (stream.userAgent) args.push("-user_agent", stream.userAgent);
  if (stream.referrer) args.push("-referer", stream.referrer);
  args.push(
    "-i", stream.url,
    "-frames:v", "1",
    "-vf", `scale=${PREVIEW_WIDTH}:-2`,
    "-q:v", "6",
    "-f", "image2", "-c:v", "mjpeg", "pipe:1",
  );

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => ffmpeg.kill("SIGKILL"), CAPTURE_TIMEOUT_MS);

    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new FfmpegMissingError("ffmpeg not found") : err);
    });
    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      const image = Buffer.concat(chunks);
      if (code === 0 && image.length >= MIN_IMAGE_BYTES) resolve(image);
      else reject(new Error(`capture failed for ${channel.id} (exit ${code})`));
    });
  });
}
