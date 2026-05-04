import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis.js';
import { logger } from '@/lib/logger.js';
import type { SourceKind } from '@prisma/client';

export type FetchJob = { sourceKind: SourceKind; limit?: number };
export type CurateJob = { offerId: string; channelKind: 'WHATSAPP_GROUP' | 'TELEGRAM_CHANNEL' };
export type DispatchJob = { dispatchId: string };
export type ShopeeShortlinkJob = { offerId: string };
export type MercadoLivreShortlinkJob = { offerId: string };

/** Build queue + attach error listener before any async Redis error can fire without a handler. */
function createQueue<DataType, ResultType = any, NameType extends string = string>(
  name: NameType,
): Queue<DataType, ResultType, NameType> {
  const queue = new Queue<DataType, ResultType, NameType>(name, { connection: redisConnection });
  queue.on('error', (err: Error) => {
    logger.error({ err, queueName: name }, 'bullmq queue error');
  });
  return queue;
}

export const fetchQueue = createQueue<FetchJob>('fetch-offers');
export const curateQueue = createQueue<CurateJob>('curate-offers');
export const dispatchQueue = createQueue<DispatchJob>('dispatch');
export const shopeeShortlinkQueue = createQueue<ShopeeShortlinkJob>('shopee-shortlink');
export const mercadoLivreShortlinkQueue = createQueue<MercadoLivreShortlinkJob>(
  'mercadolivre-shortlink',
);
