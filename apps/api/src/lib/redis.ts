import { Redis } from 'ioredis';
import { env } from '@/config/env.js';

export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export const redis = new Redis(redisConnection);
