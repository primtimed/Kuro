import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { SkipForward } from "lucide-react";
import type { StreamResult, SkipTimes } from "../lib/types";
import { useProgress } from "../hooks/useProgress";

// Chrome MSE rejects mp4a.40.1 (HE-AAC label) but can decode it as mp4a.40.2 (AAC-LC).
// Patch once at module load so HLS.js's addSourceBuffer calls never see 40.1.
if (typeof MediaSource !== "undefined" && MediaSource.prototype.addSourceBuffer) {
  const _orig = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mimeType: string) {
    return _orig.call(this, mimeType.replace(/mp4a\.40\.1(?!\d)/g, "mp4a.40.2"));
  };
}

interface AudioTrack {
  id: number;
  name: string;
  lang: string;
}

interface PlayerProps {
  stream: StreamResult;
  mediaId: string;
  episode: number;
  isDub?: boolean;
  onEnded?: () => void;
  initialTime?: number;
  skipTimes?: SkipTimes;
  autoSkip?: boolean;
}

// Embed player: shows a megaplay.buzz or similar iframe.
// Falls back to a "Watch on site" button when only a watchUrl is available.
function EmbedPlayer(props: PlayerProps) {
  const { stream } = props;
  if (!stream.watchUrl) return <EmbedFrame key={stream.url} {...props} />;

  // Fallback: no server resolved to an embed — show a direct link
  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 16, background: "#000",
    }}>
      <p className="mono" style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, letterSpacing: 1, margin: 0 }}>
        STREAM READY ON ANIKOTOTV.TO
      </p>
      <a
        href={stream.watchUrl}
        target="_blank"
        rel="noreferrer"
        style={{
          padding: "12px 24px", borderRadius: 8, fontSize: 14, fontWeight: 700,
          background: "var(--accent)", color: "#fff", textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 8,
        }}
      >
        Watch Episode
      </a>
      <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, margin: 0 }}>
        Opens anikototv.to in a new tab
      </p>
    </div>
  );
}

// Kuro can't see inside the embedded player, so when a server stalls or errors the viewer
// picks another one; the source offers several mirrors per episode.
// The megaplay player posts its playback time to the parent and accepts seek messages, which
// is what drives progress saving, resume, intro/outro skipping and auto-play here. Servers
// that never report time just play without those features.
function EmbedFrame({ stream, mediaId, episode, isDub, onEnded, initialTime, skipTimes, autoSkip }: PlayerProps) {
  const servers = stream.servers?.length ? stream.servers : [{ name: "Server 1", url: stream.url }];
  const [activeUrl, setActiveUrl] = useState(servers[0].url);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [skipZone, setSkipZone] = useState<"intro" | "outro" | null>(null);
  const [isReporting, setIsReporting] = useState<boolean | null>(null);
  const { save } = useProgress(mediaId, episode, isDub);
  // Refs so the message handler (set up once per server) always sees current prop values
  const onEndedRef = useRef(onEnded);
  const skipTimesRef = useRef(skipTimes);
  const autoSkipRef = useRef(autoSkip);
  const initialTimeRef = useRef(initialTime);
  const saveRef = useRef(save);
  onEndedRef.current = onEnded;
  skipTimesRef.current = skipTimes;
  autoSkipRef.current = autoSkip;
  initialTimeRef.current = initialTime;
  saveRef.current = save;

  function seek(time: number) {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "seek", time }), "*");
  }

  useEffect(() => {
    let hasResumed = false;
    let hasEnded = false;
    let hasTiming = false;
    let lastZone: "intro" | "outro" | null = null;
    setSkipZone(null);
    setIsReporting(null);

    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const timing = toEmbedTiming(e.data);
      if (!timing) return;
      if (!hasTiming) { hasTiming = true; setIsReporting(true); }

      const resumeAt = initialTimeRef.current;
      if (!hasResumed) {
        hasResumed = true;
        if (resumeAt && timing.time < resumeAt - RESUME_TOLERANCE_SEC) { seek(resumeAt); return; }
      }

      saveRef.current(timing.time, timing.duration);

      const st = skipTimesRef.current;
      let zone: "intro" | "outro" | null = null;
      if (st?.intro && timing.time >= st.intro.start && timing.time < st.intro.end) zone = "intro";
      else if (st?.outro && timing.time >= st.outro.start && timing.time < st.outro.end) zone = "outro";
      if (zone && autoSkipRef.current) {
        seek(zone === "intro" ? st!.intro!.end : st!.outro!.end);
        zone = null;
      }
      if (zone !== lastZone) { lastZone = zone; setSkipZone(zone); }

      if (!hasEnded && timing.duration > 0 && timing.time >= timing.duration - END_THRESHOLD_SEC) {
        hasEnded = true;
        saveRef.current(timing.duration, timing.duration);
        onEndedRef.current?.();
      }
    }

    window.addEventListener("message", handleMessage);
    const timer = setTimeout(() => { if (!hasTiming) setIsReporting(false); }, REPORT_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(timer);
    };
  }, [activeUrl]);

  function skip() {
    const st = skipTimesRef.current;
    if (!skipZone || !st) return;
    seek(skipZone === "intro" ? st.intro!.end : st.outro!.end);
    setSkipZone(null);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <iframe
        ref={iframeRef}
        key={activeUrl}
        src={activeUrl}
        title="Episode player"
        style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
        allow="autoplay; fullscreen; encrypted-media"
        allowFullScreen
        referrerPolicy="origin"
      />
      {servers.length > 1 && (
        <div role="group" aria-label="Video server" style={{
          position: "absolute", top: 10, right: 10, zIndex: 20, display: "flex", flexWrap: "wrap",
          justifyContent: "flex-end", maxWidth: "calc(100% - 20px)", gap: 6,
          padding: 4, borderRadius: 8, background: "rgba(0,0,0,0.7)", border: "1px solid var(--line-2)",
        }}>
          {servers.map((s) => (
            <button
              key={s.url}
              onClick={() => setActiveUrl(s.url)}
              aria-pressed={activeUrl === s.url}
              className="mono"
              style={{
                minHeight: 32, padding: "0 10px", borderRadius: 5, fontSize: 11, letterSpacing: 0.5,
                background: activeUrl === s.url ? "var(--accent)" : "transparent",
                color: activeUrl === s.url ? "var(--text)" : "var(--muted)",
                border: "none",
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {skipZone && !autoSkip && <SkipButton zone={skipZone} onSkip={skip} />}
      {isReporting === false && servers.length > 1 && (
        <p className="mono" role="status" style={{
          position: "absolute", top: 10, left: 10, zIndex: 20, margin: 0, maxWidth: "45%",
          padding: "6px 10px", borderRadius: 6, fontSize: 10, letterSpacing: 0.4, lineHeight: 1.4,
          background: "var(--glass-strong)", border: "1px solid var(--line-2)", color: "var(--muted)",
        }}>
          THIS SERVER DOESN'T REPORT PLAYBACK, SO AUTO-PLAY, SKIP AND PROGRESS ARE OFF. TRY {servers[0].name.toUpperCase()}.
        </p>
      )}
    </div>
  );
}

const RESUME_TOLERANCE_SEC = 5;
const END_THRESHOLD_SEC = 2;
const REPORT_TIMEOUT_MS = 15_000;

/** Reads a playback-time message from the embedded player, in either format it sends. */
function toEmbedTiming(data: unknown): { time: number; duration: number } | null {
  let msg: unknown = data;
  if (typeof data === "string") {
    try { msg = JSON.parse(data); } catch { return null; }
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { event?: string; type?: string; time?: number; currentTime?: number; duration?: number };
  const time = m.event === "time" ? m.time : m.type === "watching-log" ? m.currentTime : undefined;
  if (typeof time !== "number" || typeof m.duration !== "number") return null;
  return { time, duration: m.duration };
}

function SkipButton({ zone, onSkip }: { zone: "intro" | "outro"; onSkip: () => void }) {
  return (
    <button
      onClick={onSkip}
      aria-label={zone === "intro" ? "Skip intro" : "Skip outro"}
      style={{
        position: "absolute", bottom: 68, right: 16, zIndex: 30,
        display: "flex", alignItems: "center", gap: 7, minHeight: 40,
        padding: "0 16px", borderRadius: 6, cursor: "pointer",
        background: "var(--glass-strong)", border: "1px solid var(--glass-line)",
        backdropFilter: "blur(8px)", color: "var(--text)",
        fontSize: 13, fontWeight: 700, letterSpacing: 0.4,
        animation: "fadeInUp 180ms ease-out",
      }}
    >
      <SkipForward size={14} />
      {zone === "intro" ? "Skip Intro" : "Skip Outro"}
    </button>
  );
}

export function Player(props: PlayerProps) {
  return props.stream.type === "embed" ? <EmbedPlayer {...props} /> : <NativePlayer {...props} />;
}

function NativePlayer({ stream, mediaId, episode, isDub, onEnded, initialTime, skipTimes, autoSkip }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [activeTrack, setActiveTrack] = useState(0);
  const [skipZone, setSkipZone] = useState<"intro" | "outro" | null>(null);
  // Refs so event handlers (set up once per stream URL) always see current prop values
  const onEndedRef = useRef(onEnded);
  const skipTimesRef = useRef(skipTimes);
  const autoSkipRef = useRef(autoSkip);
  onEndedRef.current = onEnded;
  skipTimesRef.current = skipTimes;
  autoSkipRef.current = autoSkip;
  const { save } = useProgress(mediaId, episode, isDub);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    hlsRef.current?.destroy();
    setError(null);
    setReady(false);
    setAudioTracks([]);
    setActiveTrack(0);
    setSkipZone(null);

    if (stream.type === "hls" && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        preferManagedMediaSource: false, // use classic MSE — MMS has SourceBuffer bugs with encrypted TS
      });
      hlsRef.current = hls;
      hls.loadSource(stream.url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setReady(true);
        video.play().catch(() => {});
        if (hls.audioTracks.length > 1) {
          setAudioTracks(
            hls.audioTracks.map((t, i) => ({
              id: i,
              name: t.name || (t.lang === "ja" ? "Japanese" : t.lang === "en" ? "English" : t.lang ?? `Track ${i + 1}`),
              lang: t.lang ?? "",
            }))
          );
          setActiveTrack(hls.audioTrack);
        }
      });

      let mediaRecoveryAttempts = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 2) {
          mediaRecoveryAttempts++;
          if (mediaRecoveryAttempts === 2) hls.swapAudioCodec();
          hls.recoverMediaError();
        } else {
          const extra = (data as { mimeType?: string }).mimeType ? ` (mime: ${(data as { mimeType?: string }).mimeType})` : "";
          setError(`HLS error: ${data.details}${extra}`);
        }
      });
    } else if (stream.type === "hls" && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = stream.url;
      setReady(true);
      video.play().catch(() => {});
    } else {
      video.src = stream.url;
      setReady(true);
      video.play().catch(() => {});
    }

    let lastZone: "intro" | "outro" | null = null;
    const handleTimeUpdate = () => {
      const t = video.currentTime;
      const st = skipTimesRef.current;
      let zone: "intro" | "outro" | null = null;
      if (st?.intro && t >= st.intro.start && t < st.intro.end) zone = "intro";
      else if (st?.outro && t >= st.outro.start && t < st.outro.end) zone = "outro";
      if (zone && autoSkipRef.current) {
        video.currentTime = zone === "intro" ? st!.intro!.end : st!.outro!.end;
        zone = null;
      }
      if (zone !== lastZone) { lastZone = zone; setSkipZone(zone); }
    };
    video.addEventListener("timeupdate", handleTimeUpdate);

    video.addEventListener("loadedmetadata", () => {
      // For Dual-Audio files, auto-select the English track so dub plays correctly
      const tracks = (video as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { language?: string; label?: string; enabled: boolean } } }).audioTracks;
      if (tracks && tracks.length > 1) {
        let englishIdx = -1;
        for (let i = 0; i < tracks.length; i++) {
          const lang = tracks[i].language?.toLowerCase() ?? "";
          if (lang === "en" || lang === "eng" || tracks[i].label?.toLowerCase().includes("eng")) {
            englishIdx = i;
            break;
          }
        }
        if (englishIdx > 0) {
          for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = (i === englishIdx);
          }
        }
      }
      if (initialTime) video.currentTime = initialTime;
    }, { once: true });

    const interval = setInterval(() => {
      if (!video.paused && !video.ended && video.currentTime > 0) {
        save(video.currentTime, video.duration);
      }
    }, 10000);

    const handleEnded = () => {
      save(video.duration, video.duration);
      onEndedRef.current?.();
    };
    video.addEventListener("ended", handleEnded);

    return () => {
      clearInterval(interval);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
      hlsRef.current?.destroy();
    };
  }, [stream.url]);

  function skip() {
    const video = videoRef.current;
    const st = skipTimesRef.current;
    if (!video || !skipZone || !st) return;
    video.currentTime = skipZone === "intro" ? st.intro!.end : st.outro!.end;
    setSkipZone(null);
  }

  function switchTrack(id: number) {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id;
      setActiveTrack(id);
    }
  }

  if (error) {
    return (
      <div style={{ width: "100%", height: "100%", background: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#000" }}>
      {/* HLS audio-track switcher */}
      {audioTracks.length > 1 && (
        <div style={{
          position: "absolute", top: 12, right: 12, zIndex: 30,
          display: "flex", gap: 4, background: "rgba(0,0,0,0.7)",
          borderRadius: 6, padding: "4px 6px", backdropFilter: "blur(6px)",
        }}>
          {audioTracks.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTrack(t.id)}
              className="mono"
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 1,
                padding: "4px 10px", borderRadius: 4, border: "none",
                background: activeTrack === t.id ? "var(--accent)" : "rgba(255,255,255,0.12)",
                color: "#fff", cursor: "pointer",
              }}
            >
              {t.name.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* "Stream ready" hint shown when video is loaded but hasn't started */}
      {ready && (
        <div style={{
          position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 20, pointerEvents: "none",
          background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "4px 12px",
          opacity: 0, animation: "fadeout 2s ease 1s forwards",
        }}>
          <span className="mono" style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: 1 }}>STREAM READY</span>
        </div>
      )}

      {skipZone && !autoSkip && <SkipButton zone={skipZone} onSkip={skip} />}

      <video
        ref={videoRef}
        controls
        style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        crossOrigin="anonymous"
      >
        {stream.subtitles.map((sub) => (
          <track
            key={sub.lang}
            kind="subtitles"
            src={sub.url}
            srcLang={sub.lang}
            label={sub.label}
          />
        ))}
      </video>

      <style>{`
        @keyframes fadeout { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  );
}
