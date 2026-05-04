import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { buildServer } from '@/api/server.js';
import { startWorkers } from '@/queue/workers.js';
import { startCron } from '@/cron/index.js';

async function main() {
  const app = await buildServer();
  startWorkers();
  startCron();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'afiliado-master up');
}

main().catch((err) => {
  logger.error({ err }, 'startup failed');
  process.exit(1);
});
