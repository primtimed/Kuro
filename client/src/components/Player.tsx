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
function EmbedPlayer({ stream }: { stream: StreamResult }) {
  // If we have a direct embed URL (megaplay.buzz), show the iframe
  if (!stream.watchUrl) {
    return (
      <iframe
        src={stream.url}
        style={{ width: "100%", height: "100%", border: "none", background: "#000" }}
        allow="autoplay; fullscreen; encrypted-media"
        allowFullScreen
        referrerPolicy="origin"
      />
    );
  }

  // Fallback: FlareSolverr couldn't load the page — show a direct link
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

export function Player({ stream, mediaId, episode, isDub, onEnded, initialTime, skipTimes, autoSkip }: PlayerProps) {
  // Embed streams are handled separately
  if (stream.type === "embed") return <EmbedPlayer stream={stream} />;

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

      {skipZone && !autoSkip && (
        <button
          onClick={skip}
          aria-label={skipZone === "intro" ? "Skip intro" : "Skip outro"}
          style={{
            position: "absolute", bottom: 68, right: 16, zIndex: 30,
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 16px", borderRadius: 6, cursor: "pointer",
            background: "rgba(0,0,0,0.78)", border: "1px solid rgba(255,255,255,0.32)",
            backdropFilter: "blur(8px)", color: "#fff",
            fontSize: 13, fontWeight: 600,
            animation: "fadeInUp 180ms ease-out",
          }}
        >
          <SkipForward size={14} />
          {skipZone === "intro" ? "Skip Intro" : "Skip Outro"}
        </button>
      )}

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
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </div>
  );
}
