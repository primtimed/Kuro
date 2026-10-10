import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Media } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRuntime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function progressPercent(progress: number, duration: number): number {
  if (!duration) return 0;
  return Math.min(100, Math.round((progress / duration) * 100));
}

/** Short format label ("TV", "MOVIE", "TV SHORT"). Null when the source didn't say, rather than guessing. */
export function toFormatLabel(media: Pick<Media, "mediaFormat" | "type">): string | null {
  if (media.mediaFormat) return media.mediaFormat.replace("_", " ").toUpperCase();
  if (media.type === "movie") return "MOVIE";
  if (media.type === "series") return "TV";
  return null;
}
