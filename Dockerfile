# Global News Intelligence — web service image (Koyeb / Cloud Run / any container host).
#
# The ingestion worker does NOT run here: on the free-forever stack the web
# service only serves, and ingestion happens via GitHub Actions running
# `npm run worker:once` (see docs/DEPLOY-KOYEB-NEON.md). Set
# RUN_WORKER_IN_WEB=false accordingly.
#
# Build:  docker build -t gni-web .
# Run:    docker run -p 3000:3000 --env-file .env gni-web

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies are needed for `npm run build` (tsc) below.
RUN npm ci --include=dev

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime needs only production dependencies (express, pg, pglite, zod, qrcode).
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# healthcheck hits the same endpoint Koyeb uses (/api/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000
CMD ["npm", "start"]
