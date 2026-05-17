import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Link as LinkIcon, FolderOpen, Check, Play } from "lucide-react";
import { Player } from "../components/Player";
import { useMedia, useEpisodes } from "../hooks/useMedia";
import { api } from "../lib/api";
import type { StreamResult, HistoryEntry, SkipTimes, Episode, EpisodeAvail } from "../lib/types";

// Module-level cache persists across episode navigation within the same browser session.
// Keys are `${mediaId}:${episode}:${dub}`. TTL is 15 min — long enough for a session,
// short enough that expired HLS tokens don't cause playback failures.
const STREAM_CACHE_TTL = 15 * 60 * 1000;
const streamCache = new Map<string, { result: StreamResult; fetched: number }>();

function getCachedStream(mediaId: string, ep: number, dub: boolean): StreamResult | null {
  const key = `${mediaId}:${ep}:${dub}`;
  const entry = streamCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetched > STREAM_CACHE_TTL) { streamCache.delete(key); return null; }
  return entry.result;
}

function setCachedStream(mediaId: string, ep: number, dub: boolean, result: StreamResult) {
  streamCache.set(`${mediaId}:${ep}:${dub}`, { result, fetched: Date.now() });
}

export function Watch() {
  const { id, episode } = useParams<{ id: string; episode: string }>();
  const navigate = useNavigate();
  const decodedId = id ? decodeURIComponent(id) : "";
  const episodeNum = parseInt(episode ?? "1", 10);

  const isTVSeries = decodedId.startsWith("tvmaze:") || decodedId.startsWith("watchtv:");

  const { media } = useMedia(decodedId);
  const { episodes, loading: epsLoading } = useEpisodes(decodedId);

  // For TV series we need episodes to resolve season + episodeInSeason before streaming
  const readyToStream = isTVSeries ? !epsLoading : true;

  const [stream, setStream] = useState<StreamResult | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [dubFallback, setDubFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [initialTime, setInitialTime] = useState<number | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Per-show dub preference: read `kuro:isDub:${mediaId}` first, fall back to global flag
  const [isDub, setIsDub] = useState(() => {
    const perShow = localStorage.getItem(`kuro:isDub:${decodedId}`);
    if (perShow !== null) return perShow === "true";
    return localStorage.getItem("kuro:isDub") === "true";
  });
  // anikototv.to supports sub/dub per episode — always show the toggle; stream response confirms actual availability
  const dubAvailable = true;
  const [availabilityMap, setAvailabilityMap] = useState<Record<number, EpisodeAvail>>({});
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem("kuro:autoPlay") !== "false");
  const [autoSkip, setAutoSkip] = useState(() => localStorage.getItem("kuro:autoSkip") === "true");
  const [skipTimes, setSkipTimes] = useState<SkipTimes>({});
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!decodedId || isTVSeries) return;
    setAvailabilityMap({});
    api.getAvailability(decodedId).then((r) => setAvailabilityMap(r.episodes)).catch(() => {});
  }, [decodedId, isTVSeries]);

  // Fetch stream + resume position; use module-level cache so navigating back is instant
  useEffect(() => {
    if (!decodedId || !readyToStream) return;
    let cancelled = false;
    setLoading(true);
    setStreamError(null);
    setStream(null);
    setDubFallback(false);
    setInitialTime(undefined);

    function fetchStream(): Promise<StreamResult> {
      const cached = getCachedStream(decodedId, episodeNum, isDub);
      if (cached) return Promise.resolve(cached);
      if (isTVSeries) {
        const ep = episodes.find((e) => e.number === episodeNum);
        const season = ep?.seasonNumber ?? 1;
        const epInSeason = ep?.episodeInSeason ?? episodeNum;
        return api.tv.getStream(decodedId, season, epInSeason);
      }
      return api.getStream(decodedId, episodeNum, isDub);
    }

    Promise.all([fetchStream(), api.library.getProgress(decodedId)])
      .then(([s, h]: [StreamResult, HistoryEntry[]]) => {
        if (cancelled) return;
        setCachedStream(decodedId, episodeNum, isDub, s);
        setStream(s);
        setDubFallback(!isTVSeries && s.type !== "embed" && isDub && s.dubbed === false);
        setHistory(h);
        const saved = h.find((entry) => entry.episode_number === episodeNum);
        if (saved && saved.duration_seconds && saved.progress_seconds / saved.duration_seconds < 0.90) {
          setInitialTime(saved.progress_seconds);
        }
      })
      .catch((e: Error) => { if (!cancelled) setStreamError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedId, episodeNum, isDub, retryKey, readyToStream]);

  // Prefetch next episode stream in the background after current loads
  useEffect(() => {
    if (!stream || !decodedId || !readyToStream) return;
    const nextEp = episodeNum + 1;
    if (!media?.totalEpisodes || nextEp > media.totalEpisodes) return;
    if (getCachedStream(decodedId, nextEp, isDub)) return;
    if (isTVSeries) {
      const ep = episodes.find((e) => e.number === nextEp);
      if (!ep) return;
      api.tv.getStream(decodedId, ep.seasonNumber ?? 1, ep.episodeInSeason ?? nextEp)
        .then((s) => setCachedStream(decodedId, nextEp, isDub, s))
        .catch(() => {});
    } else {
      api.getStream(decodedId, nextEp, isDub)
        .then((s) => setCachedStream(decodedId, nextEp, isDub, s))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, decodedId, episodeNum, isDub, media?.totalEpisodes, readyToStream]);

  // Fetch intro/outro skip times from AniSkip (keyed by MAL ID + episode)
  useEffect(() => {
    if (!media?.malId) { setSkipTimes({}); return; }
    fetch(`https://api.aniskip.com/v2/skip-times/${media.malId}/${episodeNum}?types[]=op&types[]=ed&episodeLength=0`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.found) { setSkipTimes({}); return; }
        const times: SkipTimes = {};
        for (const result of (data.results ?? []) as Array<{ skipType: string; interval: { startTime: number; endTime: number } }>) {
          if (result.skipType === "op") times.intro = { start: result.interval.startTime, end: result.interval.endTime };
          if (result.skipType === "ed") times.outro = { start: result.interval.startTime, end: result.interval.endTime };
        }
        setSkipTimes(times);
      })
      .catch(() => setSkipTimes({}));
  }, [media?.malId, episodeNum]);

  // Scroll active episode into view in the sidebar
  useEffect(() => {
    if (!sidebarRef.current) return;
    const el = sidebarRef.current.querySelector<HTMLElement>(`[data-ep="${episodeNum}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [episodeNum, episodes.length]);

  function toggleAutoPlay() {
    const next = !autoPlay;
    setAutoPlay(next);
    localStorage.setItem("kuro:autoPlay", String(next));
  }

  function toggleAutoSkip() {
    const next = !autoSkip;
    setAutoSkip(next);
    localStorage.setItem("kuro:autoSkip", String(next));
  }

  function goNext() {
    navigate(`/watch/${encodeURIComponent(decodedId)}/${episodeNum + 1}`);
  }

  function loadManualUrl(url: string) {
    const isHls = url.includes(".m3u8");
    setStream({ url, type: isHls ? "hls" : "mp4", subtitles: [] });
    setStreamError(null);
  }

  function retryStream() {
    streamCache.delete(`${decodedId}:${episodeNum}:${isDub}`);
    setRetryKey((k) => k + 1);
  }

  const hasNext = media?.totalEpisodes ? episodeNum < media.totalEpisodes : false;
  const hasSkipData = !!(skipTimes.intro || skipTimes.outro);

  const progressMap = history.reduce<Record<number, { progress: number; duration: number }>>((acc, h) => {
    if (h.duration_seconds) acc[h.episode_number] = { progress: h.progress_seconds, duration: h.duration_seconds };
    return acc;
  }, {});

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#000", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 14, padding: "0 16px",
        height: 50, background: "var(--surf)", borderBottom: "1px solid var(--line)", zIndex: 10,
      }}>
        <Link
          to={decodedId ? `/title/${encodeURIComponent(decodedId)}` : "/"}
          style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13, flexShrink: 0 }}
        >
          <ArrowLeft size={15} /> Back
        </Link>
        {media && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            <span style={{ fontWeight: 600 }}>{media.title}</span>
            {episodeNum > 0 && <span style={{ color: "var(--dim)", marginLeft: 8 }}>· Ep {episodeNum}</span>}
          </p>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <PasteUrlButton onUrl={loadManualUrl} />
          {dubAvailable && !isTVSeries && (
            <div style={{ display: "flex", background: "var(--surf-2)", borderRadius: 6, padding: 3, gap: 2, border: "1px solid var(--line-2)" }}>
              {(["SUB", "DUB"] as const).map((mode) => {
                const active = mode === "DUB" ? isDub : !isDub;
                return (
                  <button
                    key={mode}
                    onClick={() => { const dub = mode === "DUB"; setIsDub(dub); localStorage.setItem(`kuro:isDub:${decodedId}`, String(dub)); }}
                    className="mono"
                    style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 1,
                      padding: "4px 10px", borderRadius: 4, border: "none",
                      background: active ? "var(--accent)" : "transparent",
                      color: active ? "#fff" : "var(--dim)",
                      cursor: "pointer", transition: "all 160ms",
                    }}
                  >
                    {mode}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Content row: player + episode sidebar */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Left: player + controls */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#000", minWidth: 0 }}>

          {/* Player area — fills all remaining column height */}
          <div style={{ flex: 1, position: "relative", background: "#000", overflow: "hidden" }}>
            {loading && <StreamLoadingOverlay />}
            {!loading && streamError && (
              <div role="alert" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <StreamErrorPanel error={streamError} onManualUrl={loadManualUrl} onRetry={retryStream} />
              </div>
            )}
            {!loading && stream && dubFallback && (
              <div style={{
                position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 20,
                background: "rgba(0,0,0,0.75)", border: "1px solid rgba(255,200,0,0.4)",
                borderRadius: 6, padding: "5px 12px",
                display: "flex", alignItems: "center", gap: 6,
                pointerEvents: "none",
              }}>
                <span className="mono" style={{ fontSize: 10, color: "rgba(255,200,0,0.9)", letterSpacing: 0.5 }}>
                  NO ENGLISH DUB · PLAYING SUB
                </span>
              </div>
            )}
            {!loading && stream && (
              <Player
                stream={stream}
                mediaId={decodedId}
                episode={episodeNum}
                isDub={isDub}
                onEnded={hasNext && autoPlay ? goNext : undefined}
                initialTime={initialTime}
                skipTimes={skipTimes}
                autoSkip={autoSkip}
              />
            )}
          </div>

          {/* Controls strip */}
          <div style={{
            flexShrink: 0, padding: "10px 16px",
            display: "flex", alignItems: "center", gap: 20,
            background: "#0a0a0a", borderTop: "1px solid var(--line)",
          }}>
            <Toggle enabled={autoPlay} onToggle={toggleAutoPlay} label="Auto-play" />
            <Toggle
              enabled={autoSkip}
              onToggle={toggleAutoSkip}
              label="Auto-skip"
              faded={!hasSkipData}
              title={hasSkipData ? undefined : "No intro/outro timing found for this episode"}
            />
            <div style={{ marginLeft: "auto" }}>
              {hasNext && !loading && stream && (
                <button
                  onClick={goNext}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 12,
                    color: "var(--muted)", padding: "6px 12px",
                    borderRadius: 5, border: "1px solid var(--line-2)", background: "var(--surf)",
                  }}
                >
                  Next Episode <ChevronRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: episode sidebar */}
        <div style={{
          width: 300, flexShrink: 0,
          display: "flex", flexDirection: "column",
          background: "var(--bg)", borderLeft: "1px solid var(--line)",
        }}>
          <div style={{
            flexShrink: 0, padding: "10px 14px 8px",
            borderBottom: "1px solid var(--line)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>EPISODES</span>
            {media?.totalEpisodes && (
              <span className="mono" style={{ fontSize: 10, color: "var(--dim-2)", letterSpacing: 0.5 }}>
                {episodeNum} / {media.totalEpisodes}
              </span>
            )}
          </div>
          <div ref={sidebarRef} style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
            {epsLoading ? (
              Array.from({ length: 14 }).map((_, i) => (
                <div key={i} style={{ height: 48, margin: "2px 0", borderRadius: 4, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
              ))
            ) : episodes.length === 0 ? (
              <p className="mono" style={{ color: "var(--dim)", fontSize: 11, letterSpacing: 0.5, padding: "16px 4px" }}>NO EPISODE DATA</p>
            ) : (
              episodes.map((ep) => {
                const prog = progressMap[ep.number];
                const pct = prog ? Math.min(100, (prog.progress / prog.duration) * 100) : 0;
                return (
                  <EpisodeSidebarItem
                    key={ep.number}
                    ep={ep}
                    mediaId={decodedId}
                    isActive={ep.number === episodeNum}
                    pct={pct}
                    avail={availabilityMap[ep.number]}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function StreamLoadingOverlay() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const hint = secs >= 20 ? "This is taking a while — server may be bypassing Cloudflare…" : "Finding stream…";

  return (
    <div
      role="status"
      aria-label="Loading stream"
      style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}
    >
      <div aria-hidden="true" style={{
        width: 32, height: 32, borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.12)", borderTopColor: "#fff",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <p className="mono" style={{ margin: 0, color: "rgba(255,255,255,0.5)", fontSize: 11, letterSpacing: 1 }}>
          {hint.toUpperCase()}
        </p>
        {secs > 0 && (
          <p className="mono" style={{ margin: 0, color: "rgba(255,255,255,0.2)", fontSize: 10, letterSpacing: 0.5 }}>
            {secs}s
          </p>
        )}
      </div>
    </div>
  );
}

function EpisodeSidebarItem({ ep, mediaId, isActive, pct, avail }: {
  ep: Episode; mediaId: string; isActive: boolean; pct: number; avail?: EpisodeAvail;
}) {
  const watched = pct >= 90;
  return (
    <Link
      to={`/watch/${encodeURIComponent(mediaId)}/${ep.number}`}
      data-ep={ep.number}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 6px", borderRadius: 5,
        background: isActive ? "var(--accent-soft)" : "transparent",
        border: isActive ? "1px solid var(--accent)" : "1px solid transparent",
        marginBottom: 2, textDecoration: "none", color: "inherit",
        transition: "background 130ms",
      }}
      onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "var(--surf)"; }}
      onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}
      onFocus={(e) => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "var(--surf)"; }}
      onBlur={(e) => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}
    >
      <span style={{
        fontSize: 18, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1,
        color: isActive ? "#fff" : watched ? "var(--dim-2)" : "var(--dim)",
        minWidth: 26, textAlign: "center", flexShrink: 0,
      }}>
        {String(ep.number).padStart(2, "0")}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 12.5,
          fontWeight: isActive ? 600 : 400,
          color: isActive ? "#fff" : watched ? "var(--dim)" : "var(--muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          lineHeight: 1.3,
        }}>
          {ep.title}
        </p>
        {(avail?.hasSub || avail?.hasDub) && (
          <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
            {avail.hasSub && (
              <span className="mono" style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: "var(--sub-badge-bg)", color: "#fff", fontWeight: 700, letterSpacing: 0.5 }}>SUB</span>
            )}
            {avail.hasDub && (
              <span className="mono" style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: "var(--dub-badge-bg)", color: "#000", fontWeight: 700, letterSpacing: 0.5 }}>DUB</span>
            )}
          </div>
        )}
        {pct > 0 && pct < 90 && (
          <div style={{ height: 2, background: "var(--line)", marginTop: 4, borderRadius: 1, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 1 }} />
          </div>
        )}
      </div>
      {isActive
        ? <Play size={10} fill="#fff" color="#fff" style={{ flexShrink: 0 }} />
        : watched
          ? (
            <span className="mono" style={{
              display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
              fontSize: 7, padding: "2px 5px", borderRadius: 3,
              background: "var(--seen-soft)", border: "1px solid var(--seen-border)",
              color: "var(--seen-text)", fontWeight: 700, letterSpacing: 0.5,
            }}>
              <Check size={7} strokeWidth={2.5} /> SEEN
            </span>
          )
          : null
      }
    </Link>
  );
}

function Toggle({ enabled, onToggle, label, faded, title }: {
  enabled: boolean; onToggle: () => void; label: string; faded?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={title}
      style={{ display: "flex", alignItems: "center", gap: 8, opacity: faded ? 0.45 : 1 }}
    >
      <div style={{
        width: 30, height: 17, borderRadius: 9, position: "relative", flexShrink: 0,
        background: enabled ? "var(--accent)" : "var(--line-2)",
        transition: "background 200ms",
      }}>
        <div style={{
          position: "absolute", top: 2.5, left: enabled ? 15 : 2.5,
          width: 12, height: 12, borderRadius: "50%", background: "#fff",
          transition: "left 200ms",
        }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--muted)", userSelect: "none" }}>{label}</span>
    </button>
  );
}

// Resolves any URL to a playable stream: direct .m3u8/.mp4 are used as-is;
// webpage URLs are sent to the server for HLS extraction.
async function resolveToStream(raw: string): Promise<{ url: string; type: "hls" | "mp4" }> {
  const url = raw.trim();
  if (url.includes(".m3u8")) return { url, type: "hls" };
  if (url.includes(".mp4")) return { url, type: "mp4" };
  // Webpage URL — ask the server to scrape it
  return api.services.extractStream(url);
}

function PasteUrlButton({ onUrl }: { onUrl: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    const v = val.trim();
    if (!v) return;
    setBusy(true); setErr("");
    try {
      const result = await resolveToStream(v);
      onUrl(result.url);
      setVal(""); setOpen(false);
    } catch (e: unknown) {
      setErr((e as Error).message ?? "Could not extract stream");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mono"
        title="Paste a stream URL"
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 1,
          padding: "5px 10px", borderRadius: 6, border: "1px solid var(--line-2)",
          background: "var(--surf-2)", color: "var(--muted)", cursor: "pointer",
        }}
      >
        PASTE URL
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50,
          background: "var(--surf-2)", border: "1px solid var(--line-2)",
          borderRadius: 8, padding: 12, width: 380,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              autoFocus
              type="url"
              value={val}
              onChange={(e) => { setVal(e.target.value); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
              placeholder="Episode page URL or direct .m3u8 / .mp4"
              style={{
                flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid var(--line-2)",
                borderRadius: 6, padding: "7px 10px", color: "#fff", fontSize: 12,
                fontFamily: "inherit", outline: "none",
              }}
            />
            <button
              onClick={submit}
              disabled={!val.trim() || busy}
              style={{
                padding: "7px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600,
                background: val.trim() && !busy ? "var(--accent)" : "rgba(255,255,255,0.08)",
                color: val.trim() && !busy ? "#fff" : "rgba(255,255,255,0.25)",
                cursor: val.trim() && !busy ? "pointer" : "default", whiteSpace: "nowrap",
              }}
            >
              {busy ? "Extracting…" : "Play"}
            </button>
          </div>
          {err && <p style={{ margin: 0, fontSize: 11, color: "#ef4444", lineHeight: 1.4 }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

function StreamErrorPanel({ error, onManualUrl, onRetry }: {
  error: string;
  onManualUrl: (url: string) => void;
  onRetry: () => void;
}) {
  const [manualUrl, setManualUrl] = useState("");
  const [localFiles, setLocalFiles] = useState<Array<{ title: string; episodes: Array<{ number: number | null; file: string; encoded: string }> }>>([]);
  const [showLocal, setShowLocal] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showLocal || localFiles.length > 0) return;
    fetch("/api/local/scan").then((r) => r.json()).then(setLocalFiles).catch(() => {});
  }, [showLocal]);

  function handleRetry() {
    setRetrying(true);
    onRetry();
    setTimeout(() => setRetrying(false), 8000);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith("http")) {
        setManualUrl(text.trim());
        setExtractErr("");
        inputRef.current?.focus();
      }
    } catch { /* clipboard permission denied */ }
  }

  async function play() {
    const url = manualUrl.trim();
    if (!url || extracting) return;
    setExtracting(true); setExtractErr("");
    try {
      const result = await resolveToStream(url);
      onManualUrl(result.url);
    } catch (e: unknown) {
      setExtractErr((e as Error).message ?? "Could not extract stream");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div style={{
      width: "100%", maxWidth: 520, borderRadius: 10, margin: "0 auto", overflow: "hidden",
      background: "rgba(15,15,15,0.95)", border: "1px solid rgba(255,255,255,0.1)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <p style={{ margin: "0 0 5px", fontSize: 15, fontWeight: 700, color: "#fff" }}>Stream unavailable</p>
        <p className="mono" style={{ margin: 0, fontSize: 10, color: "rgba(229,9,20,0.8)", letterSpacing: 0.5, lineHeight: 1.5 }}>{error}</p>
      </div>

      {/* Actions */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 8 }}>
        <button
          onClick={handleRetry}
          disabled={retrying}
          style={{
            flex: 1, padding: "9px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: retrying ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.1)",
            color: retrying ? "rgba(255,255,255,0.35)" : "#fff",
            border: "1px solid rgba(255,255,255,0.12)", cursor: retrying ? "default" : "pointer",
            transition: "all 150ms",
          }}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>

      {/* Paste URL */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: 6 }}>
          <LinkIcon size={12} /> Paste a URL
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            type="url"
            value={manualUrl}
            onChange={(e) => { setManualUrl(e.target.value); setExtractErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") play(); }}
            placeholder="Episode page URL or direct .m3u8 / .mp4"
            style={{
              flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6, padding: "8px 11px", color: "#fff", fontFamily: "monospace",
              fontSize: 12, outline: "none",
            }}
          />
          <button
            onClick={pasteFromClipboard}
            title="Paste from clipboard"
            style={{
              padding: "8px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            Paste
          </button>
          <button
            onClick={play}
            disabled={!manualUrl.trim() || extracting}
            style={{
              padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: manualUrl.trim() && !extracting ? "var(--accent)" : "rgba(255,255,255,0.06)",
              color: manualUrl.trim() && !extracting ? "#fff" : "rgba(255,255,255,0.2)",
              border: "none", cursor: manualUrl.trim() && !extracting ? "pointer" : "default", whiteSpace: "nowrap",
            }}
          >
            {extracting ? "Extracting…" : "Play"}
          </button>
        </div>
        {extractErr && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#ef4444", lineHeight: 1.4 }}>{extractErr}</p>}
        <p style={{ margin: "7px 0 0", fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
          Paste an episode page URL (e.g. from anikototv.to) or a direct .m3u8 / .mp4 link.
        </p>
      </div>

      {/* Local files */}
      <div style={{ padding: "10px 20px 14px" }}>
        <button
          onClick={() => setShowLocal((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.35)",
          }}
        >
          <FolderOpen size={12} />
          {showLocal ? "Hide local files" : "Play a local file"}
        </button>
        {showLocal && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3, maxHeight: 160, overflowY: "auto" }}>
            {localFiles.length === 0 ? (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", margin: 0 }}>No local video files found.</p>
            ) : localFiles.map((t) =>
              t.episodes.map((ep) => (
                <button
                  key={ep.encoded}
                  onClick={() => onManualUrl(`/api/local/stream?file=${encodeURIComponent(ep.encoded)}`)}
                  style={{
                    textAlign: "left", padding: "6px 10px", borderRadius: 5,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: 12, color: "rgba(255,255,255,0.55)", cursor: "pointer",
                  }}
                >
                  {t.title}{ep.number != null ? ` · Ep ${ep.number}` : ""}
                  <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{ep.file}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
