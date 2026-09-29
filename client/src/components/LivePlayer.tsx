import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { LiveStream } from "../lib/types";

// Public live streams die, geo-block or stall constantly, so a source that hasn't started
// within this window is abandoned for the next one.
const STARTUP_TIMEOUT_MS = 15_000;

interface LivePlayerProps {
  streams: LiveStream[];
  channelName: string;
}

export function LivePlayer({ streams, channelName }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sources] = useState(() => toSources(streams));
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "playing" | "failed">(sources.length ? "loading" : "failed");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    const source = sources[index];
    if (!video || !source) return;

    setStatus("loading");
    let hls: Hls | null = null;
    let isDone = false;
    const tryNext = () => {
      if (isDone) return;
      isDone = true;
      if (index + 1 < sources.length) setIndex(index + 1);
      else setStatus("failed");
    };

    const startupTimer = setTimeout(tryNext, STARTUP_TIMEOUT_MS);
    const handlePlaying = () => {
      clearTimeout(startupTimer);
      setStatus("playing");
    };
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", tryNext);

    if (Hls.isSupported()) {
      hls = new Hls({ manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2 });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) tryNext(); });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => { /* autoplay blocked — controls stay visible */ }); });
      hls.loadSource(source);
      hls.attachMedia(video);
    } else {
      // Safari and many smart-TV browsers play HLS natively
      video.src = source;
      video.play().catch(() => { /* autoplay blocked — controls stay visible */ });
    }

    return () => {
      isDone = true;
      clearTimeout(startupTimer);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("error", tryNext);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [sources, index, attempt]);

  function handleRetry() {
    setIndex(0);
    setAttempt((a) => a + 1);
  }

  const hasGeoBlockedStreams = streams.some((s) => s.isGeoBlocked);

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "var(--bg)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
      <video
        ref={videoRef}
        controls
        playsInline
        aria-label={`${channelName} live stream`}
        style={{ width: "100%", height: "100%", display: status === "failed" ? "none" : "block", background: "var(--bg)" }}
      />

      {status === "loading" && (
        <div aria-live="polite" className="mono" style={{
          position: "absolute", top: 12, left: 12, padding: "4px 8px", borderRadius: 4,
          background: "var(--surf-2)", color: "var(--muted)", fontSize: 11, letterSpacing: 0.5,
          pointerEvents: "none",
        }}>
          Connecting… source {index + 1} of {sources.length}
        </div>
      )}

      {status === "playing" && (
        <div className="mono" style={{
          position: "absolute", top: 12, left: 12, padding: "3px 8px", borderRadius: 4,
          background: "var(--accent)", color: "var(--text)", fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
          pointerEvents: "none",
        }}>
          ● LIVE
        </div>
      )}

      {status === "failed" && (
        <div role="alert" style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center",
        }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>This channel isn't playing right now</p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", maxWidth: 420 }}>
            {sources.length === 0
              ? "There is no playable stream for this channel."
              : `All ${sources.length} sources failed.${hasGeoBlockedStreams ? " Some are only available in the channel's home country." : ""} Public streams go offline often. Try again later or pick another channel.`}
          </p>
          {sources.length > 0 && (
            <button
              onClick={handleRetry}
              data-tv-autofocus
              style={{
                minHeight: 44, padding: "10px 20px", borderRadius: 6, fontSize: 14, fontWeight: 600,
                background: "var(--accent)", color: "var(--text)", border: "1px solid var(--accent)",
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Direct playback is fastest but fails on hosts without CORS or that require specific
// headers; the server proxy handles both, so it is always the fallback.
function toSources(streams: LiveStream[]): string[] {
  const sources: string[] = [];
  for (const s of streams) {
    const needsHeaders = !!(s.referrer || s.userAgent);
    const isMixedContent = window.location.protocol === "https:" && s.url.startsWith("http:");
    if (!needsHeaders && !isMixedContent) sources.push(s.url);

    const params = new URLSearchParams({ url: s.url });
    if (s.referrer) params.set("ref", s.referrer);
    if (s.userAgent) params.set("ua", s.userAgent);
    sources.push(`/api/proxy/hls?${params}`);
  }
  return sources;
}
