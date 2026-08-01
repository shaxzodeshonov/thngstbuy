# syntax=docker/dockerfile:1
#
# Self-hosting image. Uses the built-in node:sqlite file adapter, so it needs a
# volume at /data. Vercel does not use this file - it runs api/index.js and
# talks to Turso instead.

# ---- build the client -------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# npm 11 defers install scripts behind an approval prompt that cannot be
# answered in a container, so esbuild's platform binary is fetched explicitly.
RUN npm ci && npm rebuild esbuild

COPY . .
RUN npm run build

# ---- run --------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only the server's own dependencies; nothing from the build toolchain.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server

# The database lives on a mounted volume, not in the image layer - a redeploy
# replaces the container and everything outside /data goes with it.
ENV PORT=8080 DB_FILE=/data/thngstbuy.db
RUN mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
