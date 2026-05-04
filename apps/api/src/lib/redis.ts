import { env } from '@/config/env.js';

/** BullMQ connection options; each queue/worker opens its own client from this config. */
export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};
