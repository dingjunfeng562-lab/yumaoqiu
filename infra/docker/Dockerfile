# syntax=docker/dockerfile:1.7
# Multi-target build for the yumaoqiu monorepo.
#   target "backend"  -> NestJS API  (node dist/main.js)
#   target "frontend" -> Next.js app (next start)
#
# Note on dependencies: `pnpm prune --prod` is NOT usable here - run at the
# workspace root it prunes every child package's dependencies (root package.json
# declares none), so @prisma/client disappeared and the app would not start.
# pnpm's symlinked node_modules is compact enough as-is (~370MB images).
ARG NODE_VERSION=24-bookworm-slim

# ---------------------------------------------------------------- base
FROM node:${NODE_VERSION} AS base
ENV PNPM_VERSION=10.15.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION} \
 && pnpm --version
WORKDIR /app

# Manifests first so the dependency layer is cached independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile

COPY . .

# Prisma 7 + driver adapters: generate the client before TypeScript compiles.
RUN pnpm --filter backend exec prisma generate
# Cheap guard: the generated client must resolve from the consuming package.
RUN cd /app/apps/backend && node -e "require('@prisma/client'); console.log('prisma client ok')"

# ---------------------------------------------------------------- backend build
FROM base AS backend-build
# Force a clean compile: a stale tsbuildinfo makes tsc emit .d.ts without .js.
RUN rm -rf /app/apps/backend/dist /app/apps/backend/tsconfig.build.tsbuildinfo
RUN pnpm --filter backend build
RUN test -f /app/apps/backend/dist/main.js && echo "backend dist ok"
RUN test -f /app/apps/backend/dist/auth/dto/change-password.dto.js \
 && echo "clean-compile check ok" \
 || (echo "MISSING compiled js - incremental build leaked in" && exit 1)

# ---------------------------------------------------------------- backend runtime
FROM node:${NODE_VERSION} AS backend
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=base /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=base /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=backend-build /app/apps/backend/dist ./apps/backend/dist
WORKDIR /app/apps/backend
# The service resolves uploads via process.cwd(), so this is the mount point.
RUN mkdir -p uploads
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'4000')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------- frontend build
FROM base AS frontend-build
# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time.
ARG NEXT_PUBLIC_API_URL=https://ydysyumao.cn/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NODE_OPTIONS=--max-old-space-size=1792
RUN pnpm --filter frontend build \
 && rm -rf /app/apps/frontend/.next/cache

# ---------------------------------------------------------------- frontend runtime
FROM node:${NODE_VERSION} AS frontend
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=base /app/apps/frontend/package.json ./apps/frontend/package.json
COPY --from=frontend-build /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=frontend-build /app/apps/frontend/public ./apps/frontend/public
COPY --from=frontend-build /app/apps/frontend/next.config.ts ./apps/frontend/next.config.ts
WORKDIR /app/apps/frontend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
