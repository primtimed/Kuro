import { useRef, useCallback } from "react";
import { api } from "../lib/api";

export function useProgress(mediaId: string, episodeNumber: number, isDub?: boolean) {
  const lastSaved = useRef(0);

  const save = useCallback(
    (currentTime: number, duration: number) => {
      if (Math.abs(currentTime - lastSaved.current) < 10) return;
      lastSaved.current = currentTime;
      api.library.saveProgress({
        media_id: mediaId,
        episode_number: episodeNumber,
        progress_seconds: Math.floor(currentTime),
        duration_seconds: duration ? Math.floor(duration) : undefined,
        is_dub: isDub,
      }).catch(() => {/* non-critical */});
    },
    [mediaId, episodeNumber, isDub]
  );

  return { save };
}
