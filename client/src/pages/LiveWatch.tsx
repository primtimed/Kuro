import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { LiveFavoriteButton } from "../components/LiveFavoriteButton";
import { LivePlayer } from "../components/LivePlayer";
import { api } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import { useLiveFavorites } from "../hooks/useLiveFavorites";

import type { LiveChannel } from "../lib/types";

export function LiveWatch() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [channel, setChannel] = useState<LiveChannel | null>(null);
  const [hasError, setHasError] = useState(false);
  const { favoriteIds, toggleFavorite } = useLiveFavorites();

  useEffect(() => {
    setChannel(null);
    setHasError(false);
    api.live.channel(id)
      .then(setChannel)
      .catch(() => setHasError(true));
  }, [id]);

  function handleBack() {
    // Return to the filtered list the user came from; direct visits go to the Live TV home.
    if (window.history.length > 1) navigate(-1);
    else navigate("/live");
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "16px" : "24px 32px 48px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <button
          onClick={handleBack}
          data-tv-autofocus
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 14px",
            borderRadius: 8, fontSize: 14, fontWeight: 500, marginBottom: 16,
            background: "var(--surf)", color: "var(--muted)", border: "1px solid var(--line-2)",
          }}
        >
          <ArrowLeft size={16} aria-hidden="true" /> Live TV
        </button>

        {hasError && (
          <p role="alert" style={{ color: "var(--muted)", textAlign: "center", marginTop: 64 }}>
            This channel couldn't be found. It may have been removed from the directory.
          </p>
        )}

        {!hasError && !channel && (
          <div style={{ aspectRatio: "16 / 9", borderRadius: 8, background: "var(--surf)", border: "1px solid var(--line)" }} />
        )}

        {channel && (
          <>
            <LivePlayer key={channel.id} streams={channel.streams} channelName={channel.name} />
            <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginTop: 20 }}>
              {channel.logo && (
                <img src={channel.logo} alt="" width={64} height={36} style={{ width: 64, height: 36, objectFit: "contain" }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 800 }}>{channel.name}</h1>
                <p className="mono" style={{ margin: "4px 0 0", fontSize: 11, color: "var(--dim)", letterSpacing: 0.5 }}>
                  {[channel.country, channel.categories.join(", "), channel.languages.join(", ")].filter(Boolean).join(" · ").toUpperCase()}
                </p>
              </div>
              <LiveFavoriteButton
                size="large"
                channelName={channel.name}
                isFavorite={favoriteIds.has(channel.id)}
                onToggle={() => toggleFavorite(channel.id)}
              />
            </header>
            {channel.website && (
              <a
                href={channel.website}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 12, fontSize: 13, color: "var(--muted)" }}
              >
                Channel website
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
