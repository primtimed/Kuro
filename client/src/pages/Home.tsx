import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { ContinueWatching, type ContinueItem } from "../components/ContinueWatching";
import { TrendingPanel } from "../components/TrendingPanel";
import { SchedulePanel } from "../components/SchedulePanel";
import { useTrending, useSeasonal } from "../hooks/useMedia";
import type { Media, HistoryEntry } from "../lib/types";
import { api } from "../lib/api";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FINISHED_RATIO = 0.95;

type HistoryGroup = {
  media: Media;
  latest: HistoryEntry;
  maxEp: number;
  maxEpEntry: HistoryEntry;
};

export function Home() {
  const { items: trending, loading: trendingLoading } = useTrending();
  const { items: seasonal, loading: seasonalLoading } = useSeasonal();
  const [history, setHistory] = useState<ContinueItem[]>([]);
  const [favorites, setFavorites] = useState<Media[]>([]);
  const [recommended, setRecommended] = useState<Media[]>([]);
  const [newSeasons, setNewSeasons] = useState<Media[]>([]);
  const [newEpisodes, setNewEpisodes] = useState<Media[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [newSeasonsLoading, setNewSeasonsLoading] = useState(true);

  // History + favorites: fire immediately, resolved with a single batch request each.
  useEffect(() => {
    api.library.history().then(async (entries) => {
      const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
      const recent = entries.filter((e) => {
        const tag = e.content_tag ?? (
          e.media_id.startsWith("tvmaze:") || e.media_id.startsWith("watchtv:") ? "tv" : "anime"
        );
        return tag === "anime" && e.last_watched > thirtyDaysAgo;
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
      const medias = await api.getMediaBatch(groups.map((g) => g.latest.media_id));
      const mediaMap = new Map(medias.map((m) => [m.id, m]));

      const incomplete = groups
        .map((g) => {
          const media = mediaMap.get(g.latest.media_id);
          if (!media) return null;
          return { media, latest: g.latest, maxEp: g.maxEp, maxEpEntry: g.maxEpEntry };
        })
        .filter((g): g is HistoryGroup => g !== null)
        .filter(({ media, maxEp, maxEpEntry }) => {
          if (!media.totalEpisodes) return true;
          if (maxEp < media.totalEpisodes) return true;
          if (!maxEpEntry.duration_seconds) return true;
          return maxEpEntry.progress_seconds / maxEpEntry.duration_seconds < FINISHED_RATIO;
        });

      setHistory(incomplete.map(toContinueItem));
    }).catch((err: unknown) => console.error("[home] loading watch history failed:", err));

    api.library.favorites().then(async (favs) => {
      const animeFavs = favs.filter((f) =>
        (f.content_tag ?? (f.media_id.startsWith("tvmaze:") ? "tv" : "anime")) === "anime"
      );
      const medias = await api.getMediaBatch(animeFavs.slice(0, 10).map((f) => f.media_id));
      setFavorites(medias);
    }).catch((err: unknown) => console.error("[home] loading favorites failed:", err));
  }, []);

  // Recommendations + new seasons: deferred until trending finishes to avoid
  // saturating the AniList rate limit while the critical rows are loading.
  useEffect(() => {
    if (trendingLoading) return;

    api.library.recommendations()
      .then((recs) => setRecommended(recs))
      .catch((err: unknown) => console.error("[home] loading recommendations failed:", err))
      .finally(() => setRecsLoading(false));

    api.library.newSeasons()
      .then((s) => setNewSeasons(s))
      .catch((err: unknown) => console.error("[home] loading new seasons failed:", err))
      .finally(() => setNewSeasonsLoading(false));

    api.library.newEpisodes()
      .then(setNewEpisodes)
      .catch((err: unknown) => console.error("[home] loading new episodes failed:", err));
  }, [trendingLoading]);

  return (
    <div className="home-dash" style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <main style={{ minWidth: 0 }}>
        <div className="home-dash-hero">
          <Hero items={trending.slice(0, 5)} loading={trendingLoading} />
        </div>

        {history.length > 0 && <ContinueWatching items={history} />}
        {newEpisodes.length > 0 && (
          <div id="new-episodes" style={{ scrollMarginTop: 90 }}>
            <Row title="New Episodes — Shows You're Watching" items={newEpisodes} />
          </div>
        )}
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

      <aside className="home-dash-aside" aria-label="Trending and schedule">
        {newEpisodes.length > 0 && <NewEpisodesBanner count={newEpisodes.length} />}
        <TrendingPanel tabs={[
          { label: "Now", items: trending, loading: trendingLoading },
          { label: "Season", items: seasonal, loading: seasonalLoading },
        ]} />
        <SchedulePanel isEnabled={!trendingLoading} />
      </aside>
    </div>
  );
}

/** Resumes the most recent episode, or the next one when the last session reached the end. */
function toContinueItem({ media, latest }: HistoryGroup): ContinueItem {
  const isFinished = !!latest.duration_seconds && latest.progress_seconds / latest.duration_seconds >= FINISHED_RATIO;
  const hasNext = !media.totalEpisodes || latest.episode_number < media.totalEpisodes;
  if (isFinished && hasNext) {
    return { media, episode: latest.episode_number + 1, progressSeconds: 0 };
  }
  return {
    media,
    episode: latest.episode_number,
    progressSeconds: latest.progress_seconds,
    durationSeconds: latest.duration_seconds,
  };
}

function NewEpisodesBanner({ count }: { count: number }) {
  return (
    <a
      href="#new-episodes"
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
        borderRadius: 8, border: "1px solid var(--accent-line)", borderLeft: "3px solid var(--accent)",
        background: "linear-gradient(90deg, var(--accent-soft), transparent)",
      }}
    >
      <Bell size={18} aria-hidden="true" />
      <span>
        <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "var(--accent-hi)" }}>NEW EPISODES</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {count} {count === 1 ? "show" : "shows"} on your list {count === 1 ? "has" : "have"} new episodes.
        </span>
      </span>
    </a>
  );
}
