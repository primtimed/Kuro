import { useState } from "react";
import { PlayCircle } from "lucide-react";

import { SettingsSection } from "./SettingsSection";

// Same keys the watch page reads, so a change here applies the next time an episode opens.
const AUTO_PLAY_KEY = "kuro:autoPlay";
const AUTO_SKIP_KEY = "kuro:autoSkip";
const DUB_KEY = "kuro:isDub";

function readFlag(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? defaultValue : stored === "true";
  } catch {
    return defaultValue;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch (err) {
    console.error(`[settings] saving ${key} failed:`, err);
  }
}

export function PlaybackSection() {
  const [isAutoPlay, setIsAutoPlay] = useState(() => readFlag(AUTO_PLAY_KEY, true));
  const [isAutoSkip, setIsAutoSkip] = useState(() => readFlag(AUTO_SKIP_KEY, false));
  const [isDub, setIsDub] = useState(() => readFlag(DUB_KEY, false));

  return (
    <SettingsSection
      label="Playback"
      icon={<PlayCircle size={17} />}
      description="Defaults for the watch page on this device. Switching sub/dub on a show remembers that choice for the show itself."
    >
      <PlaybackToggle
        title="Auto-play next episode"
        hint="5-second countdown, then the next episode starts"
        isOn={isAutoPlay}
        onChange={(v) => { setIsAutoPlay(v); writeFlag(AUTO_PLAY_KEY, v); }}
      />
      <PlaybackToggle
        title="Auto-skip intro & outro"
        hint="Uses AniSkip timings when they exist for the episode"
        isOn={isAutoSkip}
        onChange={(v) => { setIsAutoSkip(v); writeFlag(AUTO_SKIP_KEY, v); }}
      />
      <PlaybackToggle
        title="Prefer English dub"
        hint="Falls back to sub when an episode has no dub"
        isOn={isDub}
        onChange={(v) => { setIsDub(v); writeFlag(DUB_KEY, v); }}
        isLast
      />
    </SettingsSection>
  );
}

function PlaybackToggle({ title, hint, isOn, onChange, isLast }: {
  title: string; hint: string; isOn: boolean; onChange: (value: boolean) => void; isLast?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={isOn}
      onClick={() => onChange(!isOn)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "12px 0",
        textAlign: "left", borderBottom: isLast ? "none" : "1px dashed var(--line)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--dim)", marginTop: 2 }}>{hint}</span>
      </span>
      <span aria-hidden="true" style={{
        position: "relative", width: 40, height: 23, borderRadius: 999, flexShrink: 0,
        background: isOn ? "var(--accent)" : "var(--surf-3)", transition: "background 200ms",
      }}>
        <span style={{
          position: "absolute", top: 3, left: isOn ? 20 : 3, width: 17, height: 17, borderRadius: "50%",
          background: isOn ? "var(--text)" : "var(--dim)", transition: "left 200ms",
        }} />
      </span>
    </button>
  );
}
