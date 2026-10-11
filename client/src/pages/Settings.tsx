import { useState, useEffect } from "react";
import { Check, RefreshCw, LayoutGrid, User, Monitor, Users, PlayCircle, Sparkles, Globe, Lock, LogOut, ExternalLink } from "lucide-react";
import { AccountSection } from "../components/settings/AccountSection";
import { DevicesSection } from "../components/settings/DevicesSection";
import { FamilySection } from "../components/settings/FamilySection";
import { PlaybackSection } from "../components/settings/PlaybackSection";
import { SettingsSection, settingsButton, settingsRow } from "../components/settings/SettingsSection";
import { useAccount } from "../context/AccountContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { api } from "../lib/api";
import type { StreamingSite } from "../lib/types";

type SectionId = "overview" | "account" | "devices" | "family" | "playback" | "recommendations" | "sites";

const OVERVIEW_SITE_COUNT = 5;
const PAGE_SITE_COUNT = 20;

export function Settings() {
  const { isAdmin, me, account, signOut } = useAccount();
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SectionId>("overview");
  const hasPin = !!me?.profiles.find((p) => p.isOwner)?.hasPin;

  const nav: { id: SectionId; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutGrid size={17} /> },
    { id: "account", label: "Account", icon: <User size={17} /> },
    { id: "devices", label: "Devices", icon: <Monitor size={17} /> },
    ...(isAdmin ? [{ id: "family" as const, label: "Family", icon: <Users size={17} /> }] : []),
    { id: "playback", label: "Playback", icon: <PlayCircle size={17} /> },
    { id: "recommendations", label: "Recommendations", icon: <Sparkles size={17} /> },
    { id: "sites", label: "Streaming sites", icon: <Globe size={17} /> },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "8px 16px 64px" : "8px 32px 88px" }}>
      {/* Banner */}
      <section className="lib-hero" aria-label="Signed-in account" style={{ minHeight: 0 }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, var(--accent-soft), transparent 60%)" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 16 : 22, minWidth: 0 }}>
          <div style={{
            width: isMobile ? 60 : 76, height: isMobile ? 60 : 76, borderRadius: 16, flexShrink: 0,
            background: account ? `linear-gradient(135deg, ${account.color}, ${account.color}88)` : "var(--accent)",
            display: "grid", placeItems: "center", fontSize: isMobile ? 26 : 34, fontWeight: 900,
            boxShadow: "0 12px 30px var(--accent-glow)",
          }}>
            {account?.initial ?? "?"}
          </div>
          <div style={{ minWidth: 0 }}>
            <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "var(--accent-hi)" }}>SETTINGS</p>
            <h1 style={{ margin: "4px 0 0", fontSize: isMobile ? 26 : 38, fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1, textTransform: "uppercase" }}>
              {account?.name}'s <span style={{ color: "var(--accent)" }}>settings.</span>
            </h1>
            {me && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
                Signed in as {me.owner.name} on {me.device.name}{isAdmin ? " · admin of this household" : ""}
              </p>
            )}
          </div>
        </div>
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 10, marginLeft: isMobile ? 0 : "auto" }}>
          <button onClick={() => setSection("account")} style={settingsButton}>
            <Lock size={15} aria-hidden="true" /> {hasPin ? "PIN is set" : "Set a PIN"}
          </button>
          <button onClick={() => void signOut()} style={settingsButton}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      </section>

      <div className="settings-layout">
        <nav aria-label="Settings sections" className="settings-nav">
          {nav.map((item, i) => (
            <div key={item.id} style={{ display: "contents" }}>
              {i === 1 && <span aria-hidden="true" className="settings-nav-sep" />}
              <button className="settings-nav-btn" aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
                <span className="settings-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            </div>
          ))}
        </nav>

        <div style={{ minWidth: 0 }}>
          {section === "overview" ? (
            <>
              <div className="settings-cols">
                <div className="settings-stack">
                  <AccountSection />
                  <DevicesSection />
                  <RecommendationsSection />
                </div>
                <div className="settings-stack">
                  {isAdmin && <FamilySection />}
                  <PlaybackSection />
                </div>
              </div>
              <div style={{ marginTop: 18 }}>
                <StreamingDirectorySection previewCount={OVERVIEW_SITE_COUNT} />
              </div>
            </>
          ) : section === "account" ? <AccountSection />
            : section === "devices" ? <DevicesSection />
            : section === "family" ? <FamilySection />
            : section === "playback" ? <PlaybackSection />
            : section === "recommendations" ? <RecommendationsSection />
            : <StreamingDirectorySection previewCount={PAGE_SITE_COUNT} />}
        </div>
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
    } catch (err) {
      console.error("[settings] refreshing recommendations failed:", err);
      setState("idle");
    }
  }

  return (
    <SettingsSection
      label="Recommendations"
      icon={<Sparkles size={17} />}
      description="Recommendations are cached for 24 hours. Refresh to recalculate them from your latest activity."
    >
      {state === "done" ? (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={14} style={{ color: "var(--seen-text)" }} /> Done — visit the home page to see refreshed recommendations.
        </p>
      ) : (
        <button
          onClick={refresh}
          disabled={state === "loading"}
          style={{ ...settingsButton, cursor: state === "loading" ? "wait" : "pointer", opacity: state === "loading" ? 0.6 : 1 }}
        >
          <RefreshCw size={14} style={{ animation: state === "loading" ? "spin 1s linear infinite" : "none" }} />
          {state === "loading" ? "Refreshing…" : "Refresh recommendations"}
        </button>
      )}
    </SettingsSection>
  );
}

function StreamingDirectorySection({ previewCount }: { previewCount: number }) {
  const [sites, setSites] = useState<StreamingSite[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    api.services.directory()
      .then(setSites)
      .catch((err: unknown) => {
        console.error("[settings] loading streaming directory failed:", err);
        setHasError(true);
      });
  }, []);

  const visible = isExpanded ? sites ?? [] : (sites ?? []).slice(0, previewCount);
  const supportedCount = sites?.filter((s) => s.isSupported).length ?? 0;

  return (
    <SettingsSection
      label="Streaming sites"
      icon={<Globe size={17} />}
      meta={<span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>VIA EVERYTHINGMOE · DAILY</span>}
      description={<>
        Ranked public anime streaming sites, refreshed daily from everythingmoe.com. Kuro uses the
        {" "}{supportedCount || ""} sites marked <span style={{ color: "var(--seen-text)" }}>Supported</span> (episodes play
        from AnikotoTV) and follows them automatically when they move to a new domain.
      </>}
    >
      {hasError && <p role="alert" style={{ fontSize: 13, color: "var(--muted)" }}>The site directory couldn't be loaded right now.</p>}
      {!sites && !hasError && <p style={{ fontSize: 13, color: "var(--dim)" }}>Loading directory…</p>}

      {sites && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {visible.map((site) => (
            <li key={site.slug} style={{ ...settingsRow, flexWrap: "nowrap", padding: "9px 12px", borderColor: site.isSupported ? "var(--seen-border)" : "var(--line)" }}>
              <span className="mono" style={{ width: 26, fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>{site.rank}.</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", minWidth: 0, flex: "0 1 150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site.name}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hostOf(site.url)}</span>
              {site.isSupported && (
                <span className="mono" style={{
                  fontSize: 9.5, fontWeight: 800, letterSpacing: 1, padding: "3px 7px", borderRadius: 4, flexShrink: 0,
                  background: "var(--seen-soft)", color: "var(--seen-text)", border: "1px solid var(--seen-border)",
                }}>
                  SUPPORTED
                </span>
              )}
              <a href={site.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${site.name}`} style={{ display: "grid", placeItems: "center", width: 32, height: 32, color: "var(--dim)", flexShrink: 0 }}>
                <ExternalLink size={14} />
              </a>
            </li>
          ))}
        </ol>
      )}

      {sites && sites.length > previewCount && (
        <button onClick={() => setIsExpanded((v) => !v)} style={{ ...settingsButton, marginTop: 10, minHeight: 44 }}>
          {isExpanded ? "Show fewer" : `Show all ${sites.length} sites`}
        </button>
      )}
    </SettingsSection>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
