import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis.js';
import type { SourceKind } from '@prisma/client';

export type FetchJob = { sourceKind: SourceKind; limit?: number };
export type CurateJob = { offerId: string; channelKind: 'WHATSAPP_GROUP' | 'TELEGRAM_CHANNEL' };
export type DispatchJob = { dispatchId: string };
export type ShopeeShortlinkJob = { offerId: string };
export type MercadoLivreShortlinkJob = { offerId: string };

export const fetchQueue = new Queue<FetchJob>('fetch-offers', { connection: redisConnection });
export const curateQueue = new Queue<CurateJob>('curate-offers', { connection: redisConnection });
export const dispatchQueue = new Queue<DispatchJob>('dispatch', { connection: redisConnection });
export const shopeeShortlinkQueue = new Queue<ShopeeShortlinkJob>('shopee-shortlink', {
  connection: redisConnection,
});
export const mercadoLivreShortlinkQueue = new Queue<MercadoLivreShortlinkJob>(
  'mercadolivre-shortlink',
  { connection: redisConnection },
);
