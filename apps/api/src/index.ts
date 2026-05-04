import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { buildServer } from '@/api/server.js';
import { startWorkers } from '@/queue/workers.js';
import { startCron } from '@/cron/index.js';

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'unhandledRejection');
});

process.on('uncaughtException', (err: Error) => {
  console.error('uncaughtException', err);
  logger.error({ err }, 'uncaughtException');
  process.exit(1);
});

async function main() {
  logger.info(
    { port: env.PORT, redisHost: env.REDIS_HOST, nodeEnv: env.NODE_ENV },
    'api boot',
  );
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'afiliado-master listening');
  setImmediate(() => {
    if (env.API_DISABLE_BACKGROUND) {
      logger.warn('API_DISABLE_BACKGROUND=true: workers and cron are not running');
      return;
    }
    try {
      startWorkers();
      startCron();
    } catch (err) {
      logger.error({ err }, 'failed to start workers or cron');
    }
  });
}

main().catch((err) => {
  logger.error({ err }, 'startup failed');
  process.exit(1);
});
