# StreamVault

A local media streaming app — anime, movies, series, YouTube, Twitch — built Netflix/Crunchyroll-style.

## Stack

| Layer    | Tech                                       |
|----------|--------------------------------------------|
| Frontend | React 19 + Vite + TypeScript + Tailwind v4 |
| Backend  | Node + Express 5 + TypeScript              |
| Database | SQLite (better-sqlite3)                    |
| Player   | HLS.js + Plyr                              |
| APIs     | Jikan, AniList (GraphQL), Consumet         |

## Quick Start

```bash
# 1 — install all deps (run from repo root)
npm run install:all

# 2 — copy and edit env
cp .env .env.local   # optional, .env works out of the box

# 3 — start dev servers (server :3001, client :5173)
npm run dev
```

Open **http://localhost:5173** (API server runs on :3002)

## Environment Variables

| Variable           | Default                      | Description                        |
|--------------------|------------------------------|------------------------------------|
| `PORT`             | `3002`                       | Express server port                |
| `CLIENT_URL`       | `http://localhost:5173`      | CORS allowed origin                |
| `CONSUMET_BASE_URL`| `https://api.consumet.org`   | Consumet API base (self-host recommended) |

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

## Folder Structure

```
Anime/
├── server/src/
│   ├── providers/     jikan.ts · anilist.ts · consumet.ts · index.ts
│   ├── routes/        media.ts · library.ts · stream.ts
│   ├── db/            schema.ts · client.ts
│   ├── cache/         index.ts (in-memory + TTL)
│   ├── types/         media.ts
│   └── server.ts
└── client/src/
    ├── components/    Card · Row · Hero · Player · CastCard · EpisodeList · Navbar
    ├── pages/         Home · Detail · Search · Library · Watch
    ├── hooks/         useMedia · useProgress
    ├── lib/           api.ts · types.ts · utils.ts
    ├── App.tsx
    └── main.tsx
```

## Adding a New Provider (e.g. YouTube)

1. Create `server/src/providers/youtube.ts` — implement the `Provider` interface:
   ```ts
   export default {
     search, getDetail, getEpisodes, getStream
   } satisfies Provider;
   ```
2. Register it in `server/src/providers/index.ts`:
   ```ts
   import youtube from "./youtube.js";
   const registry = { ..., "youtube": youtube };
   ```
3. That's it. No changes to routes, frontend, or DB schema.

## API Routes

| Method | Path                                | Description                              |
|--------|-------------------------------------|------------------------------------------|
| GET    | `/api/health`                       | Health check                             |
| GET    | `/api/media/trending?type=anime`    | Trending (AniList + Jikan merged)        |
| GET    | `/api/media/seasonal?type=anime`    | Current season                           |
| GET    | `/api/media/search?q=...`           | Search                                   |
| GET    | `/api/media/:id`                    | Full media detail (`anilist:12345`)      |
| GET    | `/api/media/:id/episodes`           | Episode list                             |
| GET    | `/api/media/:id/stream?episode=1`   | Stream URL via Consumet                  |
| GET    | `/api/library/favorites`            | Get favorites                            |
| POST   | `/api/library/favorites`            | Add to favorites                         |
| DELETE | `/api/library/favorites/:id`        | Remove from favorites                    |
| GET    | `/api/library/history`              | Watch history                            |
| POST   | `/api/library/progress`             | Save watch progress                      |
