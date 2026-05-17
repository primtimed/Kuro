# Project Instructions

## Commands

```bash
# Dev (runs server + client concurrently)
npm run dev

# Server only
npm run dev --prefix server

# Client only
npm run dev --prefix client

# Build
npm run build

# Install all deps
npm run install:all

# Type check (server)
cd server && npx tsc --noEmit
```

## Architecture

Monorepo: `server/` (Express 5 + TypeScript, port 3002) and `client/` (React 19 + Vite + Tailwind 4).
`server/src/db/schema.ts` holds raw SQL schema — `better-sqlite3`, no ORM or migration tool.
`client/src/lib/procedural.ts` generates procedural SVG art for missing anime covers (Kuro design system).

## Don'ts

- Don't add an ORM — raw SQL is intentional.
- Don't hardcode CSS values — use Kuro CSS vars.
