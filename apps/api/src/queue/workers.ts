import { Worker } from 'bullmq';
import { redisConnection } from '@/lib/redis.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';
import { sourceRegistry } from '@/sources/index.js';
import { describeOffer } from '@/curator/describe.js';
import { scoreOffer } from '@/curator/score.js';
import { env } from '@/config/env.js';
import { generateShopeeShortlink, ShopeePanelError } from '@/sources/shopee_panel.js';
import {
  generateMercadoLivreShortlink,
  MercadoLivrePanelError,
} from '@/sources/mercadolivre_panel.js';
import { executeWhatsappDispatch } from '@/dispatcher/whatsapp.js';
import {
  curateQueue,
  dispatchQueue,
  mercadoLivreShortlinkQueue,
  shopeeShortlinkQueue,
  type CurateJob,
  type DispatchJob,
  type FetchJob,
  type MercadoLivreShortlinkJob,
  type ShopeeShortlinkJob,
} from './queues.js';

const jitter = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min) * 1000;

const registerWorkerErrors = (w: Worker, name: string): void => {
  w.on('error', (err: Error) => {
    logger.error({ err, worker: name }, 'bullmq worker error');
  });
};

export function startWorkers() {
  const fetchWorker = new Worker<FetchJob>(
    'fetch-offers',
    async (job) => {
      const adapter = sourceRegistry[job.data.sourceKind];
      if (!adapter) throw new Error(`No adapter for ${job.data.sourceKind}`);
      const source = await prisma.source.upsert({
        where: { kind: job.data.sourceKind },
        update: {},
        create: { kind: job.data.sourceKind },
      });
      const raws = await adapter.fetch({ limit: job.data.limit ?? 30 });
      let inserted = 0;
      for (const r of raws) {
        const offer = await prisma.offer.upsert({
          where: { sourceId_externalId: { sourceId: source.id, externalId: r.externalId } },
          create: {
            sourceId: source.id,
            externalId: r.externalId,
            title: r.title,
            description: r.description,
            imageUrl: r.imageUrl,
            price: r.price,
            originalPrice: r.originalPrice,
            discountPct: r.discountPct,
            category: r.category,
            url: r.url,
            affiliateUrl: r.affiliateUrl,
            commissionPct: r.commissionPct,
            rating: r.rating,
            ratingCount: r.ratingCount,
            salesCount: r.salesCount,
            score: scoreOffer({
              discountPct: r.discountPct ?? null,
              rating: r.rating ?? null,
              ratingCount: r.ratingCount ?? null,
              salesCount: r.salesCount ?? null,
              commissionPct: r.commissionPct ?? null,
            }),
            raw: (r.raw ?? {}) as object,
          },
          update: {
            title: r.title,
            price: r.price,
            originalPrice: r.originalPrice,
            discountPct: r.discountPct,
            score: scoreOffer({
              discountPct: r.discountPct ?? null,
              rating: r.rating ?? null,
              ratingCount: r.ratingCount ?? null,
              salesCount: r.salesCount ?? null,
              commissionPct: r.commissionPct ?? null,
            }),
            raw: (r.raw ?? {}) as object,
            fetchedAt: new Date(),
          },
        });
        inserted++;
        // Enfileira curadoria pra WhatsApp por padrão
        await curateQueue.add('curate', { offerId: offer.id, channelKind: 'WHATSAPP_GROUP' });

        const isShopeeNeedingLink =
          (job.data.sourceKind === 'PROMOBIT' || job.data.sourceKind === 'SHOPEE') &&
          !offer.affiliateUrl &&
          /shopee\.com\.br/.test(offer.url) &&
          env.SHOPEE_PANEL_AUTO_ENABLED;
        if (isShopeeNeedingLink) {
          await shopeeShortlinkQueue.add(
            'shopee-shortlink',
            { offerId: offer.id },
            { delay: jitter(env.SHOPEE_PANEL_MIN_INTERVAL_SEC, env.SHOPEE_PANEL_MAX_INTERVAL_SEC) },
          );
        }

        const isMercadoLivreNeedingLink =
          (job.data.sourceKind === 'PROMOBIT' || job.data.sourceKind === 'MERCADOLIVRE') &&
          !offer.affiliateUrl &&
          /mercadolivre\.com(?:\.br)?/.test(offer.url) &&
          env.MERCADOLIVRE_PANEL_AUTO_ENABLED;
        if (isMercadoLivreNeedingLink) {
          await mercadoLivreShortlinkQueue.add(
            'mercadolivre-shortlink',
            { offerId: offer.id },
            {
              delay: jitter(
                env.MERCADOLIVRE_PANEL_MIN_INTERVAL_SEC,
                env.MERCADOLIVRE_PANEL_MAX_INTERVAL_SEC,
              ),
            },
          );
        }
      }
      await prisma.source.update({
        where: { id: source.id },
        data: { lastFetchAt: new Date() },
      });
      logger.info({ source: job.data.sourceKind, inserted }, 'fetch done');
    },
    { connection: redisConnection, concurrency: 2 },
  );
  registerWorkerErrors(fetchWorker, 'fetch-offers');

  const curateWorker = new Worker<CurateJob>(
    'curate-offers',
    async (job) => {
      const offer = await prisma.offer.findUnique({ where: { id: job.data.offerId } });
      if (!offer) return;
      await describeOffer(offer.id, {
        title: offer.title,
        price: Number(offer.price),
        originalPrice: offer.originalPrice ? Number(offer.originalPrice) : undefined,
        discountPct: offer.discountPct ?? undefined,
        category: offer.category ?? undefined,
      }, job.data.channelKind);
    },
    { connection: redisConnection, concurrency: 5 },
  );
  registerWorkerErrors(curateWorker, 'curate-offers');

  const dispatchWorker = new Worker<DispatchJob>(
    'dispatch',
    async (job) => {
      const dispatch = await prisma.dispatch.findUnique({
        where: { id: job.data.dispatchId },
        include: { channel: true },
      });
      if (!dispatch) return;
      if (dispatch.channel.kind !== 'WHATSAPP_GROUP') {
        throw new Error('TELEGRAM dispatcher ainda não implementado');
      }
      const result = await executeWhatsappDispatch(job.data.dispatchId);
      if (result.kind === 'RESCHEDULED') {
        await dispatchQueue.add(
          'dispatch',
          { dispatchId: result.dispatchId },
          { delay: result.runAt.getTime() - Date.now() },
        );
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: { max: 1, duration: 1000 },
    },
  );
  registerWorkerErrors(dispatchWorker, 'dispatch');

  // Worker dedicado pra gerar shortlink Shopee via painel (cookie hijacking)
  // Concurrency 1 + rate limit explícito pra parecer humano
  const shopeeShortlinkWorker = new Worker<ShopeeShortlinkJob>(
    'shopee-shortlink',
    async (job) => {
      const offer = await prisma.offer.findUnique({ where: { id: job.data.offerId } });
      if (!offer || offer.affiliateUrl) return;

      // Janela horária — não rodar de madrugada (parece bot)
      const hour = new Date().getHours();
      if (hour < env.DISPATCH_WINDOW_START || hour >= env.DISPATCH_WINDOW_END) {
        const next = new Date();
        next.setHours(env.DISPATCH_WINDOW_START, Math.floor(Math.random() * 30), 0, 0);
        if (next.getTime() < Date.now()) next.setDate(next.getDate() + 1);
        await shopeeShortlinkQueue.add(
          'shopee-shortlink',
          { offerId: offer.id },
          { delay: next.getTime() - Date.now() },
        );
        return;
      }

      // Limite diário — controlado via Source.config
      const source = await prisma.source.upsert({
        where: { kind: 'SHOPEE' },
        update: {},
        create: { kind: 'SHOPEE' },
      });
      const cfg = (source.config as { panelDaily?: { date: string; count: number } }) ?? {};
      const today = new Date().toISOString().slice(0, 10);
      const daily = cfg.panelDaily && cfg.panelDaily.date === today ? cfg.panelDaily : { date: today, count: 0 };
      if (daily.count >= env.SHOPEE_PANEL_DAILY_LIMIT) {
        logger.warn({ offerId: offer.id, count: daily.count }, 'shopee panel daily limit reached');
        // Re-agenda pra amanhã na janela
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(env.DISPATCH_WINDOW_START, Math.floor(Math.random() * 60), 0, 0);
        await shopeeShortlinkQueue.add(
          'shopee-shortlink',
          { offerId: offer.id },
          { delay: tomorrow.getTime() - Date.now() },
        );
        return;
      }

      try {
        const shortlink = await generateShopeeShortlink(offer.url);
        await prisma.offer.update({
          where: { id: offer.id },
          data: { affiliateUrl: shortlink },
        });
        await prisma.source.update({
          where: { id: source.id },
          data: { config: { ...cfg, panelDaily: { date: today, count: daily.count + 1 } } as object },
        });
        logger.info({ offerId: offer.id, shortlink, dailyCount: daily.count + 1 }, 'shopee shortlink generated');
      } catch (err) {
        if (err instanceof ShopeePanelError) {
          logger.error({ kind: err.kind, msg: err.message, offerId: offer.id }, 'shopee panel failed');
          if (err.kind === 'auth') {
            // Cookie expirou — não retentar essa offer agora; admin precisa re-colar cookie
            return;
          }
          if (err.kind === 'rate') {
            // Re-agenda com delay maior
            await shopeeShortlinkQueue.add(
              'shopee-shortlink',
              { offerId: offer.id },
              { delay: 90 * 60 * 1000 },
            );
            return;
          }
        }
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Rate limit defensivo: max 1 job a cada 30s mesmo com fila grande
      limiter: { max: 1, duration: 30_000 },
    },
  );
  registerWorkerErrors(shopeeShortlinkWorker, 'shopee-shortlink');

  const mercadoLivreShortlinkWorker = new Worker<MercadoLivreShortlinkJob>(
    'mercadolivre-shortlink',
    async (job) => {
      const offer = await prisma.offer.findUnique({ where: { id: job.data.offerId } });
      if (!offer || offer.affiliateUrl) return;

      const hour = new Date().getHours();
      if (hour < env.DISPATCH_WINDOW_START || hour >= env.DISPATCH_WINDOW_END) {
        const next = new Date();
        next.setHours(env.DISPATCH_WINDOW_START, Math.floor(Math.random() * 30), 0, 0);
        if (next.getTime() < Date.now()) next.setDate(next.getDate() + 1);
        await mercadoLivreShortlinkQueue.add(
          'mercadolivre-shortlink',
          { offerId: offer.id },
          { delay: next.getTime() - Date.now() },
        );
        return;
      }

      const source = await prisma.source.upsert({
        where: { kind: 'MERCADOLIVRE' },
        update: {},
        create: { kind: 'MERCADOLIVRE' },
      });
      const cfg = (source.config as { panelDaily?: { date: string; count: number } }) ?? {};
      const today = new Date().toISOString().slice(0, 10);
      const daily =
        cfg.panelDaily && cfg.panelDaily.date === today
          ? cfg.panelDaily
          : { date: today, count: 0 };
      if (daily.count >= env.MERCADOLIVRE_PANEL_DAILY_LIMIT) {
        logger.warn({ offerId: offer.id, count: daily.count }, 'mercadolivre panel daily limit reached');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(env.DISPATCH_WINDOW_START, Math.floor(Math.random() * 60), 0, 0);
        await mercadoLivreShortlinkQueue.add(
          'mercadolivre-shortlink',
          { offerId: offer.id },
          { delay: tomorrow.getTime() - Date.now() },
        );
        return;
      }

      try {
        const shortlink = await generateMercadoLivreShortlink(offer.url);
        await prisma.offer.update({
          where: { id: offer.id },
          data: { affiliateUrl: shortlink },
        });
        await prisma.source.update({
          where: { id: source.id },
          data: {
            config: { ...cfg, panelDaily: { date: today, count: daily.count + 1 } } as object,
          },
        });
        logger.info(
          { offerId: offer.id, shortlink, dailyCount: daily.count + 1 },
          'mercadolivre shortlink generated',
        );
      } catch (err) {
        if (err instanceof MercadoLivrePanelError) {
          logger.error(
            { kind: err.kind, msg: err.message, offerId: offer.id },
            'mercadolivre panel failed',
          );
          if (err.kind === 'auth') return;
          if (err.kind === 'rate') {
            await mercadoLivreShortlinkQueue.add(
              'mercadolivre-shortlink',
              { offerId: offer.id },
              { delay: 90 * 60 * 1000 },
            );
            return;
          }
        }
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: { max: 1, duration: 30_000 },
    },
  );
  registerWorkerErrors(mercadoLivreShortlinkWorker, 'mercadolivre-shortlink');

  const allWorkers = [
    fetchWorker,
    curateWorker,
    dispatchWorker,
    shopeeShortlinkWorker,
    mercadoLivreShortlinkWorker,
  ];
  for (const w of allWorkers) {
    w.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, `${w.name} failed`));
    w.on('completed', (job) => logger.info({ jobId: job.id, queue: w.name }, 'job completed'));
  }

  return {
    fetchWorker,
    curateWorker,
    dispatchWorker,
    shopeeShortlinkWorker,
    mercadoLivreShortlinkWorker,
  };
}
