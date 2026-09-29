# Kuro

A local media streaming app — anime, movies, series, live TV — built Netflix/Crunchyroll-style.

## Stack

| Layer    | Tech                                       |
|----------|--------------------------------------------|
| Frontend | React 19 + Vite + TypeScript + Tailwind v4 |
| Backend  | Node + Express 5 + TypeScript              |
| Database | SQLite (better-sqlite3)                    |
| Player   | HLS.js + Plyr                              |
| APIs     | Jikan, AniList (GraphQL), Consumet, AnimePahe, TVMaze, WatchTV |

## Quick Start

```bash
# 1 — install all deps (run from repo root)
npm run install:all

# 2 — start dev servers (server :3002, client :5173)
npm run dev
```

Open **http://localhost:5173** (API server runs on :3002)

## Environment Variables

| Variable              | Default                      | Description                                        |
|-----------------------|------------------------------|----------------------------------------------------|
| `PORT`                | `3002`                       | Express server port                                |
| `CLIENT_URL`          | `http://localhost:5173`      | CORS allowed origin                                |
| `NETWORK_URL`         | —                            | Additional CORS origin (e.g. LAN address)          |
| `CONSUMET_BASE_URL`   | `https://api.consumet.org`   | Consumet API base (self-host recommended)          |
| `GOOGLE_CLIENT_ID`    | —                            | OAuth client ID for "Sign in with Google" (required) |
| `PUBLIC_URL`          | `http://localhost:7000`      | Address used in the admin setup link               |

> **Note:** The public `api.consumet.org` instance is often unreliable. For reliable stream playback, run a local [Consumet API](https://github.com/consumet/consumet.ts) instance and point `CONSUMET_BASE_URL` at it.

## Self-hosting Consumet locally

```bash
git clone https://github.com/consumet/consumet.ts
cd consumet.ts
npm install
npm start   # runs on :3000

# then in your .env:
# CONSUMET_BASE_URL=http://localhost:3000
```

## Nginx (optional, for LAN access)

An `nginx.conf` is included that proxies `localvideoserv.io` → Express (:3002) and Vite (:5173).

## Folder Structure

```
Anime/
├── server/src/
│   ├── providers/     jikan.ts · anilist.ts · consumet.ts · animepahe.ts · tvmaze.ts · watchtv.ts · anikototv.ts
│   ├── routes/        media.ts · stream.ts · library.ts · tv.ts · local.ts · torrent.ts · services.ts · proxy.ts
│   ├── db/            schema.ts · client.ts
│   ├── cache/         index.ts (in-memory + TTL)
│   ├── lib/
│   ├── types/         media.ts
│   └── server.ts
└── client/src/
    ├── components/    Card · Row · Hero · Player · CastCard · EpisodeList · Navbar · TrailerBackdrop · TrendingList
    ├── context/       AccountContext · LibraryContext · MediaModeContext · ServicesContext
    ├── pages/         Home · TVHome · Browse · Detail · Search · Library · Watch · Settings · ProfileSelect
    ├── hooks/         useMedia · useProgress · useIsMobile · useSpatialNav
    ├── lib/           api.ts · types.ts · utils.ts · procedural.tsx · localCache.ts · services.ts · accounts.ts
    ├── App.tsx
    └── main.tsx
```

## Sign-in

Kuro is for one household. Everyone signs in with Google; nobody has a Kuro password.

- **Admin setup:** on first start the server log prints a one-time setup link. Open it and sign in with Google to become admin (linked to the Brian profile).
- **Family members:** the admin creates an invite link per profile in *Settings → Family*. It works once and expires after 7 days.
- **Profile PINs (optional):** asked when opening someone else's profile; forgotten PINs are replaced in *Settings → Your account*.
- **TVs:** the TV shows a code; anyone signed in approves it at `/pair` on their phone.
- **Locked out?** `docker compose exec server node dist/scripts/admin-setup.js` prints a new setup link.

Sessions last 90 days and renew while in use. *Guest* is a profile on signed-in devices that saves nothing.

## Scrapers / Providers

Episodes stream from **AnikotoTV** (sub + dub) as an embedded megaplay.buzz player.
Its current domain, and AnimePahe's, is read daily from the ranked directory at
[everythingmoe.com/simple](https://everythingmoe.com/simple), shown under Settings → Streaming sites.

| ID          | Name        | Used for                                  |
|-------------|-------------|-------------------------------------------|
| `anikoto`   | AnikotoTV   | Streams, sub/dub availability, new episodes |
| `animepahe` | AnimePahe   | Sub availability fallback                 |
| `anilist`   | AniList     | Metadata + art                            |
| `jikan`     | Jikan       | MAL metadata                              |
| `tvmaze`    | TVMaze      | TV series metadata                        |
| `iptv-org`  | iptv-org    | Live TV channels                          |
| nyaa.si     | Nyaa        | Dub release detection                     |

## API Routes

### Media

| Method | Path                                         | Description                          |
|--------|----------------------------------------------|--------------------------------------|
| GET    | `/api/health`                                | Health check                         |
| GET    | `/api/media/trending`                        | Trending (AniList + Jikan merged)    |
| GET    | `/api/media/seasonal`                        | Current season                       |
| GET    | `/api/media/search?q=...`                    | Search                               |
| GET    | `/api/media/genre/:genre`                    | Browse by genre                      |
| GET    | `/api/media/new-seasons`                     | New seasons                          |
| GET    | `/api/media/:id`                             | Full media detail                    |
| GET    | `/api/media/:id/episodes`                    | Episode list                         |
| GET    | `/api/media/:id/stream?episode=1`            | Stream URL                           |
| GET    | `/api/media/:id/relations`                   | Related media                        |
| GET    | `/api/media/:id/similar`                     | Similar titles                       |
| GET    | `/api/media/:id/availability`                | Scraper availability check           |
| GET    | `/api/media/dub-available?id=...`            | Check dub availability               |
| GET    | `/api/media/dub-available-batch`             | Batch dub availability check         |

### Library

| Method | Path                                         | Description                          |
|--------|----------------------------------------------|--------------------------------------|
| GET    | `/api/library/favorites`                     | Get favorites                        |
| POST   | `/api/library/favorites`                     | Add to favorites                     |
| DELETE | `/api/library/favorites/:mediaId`            | Remove from favorites                |
| GET    | `/api/library/favorite-series`               | Get favorite series                  |
| POST   | `/api/library/favorite-series`               | Add favorite series                  |
| DELETE | `/api/library/favorite-series/:mediaId`      | Remove favorite series               |
| GET    | `/api/library/likes`                         | Get liked episodes                   |
| POST   | `/api/library/likes`                         | Like an episode                      |
| DELETE | `/api/library/likes/:mediaId`                | Remove like                          |
| GET    | `/api/library/history`                       | Watch history                        |
| DELETE | `/api/library/history/:mediaId`              | Remove from history                  |
| GET    | `/api/library/progress`                      | All watch progress                   |
| GET    | `/api/library/progress/:mediaId`             | Progress for a title                 |
| POST   | `/api/library/progress`                      | Save watch progress                  |
| GET    | `/api/library/manually-watched`              | Manually-marked as watched           |
| POST   | `/api/library/manually-watched`              | Mark as watched                      |
| DELETE | `/api/library/manually-watched/:mediaId`     | Unmark                               |
| GET    | `/api/library/watched-shows`                 | Watched TV shows                     |
| GET    | `/api/library/recommendations`              | Recommendations                      |
| DELETE | `/api/library/recommendations`              | Clear recommendations                |

### TV

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| GET    | `/api/tv/onair`                   | On-air TV shows                    |
| GET    | `/api/tv/find`                    | Find a TV show                     |
| GET    | `/api/tv/stream`                  | Stream a TV episode                |
| GET    | `/api/tv/hls`                     | HLS TV stream                      |
| GET    | `/api/tv/watchtv/catalog`         | WatchTV channel catalog            |
| GET    | `/api/tv/launch`                  | Launch live TV channel             |

### Torrent

| Method | Path                                  | Description                         |
|--------|---------------------------------------|-------------------------------------|
| GET    | `/api/torrent/dub-available`          | Check nyaa.si for dub releases      |
| GET    | `/api/torrent/dub-available-batch`    | Same, for up to 50 titles           |

### Services

| Method | Path                              | Description                                   |
|--------|-----------------------------------|-----------------------------------------------|
| GET    | `/api/services/directory`         | Ranked streaming sites (everythingmoe.com)    |
| GET    | `/api/services/extract-stream`    | Extract a stream URL from an episode page     |
| GET    | `/api/services/launch`            | Redirect to an external https URL             |

## Adding a New Provider

1. Create `server/src/providers/myprovider.ts` — implement the `Provider` interface:
   ```ts
   export default {
     search, getDetail, getEpisodes, getStream
   } satisfies Provider;
   ```
2. Register it in `server/src/providers/index.ts`:
   ```ts
   import myprovider from "./myprovider.js";
   const registry = { ..., "myprovider": myprovider };
   ```
3. That's it. No changes to routes, frontend, or DB schema.
