# Build stage has compilers because better-sqlite3 falls back to node-gyp
# when no prebuilt binary matches.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
# UV_THREADPOOL_SIZE: every outbound request resolves DNS on libuv's pool (default 4 threads).
# A dead scraper domain takes ~4 s per failed lookup, which starved AniList/TVMaze lookups.
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=16 \
    PORT=3002 \
    DB_PATH=/data/kuro.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
