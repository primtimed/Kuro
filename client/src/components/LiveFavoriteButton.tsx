import { Heart } from "lucide-react";

interface LiveFavoriteButtonProps {
  channelName: string;
  isFavorite: boolean;
  onToggle: () => void;
  size?: "small" | "large";
}

export function LiveFavoriteButton({ channelName, isFavorite, onToggle, size = "small" }: LiveFavoriteButtonProps) {
  const isLarge = size === "large";
  return (
    <button
      onClick={onToggle}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? `Remove ${channelName} from favourites` : `Add ${channelName} to favourites`}
      title={isFavorite ? "Remove from favourites" : "Add to favourites"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        minWidth: 44, minHeight: 44, padding: isLarge ? "0 16px" : 0, borderRadius: isLarge ? 8 : 999,
        fontSize: 14, fontWeight: 500,
        background: isFavorite ? "var(--fav-soft)" : "var(--surf)",
        color: isFavorite ? "var(--fav)" : "var(--muted)",
        border: `1px solid ${isFavorite ? "var(--fav-border)" : "var(--line-2)"}`,
      }}
    >
      <Heart size={isLarge ? 16 : 18} aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} />
      {isLarge && (isFavorite ? "Favourite" : "Add to favourites")}
    </button>
  );
}
