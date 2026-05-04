# syntax=docker/dockerfile:1.7
#
# Build context: REPO ROOT (use `docker build -f apps/api/Dockerfile .` na raiz).
# Multi-stage; a mesma imagem serve API e worker — controlado por CMD ou
# `docker compose ... command:` (ver docker-compose.prod.yml).

FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json yarn.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN yarn install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json yarn.lock ./
COPY apps/web/package.json apps/web/package.json
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/types/node_modules ./packages/types/node_modules
COPY packages/types ./packages/types
COPY apps/api ./apps/api
RUN yarn workspace @afiliado-master/api prisma:gen
RUN yarn workspace @afiliado-master/api build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl tini curl && \
    addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo/node_modules ./node_modules
COPY --from=builder --chown=app:app /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=app:app /repo/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=app:app /repo/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=app:app /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=app:app /repo/packages/types ./packages/types
COPY --from=builder --chown=app:app /repo/package.json ./package.json
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -sf http://127.0.0.1:3000/health > /dev/null || exit 1
USER app
WORKDIR /app/apps/api
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
