import { Worker } from 'bullmq';
import { redisConnection } from '@/lib/redis.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';
import { getAdapter } from '@/sources/index.js';
import type { RawOffer } from '@/sources/types.js';
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
      const adapter = await getAdapter(job.data.sourceKind);
      if (!adapter) {
        // Provider 'disabled' (ex: Amazon sem PA-API liberada). Pula sem erro.
        logger.info({ sourceKind: job.data.sourceKind }, 'no adapter (disabled) — skipping fetch');
        return { skipped: true, reason: 'disabled' };
      }
      const source = await prisma.source.upsert({
        where: { kind: job.data.sourceKind },
        update: {},
        create: { kind: job.data.sourceKind },
      });
      // Source.config define o que puxar — categorias, keywords, filtros.
      // Cron itera cada combinação. Sem config = comportamento legado (1 fetch genérico).
      const cfg = (source.config as {
        categoryIds?: string[];
        keywords?: string[];
        minDiscount?: number;
        limitPerCategory?: number;
        onlyMall?: boolean;
        onlyKeySellers?: boolean;
      }) ?? {};
      const limitPerCat = cfg.limitPerCategory ?? 10;
      const totalLimit = job.data.limit ?? 50;
      const sharedFilters = {
        minDiscount: cfg.minDiscount,
        onlyMall: cfg.onlyMall,
        onlyKeySellers: cfg.onlyKeySellers,
      };
      // ML precisa serializar (panel cookie banido se muitas requests paralelas).
      // Shopee/Amazon API aguentam paralelismo — usam concurrency normal.
      const isML = job.data.sourceKind === 'MERCADOLIVRE';
      const taskBuilders: Array<() => Promise<RawOffer[]>> = [];
      for (const catId of cfg.categoryIds ?? []) {
        taskBuilders.push(() => adapter.fetch({ categoryId: catId, limit: limitPerCat, ...sharedFilters }));
      }
      for (const kw of cfg.keywords ?? []) {
        taskBuilders.push(() => adapter.fetch({ keyword: kw, limit: limitPerCat, ...sharedFilters }));
      }
      if (taskBuilders.length === 0) {
        taskBuilders.push(() => adapter.fetch({ limit: totalLimit, ...sharedFilters }));
      }
      // ML serial (1 por vez) + jitter no adapter já protege.
      // Shopee/Amazon paralelo até 8 simultâneos.
      const concurrency = isML ? 1 : 8;
      const taskResults: PromiseSettledResult<RawOffer[]>[] = [];
      for (let i = 0; i < taskBuilders.length; i += concurrency) {
        const batch = taskBuilders.slice(i, i + concurrency).map((fn) =>
          fn().then((v) => ({ status: 'fulfilled' as const, value: v }))
              .catch((err) => ({ status: 'rejected' as const, reason: err })),
        );
        const settled = await Promise.all(batch);
        taskResults.push(...(settled as PromiseSettledResult<RawOffer[]>[]));
      }
      const fetchTasks = taskBuilders;
      const raws: RawOffer[] = [];
      for (const r of taskResults) {
        if (r.status === 'fulfilled') {
          raws.push(...r.value);
        } else {
          logger.warn({ err: r.reason, sourceKind: job.data.sourceKind }, 'fetch task failed');
        }
      }
      // Dedup por externalId (categorias podem ter overlap)
      const seenIds = new Set<string>();
      const dedupedRaws = raws.filter((r) => {
        if (seenIds.has(r.externalId)) return false;
        seenIds.add(r.externalId);
        return true;
      });
      logger.info(
        {
          sourceKind: job.data.sourceKind,
          tasks: fetchTasks.length,
          totalRaws: raws.length,
          deduped: dedupedRaws.length,
        },
        'fetch tasks completed',
      );
      // BLOCKLIST: rejeita produtos fora do nicho (mãe + bebê) por palavras-chave.
      // Adicione palavras que NÃO devem entrar via cron — protege grupo de
      // produtos sem nexo (kpop, halloween, peças automotivas, etc).
      const BLOCKED = [
        // Bonecas colecionáveis / brinquedos colecionáveis / pelúcias chinesas
        'labubu','la bu bu','la-bu-bu','kpop','k-pop','exo','bts','blackpink',
        'boneca','bonequinha','bonequinho','boneco ','baby alive','barbie','reborn',
        'fofuxa','little baby','my baby','metoo','patrulha canina','chase pelucia',
        'horse doll','plush doll','fish plush','chinese zodiac','chinese new year',
        'spring festival','year of the horse','year of the','bercinho','casa de boneca',
        'boneca de pelucia','boneca de pelúcia','roupa de boneca','roupas de boneca',
        'roupa para boneca','bonecas acessorios','acessórios de boneca','plush kpop',
        // Datas sazonais não-bebê
        'halloween','abóbora','abobora','dia das bruxas','natal cosplay','fantasia bruxa',
        // Natal — só os off-niche (NÃO bloquear "pré-natal" que é gestante)
        'luz natal','luzes natal','luzes de natal','pisca pisca','led piscando',
        'papai noel','noel','rena natal','renas natal','pinheirinho','arvore natal',
        'árvore de natal','traje natal','fantasia natal','cosplay natal',
        'colar led','colar piscando','colar luz','pulseira led','fonte de festa',
        'adereço festa','adereco festa','luz brilhante','xmas','christmas',
        'enfeite natal','enfeite de natal','presente natal','floco de neve cosplay',
        // Peças automotivas (já filtrado mas reforço)
        'parafuso','protetor carter','vedação','bujão','anel vedação',
        'fiat','ford','honda','toyota','corsa','palio','strada','siena','ecosport',
        'outlander','wagon','onix','cruze','astra','tracker','s10','vectra','zafira',
        // Outros fora nicho
        'cigarro','vape','arma','airsoft','tabaco','energetico para adulto',
        'whey protein','suplemento','pre treino','barra proteina',
      ];
      const blocked: string[] = [];
      const finalRaws = dedupedRaws.filter((r) => {
        const t = (r.title || '').toLowerCase();
        const hit = BLOCKED.find((b) => t.includes(b));
        if (hit) {
          blocked.push(`${hit}: ${(r.title || '').slice(0, 50)}`);
          return false;
        }
        return true;
      });
      if (blocked.length > 0) {
        logger.info(
          { source: job.data.sourceKind, blocked: blocked.length, samples: blocked.slice(0, 3) },
          'blocklist: rejected off-niche products',
        );
      }
      // Cupom Shopee NÃO é mais setado aqui no fetch — é aplicado em runtime
      // dentro de buildMessageText (whatsapp.ts), que escolhe o cupom de maior
      // desconto válido pra cada produto via applyCoupon() (DivulgaLinks-style).
      let inserted = 0;
      for (const r of finalRaws) {
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
          job.data.sourceKind === 'SHOPEE' &&
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
          job.data.sourceKind === 'MERCADOLIVRE' &&
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

      // DEDUP AUTO PÓS-FETCH (image match, dentro da mesma source).
      // SEGURANÇA: nunca deleta mais que 10% do total da source.
      // Mantém o de MENOR preço por imagem (melhor deal).
      try {
        const offers = await prisma.offer.findMany({
          where: { sourceId: source.id, imageUrl: { not: null } },
          select: { id: true, imageUrl: true, price: true, fetchedAt: true },
        });
        const totalSource = offers.length;
        const groups = new Map<string, typeof offers>();
        for (const o of offers) {
          const img = o.imageUrl || '';
          if (img.length < 20) continue; // imagem muito curta = não confiável
          if (!groups.has(img)) groups.set(img, []);
          groups.get(img)!.push(o);
        }
        const toDelete: string[] = [];
        for (const [, arr] of groups) {
          if (arr.length < 2) continue;
          // Mantém o de MENOR preço (melhor deal) e mais novo (fetchedAt desc)
          const sorted = [...arr].sort((a, b) => {
            const pa = Number(a.price ?? 999999);
            const pb = Number(b.price ?? 999999);
            if (pa !== pb) return pa - pb;
            return new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime();
          });
          for (const o of sorted.slice(1)) toDelete.push(o.id);
        }
        // SAFETY: não deleta mais que 10% da source
        const maxDelete = Math.floor(totalSource * 0.1);
        if (toDelete.length > maxDelete) {
          logger.warn(
            { source: job.data.sourceKind, wouldDelete: toDelete.length, maxDelete, totalSource },
            'auto-dedup ABORTED — would delete > 10% (safety guard)',
          );
        } else if (toDelete.length > 0) {
          // Delete dispatches dependentes primeiro (FK)
          await prisma.dispatch.deleteMany({ where: { offerId: { in: toDelete } } });
          const result = await prisma.offer.deleteMany({ where: { id: { in: toDelete } } });
          logger.info(
            { source: job.data.sourceKind, deleted: result.count, totalSource },
            'auto-dedup by image done',
          );
        }
      } catch (err) {
        logger.warn({ err, source: job.data.sourceKind }, 'auto-dedup falhou — sem prejuízo');
      }
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
        // Adiciona jitter de 0-90min no nextOpenAt — evita que TODOS os jobs
        // rescheduled (acumulados de madrugada) disparem juntos às 8:00:00.
        // Espalha entre 8h-9h30 da manhã pra parecer humano.
        const jitterMs = Math.floor(Math.random() * 90 * 60 * 1000);
        const delayMs = Math.max(0, result.runAt.getTime() - Date.now() + jitterMs);
        await dispatchQueue.add(
          'dispatch',
          { dispatchId: result.dispatchId },
          { delay: delayMs },
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
