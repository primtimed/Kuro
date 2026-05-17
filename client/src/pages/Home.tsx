import { useState, useEffect } from "react";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { TrendingList } from "../components/TrendingList";
import { useTrending, useSeasonal } from "../hooks/useMedia";
import type { Media, HistoryEntry } from "../lib/types";
import { api } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type HistoryGroup = {
  media: Media;
  maxEp: number;
  maxEpEntry: HistoryEntry;
};

export function Home() {
  const isMobile = useIsMobile();
  const { items: trending, loading: trendingLoading } = useTrending();
  const { items: seasonal, loading: seasonalLoading } = useSeasonal();
  const [history, setHistory] = useState<Media[]>([]);
  const [favorites, setFavorites] = useState<Media[]>([]);
  const [recommended, setRecommended] = useState<Media[]>([]);
  const [newSeasons, setNewSeasons] = useState<Media[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [newSeasonsLoading, setNewSeasonsLoading] = useState(true);

  // History + favorites: fire immediately, resolved with a single batch request each.
  useEffect(() => {
    api.library.history().then(async (entries) => {
      const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
      const recent = entries.filter((e) => e.last_watched > thirtyDaysAgo);

      const grouped = new Map<string, { latest: HistoryEntry; maxEp: number; maxEpEntry: HistoryEntry }>();
      for (const e of recent) {
        const g = grouped.get(e.media_id);
        if (!g) {
          grouped.set(e.media_id, { latest: e, maxEp: e.episode_number, maxEpEntry: e });
        } else {
          if (e.last_watched > g.latest.last_watched) g.latest = e;
          if (e.episode_number > g.maxEp) { g.maxEp = e.episode_number; g.maxEpEntry = e; }
        }
      }

      const groups = [...grouped.values()].slice(0, 12);
      const medias = await api.getMediaBatch(groups.map((g) => g.latest.media_id));
      const mediaMap = new Map(medias.map((m) => [m.id, m]));

      const incomplete = groups
        .map((g) => {
          const media = mediaMap.get(g.latest.media_id);
          if (!media) return null;
          return { media, maxEp: g.maxEp, maxEpEntry: g.maxEpEntry };
        })
        .filter((g): g is HistoryGroup => g !== null)
        .filter(({ media, maxEp, maxEpEntry }) => {
          if (!media.totalEpisodes) return true;
          if (maxEp < media.totalEpisodes) return true;
          if (!maxEpEntry.duration_seconds) return true;
          return maxEpEntry.progress_seconds / maxEpEntry.duration_seconds < 0.95;
        });

      setHistory(incomplete.map((v) => v.media));
    }).catch(() => {});

    api.library.favorites().then(async (favs) => {
      const animeFavs = favs.filter((f) =>
        (f.content_tag ?? (f.media_id.startsWith("tvmaze:") ? "tv" : "anime")) === "anime"
      );
      const medias = await api.getMediaBatch(animeFavs.slice(0, 10).map((f) => f.media_id));
      setFavorites(medias);
    }).catch(() => {});
  }, []);

  // Recommendations + new seasons: deferred until trending finishes to avoid
  // saturating the AniList rate limit while the critical rows are loading.
  useEffect(() => {
    if (trendingLoading) return;

    api.library.recommendations()
      .then((recs) => setRecommended(recs))
      .catch(() => {})
      .finally(() => setRecsLoading(false));

    api.library.newSeasons()
      .then((s) => setNewSeasons(s))
      .catch(() => {})
      .finally(() => setNewSeasonsLoading(false));
  }, [trendingLoading]);


  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <Hero items={trending.slice(0, 5)} loading={trendingLoading} />

      <div style={{
        height: 1,
        background: "linear-gradient(to right, transparent, var(--line-2), transparent)",
        margin: isMobile ? "0 16px" : "0 32px",
      }} />

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <main style={{ flex: 1, minWidth: 0, paddingTop: isMobile ? 24 : 44, paddingBottom: 88 }}>
          {history.length > 0 && <Row title="Continue Watching" items={history} seeAllTo="/library?tab=history" />}
          {(newSeasonsLoading || newSeasons.length > 0) && (
            <Row title="New Seasons — From Your List" items={newSeasons} loading={newSeasonsLoading} seeAllTo="/browse/new-seasons" />
          )}
          {(recsLoading || recommended.length > 0) && (
            <Row title="Recommended For You" items={recommended} loading={recsLoading} seeAllTo="/browse/recommended" />
          )}
          <Row title="Trending Now" items={trending} loading={trendingLoading} ranked seeAllTo="/browse/trending" />
          <Row title="This Season" items={seasonal} loading={seasonalLoading} seeAllTo="/browse/seasonal" />

          {favorites.length > 0 && <Row title="To Watch" items={favorites} seeAllTo="/library" />}
        </main>

        {!isMobile && <TrendingList items={trending} loading={trendingLoading} />}
      </div>
    </div>
  );
}
