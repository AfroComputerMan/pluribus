# Dockerfile - Production build
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS builder
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production image
FROM base AS runner
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 pluribus
USER pluribus

COPY --from=deps --chown=pluribus:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=pluribus:nodejs /app/dist ./dist
COPY --from=builder --chown=pluribus:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=pluribus:nodejs /app/package.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]
