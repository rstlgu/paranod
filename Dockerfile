FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# Pin pnpm to avoid corepack/version issues in CI/Portainer
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN HUSKY=0 pnpm install --frozen-lockfile

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
RUN pnpm prisma generate

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_ADDON_STORE_URL
ENV NEXT_PUBLIC_ADDON_STORE_URL=$NEXT_PUBLIC_ADDON_STORE_URL

RUN pnpm prisma generate
RUN node scripts/build-agent-worker.mjs
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docker/agent-entrypoint.sh ./docker/agent-entrypoint.sh
COPY --from=builder /app/docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=builder /app/docker/maintenance.mjs ./docker/maintenance.mjs

RUN chmod +x ./docker/entrypoint.sh ./docker/agent-entrypoint.sh

EXPOSE 3000
CMD ["./docker/entrypoint.sh"]
