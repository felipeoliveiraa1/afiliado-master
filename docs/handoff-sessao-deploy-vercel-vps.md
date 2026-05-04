# Contexto da sessão — deploy Vercel + API Docker na VPS

Resumo para outra IA ou dev assumir o histórico de problemas, causas e correções aplicadas no repositório **afiliado-master** (monorepo: `apps/api`, `apps/web`, `packages/types`).

---

## Arquitetura alvo

| Parte | Onde roda | Observação |
|--------|-----------|------------|
| Frontend Next.js | Vercel | Root Directory típico: `apps/web` |
| API Fastify | VPS via Docker | `docker-compose.isolated.yml`: Postgres + Redis + API; host **3047** → container **3000** |
| Tipos | `packages/types` | Workspace Yarn |

---

## Problema 1 — Vercel: build ~40–43 ms, “no files prepared”

### Sintomas

- Log: `Build Completed in /vercel/output [43ms]`, sem `yarn install` / `next build`.
- “Skipping cache upload because no files were prepared”.

### Causas identificadas

1. **`vercel.json` na raiz com `outputDirectory: "apps/web/.next"`**  
   Fazia a Vercel tratar como artefato estático pronto e **pular** o builder do Next.js.

2. **Remoção do `vercel.json` na raiz** com README ainda dizendo “Root vazio”  
   Projeto sem comandos de install/build quando a raiz do Git era a raiz do monorepo.

3. **Monorepo “Skip deployments for unaffected projects”**  
   Com **Root Directory = `apps/web`**, commits que alteram **só `apps/api/`** (e não `apps/web` nem `packages/types`) podem fazer a Vercel **não rodar** o build do front — deploy “vazio” em dezenas de ms.

### Ajustes feitos / recomendações

- Manter **`vercel.json` na raiz** com `installCommand` + `buildCommand`, **sem** `outputDirectory` apontando para `.next`.
- Em **`apps/web/vercel.json`**: `cd ../.. && yarn ...` quando o Root é `apps/web`.
- **`ignoreCommand": "exit 1"`** nos `vercel.json` — evita cancelar pelo *Ignored Build Step* (exit 0 = ignorar build); **não substitui** o skip automático de monorepo.
- No painel: **Root Directory** `apps/web`; **Output Directory vazio**; **Include files outside root** ligado; comando de build/install com **`cd ../..`** se os overrides estiverem no dashboard; desligar **Skip deployments / unaffected** se commits só-API deveriam redeployar o front.
- README atualizado com esse fluxo.

### Variáveis Vercel (erro comum)

Copiar **`.env.local` com `localhost`** para produção **quebra** login e chamadas à API: usar `https://` do front (ex. `*.vercel.app`) e URL **pública** da API quando existir.

---

## Problema 2 — API no Docker: `ERR_MODULE_NOT_FOUND` para `@/config`

### Sintoma

- `Cannot find package '@/config' imported from .../dist/.../index.js`
- Node ESM não resolve alias `@/`; quem deveria reescrever era **`tsc-alias`**.

### Causa

Layout **outDir = `dist`** + **rootDir = `.` com saída `dist/src/...`** e paths `@/*` → `src/*` fazia o **`tsc-alias` falhar** (paths inválidos relativos a `dist/src/api/...`), deixando `@/` no JS compilado.

### Correção

- **`tsconfig` da API**: `rootDir: "src"`, `baseUrl: "./src"`, paths `@/*` → `["./*"]`, saída em **`dist/index.js`** (sem nível extra `dist/src/`).
- **`CMD` / scripts**: `node dist/index.js` e `node dist/worker.js` (não mais `dist/src/...`).

---

## Problema 3 — `curl` na porta 3047: connection refused / reset

### `ECONNREFUSED` / “Couldn't connect”

- Mapeamento **host 3047 → container 3000**; dentro do container a API deve ouvir **`PORT=3000`** (o compose força isso).
- Se `.env` tivesse `PORT=3047` **e** o override do compose não valesse, o processo ouviria a porta errada.

### `Recv failure: Connection reset by peer`

- Processo **aceita e cai** (reinício, crash, OOM).
- **BullMQ**: evento **`error`** em `Worker` / `Queue` **sem** listener → no Node isso pode **encerrar o processo**.  
  **Correção**: registrar `queue.on('error', ...)` **logo após** cada `new Queue`, e `worker.on('error', ...)` **logo após** cada `new Worker`; workers/cron **após** `listen` via `setImmediate`; `unhandledRejection` logado; flag opcional **`API_DISABLE_BACKGROUND=true`** (só HTTP, sem filas/cron).
- **`REDIS_HOST=redis`** no `.env` dentro do Docker (não `localhost`).

---

## Problema 4 — API morre após só `api boot` no log (antes de `listening`)

### Sintoma

- Log JSON com **`api boot`**, sem **`afiliado-master listening`**; `curl` com reset ou falha.

### Causas encontradas

1. **Fastify 5 + `logger: pinoInstance`** → `FST_ERR_LOG_INVALID_LOGGER_CONFIG` (“logger options only accepts a configuration object”).
   - **Correção**: usar **`loggerInstance`** com o Pino custom…

2. Ainda assim, em produção no container, **`loggerInstance`** com o Pino de `lib/logger.js` podia derrubar o processo **durante `buildServer()`** (só uma linha de log e exit).
   - **Correção final**: Fastify com **logger nativo** — em **produção** `{ level: env.LOG_LEVEL }`; em **dev**, `transport: pino-pretty`. Removido **`loggerInstance`** do `server.ts`.
   - **`uncaughtException`** com `console.error` para aparecer no `docker logs` mesmo se o logger Travar.

---

## Commits úteis (ordem aproximada do trabalho)

- Remover `outputDirectory` do `vercel.json` raiz / restaurar raiz sem esse campo; README Vercel.
- **`a47e98b`**: layout `dist` + `tsc-alias` para ESM.
- **`5766041`**: handlers `error` BullMQ em workers + filas (iteração inicial).
- **`41489d1`**: `loggerInstance` no Fastify (etapa intermediária).
- **`d7aa5e7`**: filas com helper `createQueue`; `registerWorkerErrors` imediato; `setImmediate` para background; `API_DISABLE_BACKGROUND`; `unhandledRejection`.
- **`df4d7cf`**: Fastify com Pino integrado em produção; `uncaughtException`.

*(Há também commits de `vercel.json` / `ignoreCommand` e ajustes de Docker/README ao longo da sessão.)*

---

## Comandos de referência (VPS)

```bash
cd /opt/afiliado-master
git pull
docker compose -p afiliado-master -f apps/api/docker-compose.isolated.yml \
  --env-file apps/api/.env up -d --build --force-recreate api
sleep 2
curl -sS http://127.0.0.1:3047/health
docker logs afiliado-master-api-1 --tail 80
```

Debug só HTTP (sem Redis jobs): no `apps/api/.env` → `API_DISABLE_BACKGROUND=true` e recriar o serviço `api`.

---

## Checklist `.env` API (Docker isolado)

- `DATABASE_URL` com host **`postgres`**
- `REDIS_HOST=redis`
- Demais variáveis obrigatórias (`EVOLUTION_*`, `OPENAI_API_KEY`, etc.) conforme `envalid` em `apps/api/src/config/env.ts`
- `WEB_ORIGIN_URL` em produção deve incluir a origem real do front (ex. Vercel), não só `localhost`

---

## Onde está o que

| Item | Caminho |
|------|---------|
| Compose isolado | `apps/api/docker-compose.isolated.yml` |
| Dockerfile API | `apps/api/Dockerfile` |
| Vercel (raiz) | `vercel.json` |
| Vercel (web) | `apps/web/vercel.json` |
| Next monorepo tracing | `apps/web/next.config.mjs` (`outputFileTracingRoot`) |

---

*Gerado para handoff de contexto de sessão; alinhar sempre com o estado atual do `main` no Git.*
