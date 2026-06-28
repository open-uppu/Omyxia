# Omyxia API Dockerfile (multi-stage)
FROM node:22-alpine AS builder
WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY prisma/package.json ./prisma/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/api ./apps/api
COPY packages/shared-types ./packages/shared-types
COPY prisma ./prisma
COPY tsconfig.base.json ./

# Generate Prisma client
WORKDIR /app/prisma
RUN pnpm exec prisma generate

# Build
WORKDIR /app
RUN pnpm --filter @omyxia/api build

# ===== Runtime =====
FROM node:22-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN apk add --no-cache wget

# Copy built artifacts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

ENV NODE_ENV=production

WORKDIR /app/apps/api
EXPOSE 3001

CMD ["node", "dist/main.js"]