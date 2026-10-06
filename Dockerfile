# syntax=docker/dockerfile:1

# Un Dockerfile, deux images :
#
#   --target api   Node seul + le bundle de l'API (aucun node_modules)
#   --target web   nginx servant l'interface et relayant /api vers l'API
#
# Construit tel quel sur le serveur ARM64 comme sur un poste x86 : aucune
# étape ne dépend de l'architecture.

ARG NODE_IMAGE=node:24-alpine

# --------------------------------------------------------------------------- #
#  Construction                                                               #
# --------------------------------------------------------------------------- #
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm dans la version fixée par `packageManager`
RUN corepack enable

# Manifestes seuls d'abord : l'installation reste en cache tant que les
# dépendances ne changent pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=sport-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY . .
RUN pnpm --filter @sport/api build && pnpm --filter @sport/web build

# --------------------------------------------------------------------------- #
#  API                                                                        #
# --------------------------------------------------------------------------- #
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    AUTH_MODE=forward-auth \
    DB_AUTO_MIGRATE=true \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]

# --------------------------------------------------------------------------- #
#  Interface                                                                  #
# --------------------------------------------------------------------------- #
FROM nginx:stable-alpine AS web
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
