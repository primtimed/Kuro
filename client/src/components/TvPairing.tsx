import { useEffect, useState } from "react";

import { api } from "../lib/api";

const POLL_INTERVAL_MS = 3000;

interface Pairing {
  code: string;
  pollToken: string;
  expiresAt: number;
  qrDataUrl: string | null;
}

// Shown on the TV: a code (and QR) that someone signed in on their phone approves.
export function TvPairing({ onApproved }: { onApproved: () => void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let isCancelled = false;
    setError(null);
    api.auth.startPairing()
      .then(async (started) => {
        const approveUrl = `${window.location.origin}/pair?code=${encodeURIComponent(started.code)}`;
        // The QR library only downloads when a TV actually needs a code
        const qrDataUrl = await import("qrcode")
          .then((qr) => qr.toDataURL(approveUrl, { margin: 1, width: 220 }))
          .catch(() => null);
        if (!isCancelled) setPairing({ ...started, qrDataUrl });
      })
      .catch((err: Error) => { if (!isCancelled) setError(err.message); });
    return () => { isCancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      api.auth.pollPairing(pairing.pollToken)
        .then(({ status }) => {
          if (status === "approved") onApproved();
          // Codes last 10 minutes; a TV left on this screen quietly gets a fresh one
          else if (status === "expired") setAttempt((a) => a + 1);
        })
        .catch((err: unknown) => console.error("[pairing] poll failed:", err));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pairing, onApproved]);

  if (error) {
    return (
      <div role="alert" style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>{error}</p>
        <button onClick={() => setAttempt((a) => a + 1)} data-tv-autofocus style={buttonStyle}>Try again</button>
      </div>
    );
  }
  if (!pairing) return <p style={{ color: "var(--muted)", textAlign: "center" }}>Getting a code…</p>;

  const minutesLeft = Math.max(1, Math.round((pairing.expiresAt - now) / 60_000));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 32 }}>
      {pairing.qrDataUrl && (
        <img src={pairing.qrDataUrl} alt="QR code that opens the approve page on your phone" width={220} height={220}
          style={{ borderRadius: 10, background: "var(--text)" }} />
      )}
      <div style={{ textAlign: "left", maxWidth: 360 }}>
        <p style={{ margin: "0 0 6px", fontSize: 15, color: "var(--muted)" }}>On your phone, scan the code or go to</p>
        <p style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 700 }}>{window.location.host}/pair</p>
        <p style={{ margin: "0 0 6px", fontSize: 15, color: "var(--muted)" }}>and enter</p>
        <p className="mono" aria-live="polite" style={{ margin: "0 0 14px", fontSize: 44, fontWeight: 800, letterSpacing: 4 }}>{pairing.code}</p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--dim)" }}>
          The TV signs in by itself once you approve it · code valid for {minutesLeft} min
        </p>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  minHeight: 44, padding: "0 20px", borderRadius: 8, fontSize: 14, fontWeight: 600,
  background: "var(--accent)", color: "var(--text)", border: "none",
};
