import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function useLiveFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.live.favorites()
      .then((ids) => setFavoriteIds(new Set(ids)))
      .catch((err: unknown) => console.error("[live] loading favourite channels failed:", err));
  }, []);

  // Updates optimistically so the heart responds instantly; rolls back if the save fails.
  function toggleFavorite(channelId: string): boolean {
    const shouldAdd = !favoriteIds.has(channelId);
    setFavoriteIds((prev) => withToggled(prev, channelId, shouldAdd));
    (shouldAdd ? api.live.addFavorite(channelId) : api.live.removeFavorite(channelId))
      .catch((err: unknown) => {
        console.error("[live] saving favourite channel failed:", err);
        setFavoriteIds((prev) => withToggled(prev, channelId, !shouldAdd));
      });
    return shouldAdd;
  }

  return { favoriteIds, toggleFavorite };
}

function withToggled(ids: Set<string>, id: string, shouldInclude: boolean): Set<string> {
  const next = new Set(ids);
  if (shouldInclude) next.add(id);
  else next.delete(id);
  return next;
}
