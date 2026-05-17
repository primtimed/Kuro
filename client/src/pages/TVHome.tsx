import { useState, useEffect } from "react";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { TrendingList } from "../components/TrendingList";
import { api } from "../lib/api";
import type { Media, HistoryEntry } from "../lib/types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type HistoryGroup = {
  media: Media;
  maxEp: number;
  maxEpEntry: HistoryEntry;
};

export function TVHome() {
  const [trending, setTrending] = useState<Media[]>([]);
  const [onAir, setOnAir] = useState<Media[]>([]);
  const [recommended, setRecommended] = useState<Media[]>([]);
  const [history, setHistory] = useState<Media[]>([]);
  const [toWatch, setToWatch] = useState<Media[]>([]);
  const [watchtvCatalog, setWatchtvCatalog] = useState<Media[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [onAirLoading, setOnAirLoading] = useState(true);
  const [recsLoading, setRecsLoading] = useState(true);
  const [watchtvLoading, setWatchtvLoading] = useState(true);

  useEffect(() => {
    api.tv.trending()
      .then(setTrending)
      .catch(() => {})
      .finally(() => setTrendingLoading(false));

    api.tv.onAir()
      .then(setOnAir)
      .catch(() => {})
      .finally(() => setOnAirLoading(false));

    api.tv.recommendations()
      .then(setRecommended)
      .catch(() => {})
      .finally(() => setRecsLoading(false));

    api.tv.watchtvCatalog()
      .then(setWatchtvCatalog)
      .catch(() => {})
      .finally(() => setWatchtvLoading(false));

    // Continue Watching — TV history only
    api.library.history().then(async (entries) => {
      const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
      const recent = entries.filter((e) => {
        const tag = e.content_tag ?? (
          e.media_id.startsWith("tvmaze:") || e.media_id.startsWith("watchtv:") ? "tv" : "anime"
        );
        return tag === "tv" && e.last_watched > thirtyDaysAgo;
      });

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
      const results = await Promise.allSettled(
        groups.map(async (g): Promise<HistoryGroup> => ({
          media: await api.tv.getShow(g.latest.media_id),
          maxEp: g.maxEp,
          maxEpEntry: g.maxEpEntry,
        }))
      );

      const incomplete = results
        .filter((r): r is PromiseFulfilledResult<HistoryGroup> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter(({ media, maxEp, maxEpEntry }) => {
          if (!media.totalEpisodes) return true;
          if (maxEp < media.totalEpisodes) return true;
          if (!maxEpEntry.duration_seconds) return true;
          return maxEpEntry.progress_seconds / maxEpEntry.duration_seconds < 0.95;
        });

      setHistory(incomplete.map((v) => v.media));
    }).catch(() => {});

    // To Watch — TV favorites only
    api.library.favorites().then(async (favs) => {
      const tvFavs = favs.filter((f) => {
        const tag = f.content_tag ?? (
          f.media_id.startsWith("tvmaze:") || f.media_id.startsWith("watchtv:") ? "tv" : "anime"
        );
        return tag === "tv";
      });
      const medias = await Promise.allSettled(tvFavs.slice(0, 10).map((f) => api.tv.getShow(f.media_id)));
      setToWatch(
        medias
          .filter((r): r is PromiseFulfilledResult<Media> => r.status === "fulfilled")
          .map((r) => r.value)
      );
    }).catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <Hero items={trending.slice(0, 5)} loading={trendingLoading} />

      <div style={{
        height: 1,
        background: "linear-gradient(to right, transparent, var(--line-2), transparent)",
        margin: "0 32px",
      }} />

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <main style={{ flex: 1, minWidth: 0, paddingTop: 44, paddingBottom: 88 }}>
          {history.length > 0 && (
            <Row title="Continue Watching" items={history} seeAllTo="/library?tab=history" />
          )}
          {(recsLoading || recommended.length > 0) && (
            <Row title="Recommended For You" items={recommended} loading={recsLoading} />
          )}
          <Row title="Popular Shows" items={trending} loading={trendingLoading} ranked seeAllTo="/browse/trending" />
          <Row title="On Air Today" items={onAir} loading={onAirLoading} seeAllTo="/browse/onair" />
          <Row title="On WatchTV" items={watchtvCatalog} loading={watchtvLoading} />
          {toWatch.length > 0 && (
            <Row title="To Watch" items={toWatch} seeAllTo="/library" />
          )}
        </main>

        <TrendingList items={trending} loading={trendingLoading} />
      </div>
    </div>
  );
}
