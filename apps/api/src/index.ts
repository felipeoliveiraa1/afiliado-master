import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { buildServer } from '@/api/server.js';
import { startWorkers } from '@/queue/workers.js';
import { startCron } from '@/cron/index.js';

async function main() {
  logger.info(
    { port: env.PORT, redisHost: env.REDIS_HOST, nodeEnv: env.NODE_ENV },
    'api boot',
  );
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'afiliado-master listening');
  startWorkers();
  startCron();
}

main().catch((err) => {
  logger.error({ err }, 'startup failed');
  process.exit(1);
});
