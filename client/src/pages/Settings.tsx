import { useState, useEffect } from "react";
import { Check, RefreshCw } from "lucide-react";
import { AccountSection } from "../components/settings/AccountSection";
import { DevicesSection } from "../components/settings/DevicesSection";
import { FamilySection } from "../components/settings/FamilySection";
import { useAccount } from "../context/AccountContext";
import { api } from "../lib/api";
import type { StreamingSite } from "../lib/types";

export function Settings() {
  const { isAdmin } = useAccount();
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "80px 32px 64px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>Settings</h1>
      <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
        Your account, signed-in devices, recommendations and the streaming sites Kuro uses.
      </p>

      <div style={{ maxWidth: 740 }}>
        <AccountSection />
        <DevicesSection />
        {isAdmin && <FamilySection />}
        <RecommendationsSection />
        <StreamingDirectorySection />
      </div>
    </div>
  );
}

function RecommendationsSection() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function refresh() {
    setState("loading");
    try {
      await api.library.refreshRecommendations();
      setState("done");
    } catch {
      setState("idle");
    }
  }

  return (
    <>
      <div style={{ height: 1, background: "var(--line)", margin: "36px 0 28px" }} />
      <p className="mono" style={{ margin: "0 0 6px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>RECOMMENDATIONS</p>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
        Recommendations are cached for 24 hours. Refresh to recalculate them based on your latest activity.
      </p>
      {state === "done" ? (
        <p style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={14} style={{ color: "#4ade80" }} /> Done — visit the home page to see refreshed recommendations.
        </p>
      ) : (
        <button
          onClick={refresh}
          disabled={state === "loading"}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: "var(--surf)", border: "1px solid var(--line-2)", color: "var(--muted)",
            cursor: state === "loading" ? "wait" : "pointer",
            opacity: state === "loading" ? 0.6 : 1,
          }}
        >
          <RefreshCw size={13} style={{ animation: state === "loading" ? "spin 1s linear infinite" : "none" }} />
          {state === "loading" ? "Refreshing…" : "Refresh Recommendations"}
        </button>
      )}
    </>
  );
}

const DIRECTORY_PREVIEW_COUNT = 20;

function StreamingDirectorySection() {
  const [sites, setSites] = useState<StreamingSite[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    api.services.directory()
      .then(setSites)
      .catch(() => setHasError(true));
  }, []);

  const visible = isExpanded ? sites ?? [] : (sites ?? []).slice(0, DIRECTORY_PREVIEW_COUNT);
  const supportedCount = sites?.filter((s) => s.isSupported).length ?? 0;

  return (
    <section aria-label="Streaming sites">
      <div style={{ height: 1, background: "var(--line)", margin: "36px 0 28px" }} />
      <p className="mono" style={{ margin: "0 0 6px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>STREAMING SITES · EVERYTHINGMOE</p>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
        Ranked public anime streaming sites, refreshed daily from everythingmoe.com. Kuro uses the
        {" "}{supportedCount || ""} sites marked <span style={{ color: "var(--seen-text)" }}>Supported</span> (episodes play
        from AnikotoTV) and follows them automatically when they move to a new domain.
      </p>

      {hasError && <p role="alert" style={{ fontSize: 13, color: "var(--muted)" }}>The site directory couldn't be loaded right now.</p>}
      {!sites && !hasError && <p style={{ fontSize: 13, color: "var(--dim)" }}>Loading directory…</p>}

      {sites && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {visible.map((site) => (
            <li key={site.slug} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 7,
              background: "var(--surf)", border: `1px solid ${site.isSupported ? "var(--seen-border)" : "var(--line)"}`,
            }}>
              <span className="mono" style={{ width: 26, fontSize: 11, color: "var(--dim)" }}>{site.rank}.</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: 0, flex: "0 1 160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site.name}</span>
              <a href={site.url} target="_blank" rel="noopener noreferrer" style={{
                fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {hostOf(site.url)}
              </a>
              {site.isSupported && (
                <span className="mono" style={{
                  fontSize: 9, letterSpacing: 1, padding: "3px 7px", borderRadius: 4,
                  background: "var(--seen-soft)", color: "var(--seen-text)", border: "1px solid var(--seen-border)",
                }}>
                  SUPPORTED
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {sites && sites.length > DIRECTORY_PREVIEW_COUNT && (
        <button
          onClick={() => setIsExpanded((v) => !v)}
          style={{
            marginTop: 10, minHeight: 44, padding: "0 16px", borderRadius: 7, fontSize: 13, fontWeight: 500,
            background: "var(--surf)", border: "1px solid var(--line-2)", color: "var(--muted)",
          }}
        >
          {isExpanded ? "Show fewer" : `Show all ${sites.length}`}
        </button>
      )}
    </section>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
