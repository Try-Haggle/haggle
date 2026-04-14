# ── Haggle API — Production Dockerfile ──
# Multi-stage build for minimal image size
# Deploy on Railway, Fly.io, or any Docker host

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install dependencies ──
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/engine-core/package.json packages/engine-core/
COPY packages/engine-session/package.json packages/engine-session/
COPY packages/payment-core/package.json packages/payment-core/
COPY packages/trust-core/package.json packages/trust-core/
COPY packages/dispute-core/package.json packages/dispute-core/
COPY packages/arp-core/package.json packages/arp-core/
COPY packages/tag-core/package.json packages/tag-core/
COPY packages/shipping-core/package.json packages/shipping-core/
COPY packages/skill-legit/package.json packages/skill-legit/
COPY packages/commerce-core/package.json packages/commerce-core/
RUN pnpm install --frozen-lockfile --prod=false

# ── Build ──
FROM deps AS build
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @haggle/shared build && \
    pnpm --filter @haggle/db build && \
    pnpm --filter @haggle/engine-core build && \
    pnpm --filter @haggle/engine-session build && \
    pnpm --filter @haggle/trust-core build && \
    pnpm --filter @haggle/dispute-core build && \
    pnpm --filter @haggle/arp-core build && \
    pnpm --filter @haggle/tag-core build && \
    pnpm --filter @haggle/shipping-core build && \
    pnpm --filter @haggle/skill-legit build && \
    pnpm --filter @haggle/payment-core build && \
    pnpm --filter @haggle/commerce-core build && \
    pnpm --filter @haggle/api build

# ── Production image ──
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Copy built artifacts + production deps
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
