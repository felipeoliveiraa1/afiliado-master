import { logger } from '@/lib/logger.js';
import { startWorkers } from '@/queue/workers.js';
import { startCron } from '@/cron/index.js';

startWorkers();
startCron();
logger.info('afiliado-master worker up');
