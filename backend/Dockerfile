# ---- Stage 1: Install dependencies ----
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts=false

# ---- Stage 2: Build TypeScript ----
FROM node:20-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Stage 3: Production image ----
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts=false

COPY --from=build /app/dist ./dist

# Drizzle migrations are compiled into dist/db/migrations by tsc,
# but drizzle-kit at runtime needs the raw SQL files + meta journal.
COPY src/db/migrations ./src/db/migrations

# Drizzle config is needed if running migrations at startup
COPY drizzle.config.ts ./

# Create storage directory (can be overridden with a volume mount)
RUN mkdir -p /app/storage

# Cloud Run injects PORT; default to 3002 for local use
ENV PORT=3002
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
