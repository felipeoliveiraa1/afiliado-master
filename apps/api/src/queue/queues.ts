import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis.js';
import { logger } from '@/lib/logger.js';
import type { SourceKind } from '@prisma/client';

export type FetchJob = { sourceKind: SourceKind; limit?: number };
export type CurateJob = { offerId: string; channelKind: 'WHATSAPP_GROUP' | 'TELEGRAM_CHANNEL' };
export type DispatchJob = {
  dispatchId: string;
  bypassWindow?: boolean;
  /** Bypassa o cap diário anti-ban — usado por dispatches manuais ("Enviar Agora") onde a intenção do usuário > defesa anti-ban automática do cron */
  bypassDailyLimit?: boolean;
};
export type ShopeeShortlinkJob = { offerId: string };
export type MercadoLivreShortlinkJob = { offerId: string };

/** Build queue + attach error listener before any async Redis error can fire without a handler. */
function createQueue<DataType, ResultType = any, NameType extends string = string>(
  name: NameType,
): Queue<DataType, ResultType, NameType> {
  const queue = new Queue<DataType, ResultType, NameType>(name, {
    connection: redisConnection,
    // Auto-limpeza de jobs terminados. Sem isso, cada job completado deixa um
    // hash `bull:<queue>:<id>` órfão pra sempre — em jul/2026 o curate-offers
    // acumulou 1M+ chaves (~2GB RSS) e derrubou o Redis por OOM em loop.
    // completed: mantém 1h/1000 últimos (debug recente). failed: 24h/5000
    // (janela maior pra investigar erros).
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 5000 },
    },
  });
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
