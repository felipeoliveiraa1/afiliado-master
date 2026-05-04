# afiliado-master

Captador multi-marketplace + curador IA + dispatcher WhatsApp + dashboard Next.js para grupos de afiliados.

## Stack

- Monorepo com `yarn workspaces` (`apps/api`, `apps/web`, `packages/types`)
- Backend: Node 20 + TypeScript (ESM) + Fastify 5 + Prisma 6 + Postgres + BullMQ + Redis + OpenAI
- Frontend: Next 15 (App Router) + Tailwind + shadcn-style UI + NextAuth credentials + TanStack Query
- Integrações: Evolution API (WhatsApp), Apify (Amazon BR scraping)

## Estrutura

```
apps/
  api/      Fastify + workers + Prisma + cron
  web/      Next 15 App Router (dashboard owner)
packages/
  types/    zod schemas + DTOs compartilhados
```

## Setup

```bash
yarn install

# Backend
cp apps/api/.env.example apps/api/.env
# preencher EVOLUTION_API_URL, EVOLUTION_API_KEY, OPENAI_API_KEY,
# SHOPEE_APP_ID/SECRET (quando aprovado), AMAZON_AFFILIATE_TAG, APIFY_TOKEN,
# MERCADOLIVRE_PANEL_* (depois de descobrir endpoints via HAR)

yarn docker:dev      # postgres + redis
yarn prisma:migrate

# Frontend
cp apps/web/.env.example apps/web/.env.local
# gerar OWNER_PASSWORD_HASH:
node -e "console.log(require('bcryptjs').hashSync('senha-aqui', 10))"
# preencher OWNER_EMAIL, OWNER_PASSWORD_HASH, NEXTAUTH_SECRET (qualquer string aleatória)

yarn dev:api    # backend (3000)
yarn dev:web    # dashboard (3001)
```

## Marketplaces — estado de cada um

| Marketplace      | Captação                              | Conversão URL → afiliado                        |
| ---------------- | ------------------------------------- | ----------------------------------------------- |
| **Amazon BR**    | Apify (`junglee/amazon-bestsellers`)  | Auto via `?tag=`                                |
| **Shopee BR**    | Open API (aprovação ~3 dias)          | Open API ou cookie do painel (fallback)         |
| **Mercado Livre**| API pública + busca por categoria via painel | Cookie do painel logado em `afiliados-home` |
| **Promobit**     | HTML SSR (descoberta de oportunidades)| Resolve para amazon/shopee/ML por trás          |

### Cookie do painel (Shopee + Mercado Livre)

Ambos seguem o mesmo padrão de "cookie hijacking" usado por ferramentas como Divulga Links. Riscos e mitigações descritos em [`apps/api/src/sources/shopee_panel.ts`](apps/api/src/sources/shopee_panel.ts) e [`apps/api/src/sources/mercadolivre_panel.ts`](apps/api/src/sources/mercadolivre_panel.ts).

Para descobrir os endpoints internos:

1. Abra o painel logado (`affiliate.shopee.com.br` ou `mercadolivre.com.br/afiliados-home`).
2. F12 → Network → faça uma ação (gerar shortlink, validar conta, buscar produtos).
3. Copie a URL e o método. Cole em `MERCADOLIVRE_PANEL_GENERATE_ENDPOINT`/`SEARCH_ENDPOINT`/`VALIDATE_ENDPOINT` (ou Shopee equivalente).
4. Cole o cookie completo em `MERCADOLIVRE_PANEL_COOKIE` ou `SHOPEE_PANEL_COOKIE`.
5. Habilite com `*_AUTO_ENABLED=true`.
6. Use a tela `/sources/{shopee,mercadolivre}/cookie` no dashboard para validar.

Defaults conservadores aplicados em ambos: 25-30/dia, jitter 45-180s, janela 8-22h, cooldown 6h em 401/403.

## Dashboard (apps/web)

Telas:

- `/login` — credentials NextAuth single-user
- `/dashboard` — KPIs do dia + saúde dos cookies
- `/offers` — datatable filtrável + edição inline de affiliateUrl
- `/offers/pending` — fila manual (Shopee/ML que ainda precisa de link)
- `/sources/{SHOPEE,AMAZON,MERCADOLIVRE,PROMOBIT}` — config + run-now
- `/sources/{shopee,mercadolivre}/cookie` — cole cookie + validação live
- `/sources/mercadolivre/search` — busca por categoria/subcategoria + "mais vendidos" (paridade Divulga Links)
- `/channels` — cadastra grupos WhatsApp via Evolution API
- `/campaigns` + `/campaigns/[id]` — CRUD de campanhas com filtros e timeline de dispatches
- `/dispatches` — histórico filtrável por status

## Endpoints (apps/api)

- `GET /health`
- `GET /evolution/instances|groups`
- `POST /sources/:kind/fetch` — kind ∈ SHOPEE, AMAZON, MERCADOLIVRE, PROMOBIT
- `POST /sources/{SHOPEE,MERCADOLIVRE}/validate-cookie`
- `POST /sources/MERCADOLIVRE/search-by-category` — `{ categoryId, subCategoryId?, bestSellersOnly?, autoImport? }`
- `POST /offers/import` — import manual (cole `affiliateUrl` pronto)
- `GET /offers?take=20&minScore=0.5&source=SHOPEE`
- `GET /offers/pending-affiliate-link?source=SHOPEE`
- `PATCH /offers/:id`
- `POST|GET /channels`
- `POST|GET /campaigns`, `GET /campaigns/:id`, `POST /campaigns/:id/run-now`
- `GET /campaigns/:id/dispatches?take=&status=`
- `GET /admin/cookie-health`, `GET /stats/today`
- `GET /r/:dispatchId` (público) — wrapper de click tracking, opt-in via `CLICK_TRACKING_ENABLED`

## Workers (BullMQ)

- `fetch-offers` — captação por SourceKind, salva no banco e enfileira curadoria + auto-shortlink
- `curate-offers` — OpenAI gera caption por canal
- `dispatch` — envia para WhatsApp respeitando janela horária + daily limit
- `shopee-shortlink` / `mercadolivre-shortlink` — converte URL → afiliado via cookie do painel

## Cron

- `*/30 * * * *` — fetch de todas as Sources ativas
- `0 7 * * *` — health check dos cookies, alerta no `ADMIN_ALERT_GROUP_ID` se expirado

## Tests

```bash
yarn test    # vitest no backend (sources/score/dispatcher)
```

## Deploy

Frontend e backend são desacoplados — ideal pra rodar dashboard na Vercel e a API + workers + Postgres + Redis numa VPS.

### Backend (VPS, via Docker Compose)

```bash
# Na VPS, com Docker e Docker Compose já instalados:
git clone https://github.com/<você>/afiliado-master.git
cd afiliado-master

cp apps/api/.env.example apps/api/.env
# Edite apps/api/.env preenchendo:
#   DATABASE_URL=postgresql://afiliado:<senha>@postgres:5432/afiliado_master?schema=public
#   REDIS_HOST=redis
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   EVOLUTION_API_*, OPENAI_*, APIFY_TOKEN, AMAZON_AFFILIATE_TAG, ...
#   PUBLIC_BASE_URL=https://api.seu-dominio.com.br
#   WEB_ORIGIN_URL=https://seu-app.vercel.app,https://dashboard.seu-dominio.com.br

# Sobe Postgres + Redis + API + worker
docker compose -f apps/api/docker-compose.prod.yml --env-file apps/api/.env up -d --build

# Roda migrations (uma vez por deploy de schema)
docker compose -f apps/api/docker-compose.prod.yml --env-file apps/api/.env --profile migrate run --rm migrate
```

A API expõe `127.0.0.1:3000` por padrão (não publica na internet diretamente). Coloque um reverse proxy (Caddy/Nginx/Traefik) terminando TLS:

```caddyfile
api.seu-dominio.com.br {
  reverse_proxy 127.0.0.1:3000
}
```

Click tracking (`/r/:dispatchId`) deve apontar pro mesmo domínio configurado em `PUBLIC_BASE_URL`.

### Frontend (Vercel)

1. **Vercel > New Project** → importa este repo.
2. **Root Directory** (recomendado: `apps/web`): assim o Next.js, o `next.config.mjs` e a pasta `.next` ficam alinhados com o builder da Vercel. Nesse modo vale o `apps/web/vercel.json`. Ative **Include files outside the root directory in the Build Step** (ou equivalente) para o workspace Yarn enxergar `packages/*`. Deixe **Output Directory** vazio no painel. Framework Preset: **Next.js**. Se algo pular o build (log ~40 ms, sem `yarn`/`next build`), confira overrides de Build/Output no painel e desligue **Skip deployment** para esse app enquanto depura. Se a raiz do projeto na Vercel for a raiz do repositório (sem subdirectory), aí vale o `vercel.json` na raiz (`installCommand` / `buildCommand`; **não** use `outputDirectory` apontando para `.next`).
3. **Environment Variables**:

   | Nome | Valor |
   |------|-------|
   | `NEXTAUTH_URL` | `https://seu-app.vercel.app` (ou domínio custom) |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
   | `OWNER_EMAIL` | seu email de login |
   | `OWNER_PASSWORD_HASH_B64` | bcrypt → base64 (ver `apps/web/.env.example`) |
   | `API_BASE_URL` | `https://api.seu-dominio.com.br` |
   | `NEXT_PUBLIC_API_BASE_URL` | `https://api.seu-dominio.com.br` |

4. Deploy. A primeira build instala o monorepo via `yarn install` (Vercel detecta workspaces).
5. Volte ao backend: garanta que `WEB_ORIGIN_URL` no `apps/api/.env` inclui o domínio Vercel exato. Reinicie a API (`docker compose ... up -d`).

### Atualizando

```bash
# Backend (VPS)
git pull
docker compose -f apps/api/docker-compose.prod.yml --env-file apps/api/.env up -d --build
docker compose -f apps/api/docker-compose.prod.yml --env-file apps/api/.env --profile migrate run --rm migrate

# Frontend (Vercel)
git push    # Vercel rebuilda sozinho via git integration
```
