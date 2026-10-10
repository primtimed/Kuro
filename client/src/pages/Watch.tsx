import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Link as LinkIcon, FolderOpen, Check, Info, Search as SearchIcon, SkipBack, SkipForward } from "lucide-react";
import { Player } from "../components/Player";
import { useMedia, useEpisodes } from "../hooks/useMedia";
import { api } from "../lib/api";
import type { StreamResult, HistoryEntry, SkipTimes, Episode, EpisodeAvail } from "../lib/types";
import { EpisodeThumbnail, AnimeCover } from "../lib/procedural";
import { toFormatLabel } from "../lib/utils";

// Module-level cache persists across episode navigation within the same browser session.
// Keys are `${mediaId}:${episode}:${dub}`. TTL is 15 min — long enough for a session,
// short enough that expired HLS tokens don't cause playback failures.
const STREAM_CACHE_TTL = 15 * 60 * 1000;
const streamCache = new Map<string, { result: StreamResult; fetched: number }>();
const EPISODE_RANGE_SIZE = 100;
const WATCHED_RATIO = 0.9;
const UP_NEXT_SECONDS = 5;

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

  const lastEpisode = media?.totalEpisodes ?? (episodes.length > 0 ? episodes[episodes.length - 1].number : 0);

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
  const [episodeQuery, setEpisodeQuery] = useState("");
  const [selectedRange, setSelectedRange] = useState<number | null>(null);
  const [isUpNextOpen, setIsUpNextOpen] = useState(false);

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
        setDubFallback(!isTVSeries && isDub && s.dubbed === false);
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
    if (nextEp > lastEpisode) return;
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
  }, [stream, decodedId, episodeNum, isDub, lastEpisode, readyToStream]);

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

  useEffect(() => {
    setIsUpNextOpen(false);
  }, [decodedId, episodeNum]);

  function goPrev() {
    navigate(`/watch/${encodeURIComponent(decodedId)}/${episodeNum - 1}`);
  }

  function handleJump(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const n = parseInt(episodeQuery, 10);
    if (episodes.some((ep) => ep.number === n)) {
      setEpisodeQuery("");
      navigate(`/watch/${encodeURIComponent(decodedId)}/${n}`);
    }
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

  const hasNext = episodeNum < lastEpisode;
  const hasPrev = episodeNum > (episodes[0]?.number ?? 1);
  const hasSkipData = !!(skipTimes.intro || skipTimes.outro);
  const currentEp = episodes.find((e) => e.number === episodeNum);

  const progressMap = history.reduce<Record<number, { progress: number; duration: number }>>((acc, h) => {
    if (h.duration_seconds) acc[h.episode_number] = { progress: h.progress_seconds, duration: h.duration_seconds };
    return acc;
  }, {});

  // Long shows are split into blocks of 100; the block holding the current episode opens by default.
  const ranges: Episode[][] = [];
  if (episodes.length > EPISODE_RANGE_SIZE) {
    for (let i = 0; i < episodes.length; i += EPISODE_RANGE_SIZE) ranges.push(episodes.slice(i, i + EPISODE_RANGE_SIZE));
  }
  const currentRange = Math.max(ranges.findIndex((r) => r.some((e) => e.number === episodeNum)), 0);
  const activeRange = Math.min(selectedRange ?? currentRange, Math.max(ranges.length - 1, 0));
  const query = episodeQuery.trim().toLowerCase();
  const listedEpisodes = query
    ? episodes.filter((e) => String(e.number).startsWith(query) || e.title.toLowerCase().includes(query))
    : ranges.length > 0 ? ranges[activeRange] : episodes;

  return (
    <div className="watch-page">
      <div className="watch-head">
        <Link
          to={decodedId ? `/title/${encodeURIComponent(decodedId)}` : "/"}
          style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 40, padding: "0 12px", borderRadius: 6, border: "1px solid var(--line)", color: "var(--muted)", fontSize: 13, flexShrink: 0 }}
        >
          <ArrowLeft size={15} /> Back
        </Link>
        {media && (
          <p className="clip-1" style={{ margin: 0, fontSize: 13, color: "var(--dim)", flex: 1, minWidth: 0 }}>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{media.title}</span>
            <span style={{ margin: "0 8px" }}>/</span>
            <span style={{ color: "var(--accent-hi)", fontWeight: 700 }}>Episode {currentEp?.episodeInSeason ?? episodeNum}</span>
            {currentEp?.title && <span> · {currentEp.title}</span>}
          </p>
        )}
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <PasteUrlButton onUrl={loadManualUrl} />
        </div>
      </div>

      <div className="watch-layout">
        <div style={{ minWidth: 0 }}>
          {/* Player */}
          <div className="watch-player">
            {loading && <StreamLoadingOverlay />}
            {isUpNextOpen && hasNext && (
              <UpNextCard
                episode={episodes.find((e) => e.number === episodeNum + 1)}
                episodeNumber={episodeNum + 1}
                mediaTitle={media?.title ?? ""}
                onPlay={goNext}
                onCancel={() => setIsUpNextOpen(false)}
              />
            )}
            {!loading && streamError && (
              <div role="alert" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflowY: "auto" }}>
                <StreamErrorPanel error={streamError} onManualUrl={loadManualUrl} onRetry={retryStream} />
              </div>
            )}
            {!loading && stream && dubFallback && (
              <div style={{
                position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 20,
                background: "var(--glass-strong)", border: "1px solid var(--dub-badge-border)",
                borderRadius: 6, padding: "5px 12px", pointerEvents: "none",
              }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--dub-badge-text)", letterSpacing: 0.5 }}>
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
                onEnded={hasNext && autoPlay ? () => setIsUpNextOpen(true) : undefined}
                initialTime={initialTime}
                skipTimes={skipTimes}
                autoSkip={autoSkip}
              />
            )}
          </div>

          {/* Controls */}
          <div className="watch-controls">
            {dubAvailable && !isTVSeries && (
              <div role="group" aria-label="Audio" className="seg-group">
                {(["SUB", "DUB"] as const).map((mode) => (
                  <button
                    key={mode}
                    className="seg-btn"
                    aria-pressed={mode === "DUB" ? isDub : !isDub}
                    onClick={() => { const dub = mode === "DUB"; setIsDub(dub); localStorage.setItem(`kuro:isDub:${decodedId}`, String(dub)); }}
                    style={{ letterSpacing: 0.6 }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            )}
            <Toggle enabled={autoPlay} onToggle={toggleAutoPlay} label="Auto-play" />
            <Toggle
              enabled={autoSkip}
              onToggle={toggleAutoSkip}
              label="Auto-skip intro"
              faded={!hasSkipData}
              title={hasSkipData ? undefined : "No intro/outro timing found for this episode"}
            />
            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              {hasPrev && (
                <button className="btn-slant btn-slant--ghost" onClick={goPrev} style={{ padding: "0 20px" }}>
                  <SkipBack size={14} /> Prev
                </button>
              )}
              {hasNext && (
                <button className="btn-slant btn-slant--primary" onClick={goNext} style={{ padding: "0 22px" }}>
                  Next · EP {episodeNum + 1} <SkipForward size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Series info */}
          {media && (
            <section aria-label="Series" className="watch-info">
              <div style={{ width: 86, height: 122, borderRadius: 8, overflow: "hidden", flexShrink: 0, border: "1px solid var(--line)" }}>
                {media.poster
                  ? <img src={media.poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <AnimeCover title={media.title} w={86} h={122} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {media.rating && <span className="watch-chip" style={{ color: "var(--rating)" }}>★ {media.rating.toFixed(1)}</span>}
                  {toFormatLabel(media) && <span className="watch-chip">{toFormatLabel(media)}</span>}
                  {media.year && <span className="watch-chip">{media.year}</span>}
                  {lastEpisode > 0 && <span className="watch-chip">EP {episodeNum} / {lastEpisode}</span>}
                </div>
                <h1 className="clip-1" style={{ margin: "8px 0 6px", fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase" }}>
                  {media.title}
                </h1>
                {media.synopsis && (
                  <p className="clip-2" style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.55, maxWidth: 820 }}>{media.synopsis}</p>
                )}
              </div>
              <Link
                to={`/title/${encodeURIComponent(decodedId)}`}
                className="watch-info-link"
                style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 700, color: "var(--muted)", background: "var(--surf)", border: "1px solid var(--line)", flexShrink: 0 }}
              >
                <Info size={15} /> Series details
              </Link>
            </section>
          )}
        </div>

        {/* Episode list */}
        <aside className="watch-side" aria-label="Episodes">
          <div className="watch-side-inner">
            <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "baseline", marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Episodes</h2>
                {lastEpisode > 0 && (
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--dim)" }}>{episodeNum} / {lastEpisode}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 12px", borderRadius: 6, background: "var(--surf-2)", border: "1px solid var(--line)" }}>
                  <SearchIcon size={14} color="var(--dim)" aria-hidden="true" />
                  <input
                    value={episodeQuery}
                    onChange={(e) => setEpisodeQuery(e.target.value)}
                    onKeyDown={handleJump}
                    placeholder="Jump to episode…"
                    aria-label="Jump to episode by number or title"
                    style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}
                  />
                </label>
                {ranges.length > 0 && !query && (
                  <select
                    value={activeRange}
                    onChange={(e) => setSelectedRange(Number(e.target.value))}
                    aria-label="Episode range"
                    style={{ minHeight: 40, padding: "0 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "var(--surf-2)", color: "var(--muted)", border: "1px solid var(--line)" }}
                  >
                    {ranges.map((r, i) => (
                      <option key={i} value={i}>{r[0].number}–{r[r.length - 1].number}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div ref={sidebarRef} className="watch-side-list">
              {epsLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{ height: 63, margin: "6px 0", borderRadius: 6, background: "var(--surf-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
                ))
              ) : listedEpisodes.length === 0 ? (
                <p className="mono" style={{ color: "var(--dim)", fontSize: 11, letterSpacing: 0.5, padding: "16px 4px" }}>
                  {query ? "NO MATCHING EPISODES" : "NO EPISODE DATA"}
                </p>
              ) : (
                listedEpisodes.map((ep) => {
                  const prog = progressMap[ep.number];
                  const pct = prog ? Math.min(100, (prog.progress / prog.duration) * 100) : 0;
                  return (
                    <EpisodeSidebarItem
                      key={ep.number}
                      ep={ep}
                      mediaId={decodedId}
                      mediaTitle={media?.title ?? ""}
                      isActive={ep.number === episodeNum}
                      pct={pct}
                      avail={availabilityMap[ep.number]}
                    />
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function UpNextCard({ episode, episodeNumber, mediaTitle, onPlay, onCancel }: {
  episode?: Episode; episodeNumber: number; mediaTitle: string; onPlay: () => void; onCancel: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(UP_NEXT_SECONDS);
  const playRef = useRef<HTMLButtonElement>(null);
  const onPlayRef = useRef(onPlay);
  const onCancelRef = useRef(onCancel);
  onPlayRef.current = onPlay;
  onCancelRef.current = onCancel;

  useEffect(() => {
    playRef.current?.focus();
    const timer = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) onPlayRef.current();
  }, [secondsLeft]);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
      padding: 20, background: "linear-gradient(to top left, var(--glass-strong), transparent 70%)",
    }}>
      <section
        aria-label={`Up next: episode ${episodeNumber}`}
        style={{
          width: 340, maxWidth: "100%", overflow: "hidden", borderRadius: 12,
          background: "var(--surf)", border: "1px solid var(--line-2)", boxShadow: "0 20px 60px var(--glass-strong)",
          animation: "fadeInUp 200ms ease-out",
        }}
      >
        <div style={{ position: "relative", aspectRatio: "16 / 9" }}>
          {episode?.thumbnail
            ? <img src={episode.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <EpisodeThumbnail title={mediaTitle} epNum={episodeNumber} />}
          <div role="progressbar" aria-label="Time until next episode" aria-valuemin={0} aria-valuemax={UP_NEXT_SECONDS} aria-valuenow={secondsLeft}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "var(--glass-line)" }}>
            <div style={{
              height: "100%", background: "var(--accent)",
              width: `${((UP_NEXT_SECONDS - secondsLeft) / UP_NEXT_SECONDS) * 100}%`, transition: "width 1s linear",
            }} />
          </div>
        </div>
        <div style={{ padding: "12px 14px 14px" }}>
          <p aria-live="polite" style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: "var(--accent-hi)" }}>
            NEXT EPISODE IN {Math.max(secondsLeft, 0)}S
          </p>
          <p className="clip-1" style={{ margin: "4px 0 12px", fontSize: 14, fontWeight: 700 }}>
            EP {episode?.episodeInSeason ?? episodeNumber}{episode?.title ? ` · ${episode.title}` : ""}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button ref={playRef} className="btn-slant btn-slant--primary" onClick={onPlay} style={{ flex: 1, justifyContent: "center", padding: "0 14px" }}>
              <SkipForward size={14} /> Play now
            </button>
            <button className="btn-slant btn-slant--ghost" onClick={onCancel} style={{ padding: "0 18px" }}>
              Cancel
            </button>
          </div>
        </div>
      </section>
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

function EpisodeSidebarItem({ ep, mediaId, mediaTitle, isActive, pct, avail }: {
  ep: Episode; mediaId: string; mediaTitle: string; isActive: boolean; pct: number; avail?: EpisodeAvail;
}) {
  const isWatched = pct >= WATCHED_RATIO * 100;
  return (
    <Link
      to={`/watch/${encodeURIComponent(mediaId)}/${ep.number}`}
      data-ep={ep.number}
      aria-current={isActive ? "true" : undefined}
      className="watch-ep"
      style={{ opacity: isWatched && !isActive ? 0.6 : 1 }}
    >
      <span style={{ position: "relative", width: 112, height: 63, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
        {ep.thumbnail
          ? <img src={ep.thumbnail} alt="" loading="lazy" width={112} height={63} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <EpisodeThumbnail title={mediaTitle} epNum={ep.number} w={112} h={63} />}
        {pct > 0 && pct < WATCHED_RATIO * 100 && (
          <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "var(--glass-line)" }}>
            <span style={{ display: "block", width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
          </span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: 1, color: isActive ? "var(--accent-hi)" : "var(--dim)" }}>
          EP {ep.episodeInSeason ?? ep.number}
          {isWatched && <Check size={11} strokeWidth={3} color="var(--seen-text)" aria-label="Watched" />}
          {isActive && <span>· NOW PLAYING</span>}
        </span>
        <span className="clip-1" style={{ marginTop: 4, fontSize: 13, fontWeight: isActive ? 700 : 600, color: "var(--text)" }}>{ep.title}</span>
        {(avail?.hasSub || avail?.hasDub) && (
          <span style={{ display: "flex", gap: 4, marginTop: 5 }}>
            {avail.hasSub && <span className="mono" style={{ fontSize: 8.5, padding: "1px 5px", borderRadius: 3, fontWeight: 800, background: "var(--sub-badge-soft)", color: "var(--sub-badge-text)" }}>SUB</span>}
            {avail.hasDub && <span className="mono" style={{ fontSize: 8.5, padding: "1px 5px", borderRadius: 3, fontWeight: 800, background: "var(--dub-badge-soft)", color: "var(--dub-badge-text)" }}>DUB</span>}
          </span>
        )}
      </span>
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
      aria-pressed={enabled}
      style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 40, opacity: faded ? 0.45 : 1 }}
    >
      <span aria-hidden="true" style={{
        width: 34, height: 20, borderRadius: 999, position: "relative", flexShrink: 0,
        background: enabled ? "var(--accent)" : "var(--surf-3)",
        transition: "background 200ms",
      }}>
        <span style={{
          position: "absolute", top: 3, left: enabled ? 17 : 3,
          width: 14, height: 14, borderRadius: "50%", background: enabled ? "var(--text)" : "var(--dim)",
          transition: "left 200ms",
        }} />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: enabled ? "var(--text)" : "var(--muted)", userSelect: "none" }}>{label}</span>
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
