# Omyxia Web Dockerfile (multi-stage)
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
COPY packages/shared-types ./packages/shared-types

WORKDIR /app
RUN pnpm --filter @omyxia/web build

# ===== Runtime =====
FROM node:22-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN apk add --no-cache wget

COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/next.config.js ./apps/web/next.config.js
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["pnpm", "start"]