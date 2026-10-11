import { useEffect, useRef, useState } from "react";

import type { LiveChannelSummary } from "../lib/types";

const FIRST_CAPTURE_RETRY_MS = 20_000;

interface ChannelPreviewProps {
  channel: Pick<LiveChannelSummary, "id" | "name" | "logo">;
  /** Changes once a minute (useMinuteTick); each change fetches a fresh still. */
  tick: number;
}

/**
 * Channel logo with a live still from the stream over it once the server has captured one.
 * Only tiles on screen ask for stills, and the previous still stays up while the next loads.
 */
export function ChannelPreview({ channel, tick }: ChannelPreviewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const [hasLogoError, setHasLogoError] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let isCancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      const url = `/api/live/channels/${encodeURIComponent(channel.id)}/preview?t=${tick}-${attempt}`;
      // The server answers 204 until it has a still (a preloading Image treats that as an error).
      // A first capture takes a few seconds, so ask once more instead of waiting a whole minute.
      const img = new Image();
      img.onload = () => { if (!isCancelled) setStillUrl(url); };
      img.onerror = () => { if (!isCancelled && attempt === 0) retryTimer = setTimeout(() => load(1), FIRST_CAPTURE_RETRY_MS); };
      img.src = url;
    };
    load(0);
    return () => {
      isCancelled = true;
      clearTimeout(retryTimer);
    };
  }, [channel.id, tick, isVisible]);

  const initials = channel.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(circle at 50% 40%, var(--surf-3), var(--surf) 70%)" }}>
      {channel.logo && !hasLogoError ? (
        <img
          src={channel.logo}
          alt=""
          loading="lazy"
          width={160}
          height={90}
          onError={() => setHasLogoError(true)}
          style={{ width: "62%", height: "58%", objectFit: "contain", filter: "drop-shadow(0 6px 14px var(--glass-strong))" }}
        />
      ) : (
        <span aria-hidden="true" style={{ fontSize: 26, fontWeight: 800, color: "var(--dim)" }}>{initials}</span>
      )}
      {stillUrl && (
        <>
          <img src={stillUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          {/* Small logo in the corner so the channel stays recognisable over its own picture */}
          {channel.logo && !hasLogoError && (
            <img src={channel.logo} alt="" style={{
              position: "absolute", right: 8, bottom: 8, width: 44, height: 26, objectFit: "contain",
              padding: 3, borderRadius: 4, background: "var(--glass-strong)",
            }} />
          )}
        </>
      )}
    </div>
  );
}
