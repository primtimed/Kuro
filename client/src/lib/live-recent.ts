import type { LiveChannelSummary } from "./types";

const RECENT_KEY = "kuro:live-recent";
const MAX_RECENT = 20;

/** Channels opened on this device, newest first. */
export function getRecentChannels(): LiveChannelSummary[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as LiveChannelSummary[]) : [];
  } catch {
    return [];
  }
}

export function addRecentChannel(channel: LiveChannelSummary) {
  const next = [channel, ...getRecentChannels().filter((c) => c.id !== channel.id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("[live] saving recently watched channel failed:", err);
  }
}
