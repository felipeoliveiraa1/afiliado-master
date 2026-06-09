import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '@/config/env.js';
import { prisma } from '@/lib/db.js';
import { evolution } from '@/lib/evolution.js';
import { fetchQueue, dispatchQueue } from '@/queue/queues.js';
import { validateShopeeCookie } from '@/sources/shopee_panel.js';
import { fetchShopeeShopViaApify, introspectShopeeSchema } from '@/sources/shopee.js';
import { logger } from '@/lib/logger.js';
import {
  defaultCouponSuffix,
  generateMlCouponCode,
  listAvailableCoupons,
  listGeneratedCoupons,
  MercadoLivrePanelError,
  searchAndAffiliateByCategory,
  searchMercadoLivreByCategory,
  validateMercadoLivreCookie,
} from '@/sources/mercadolivre_panel.js';
import {
  getAllSettings,
  getSettingsSection,
  invalidateSetting,
  maskSecrets,
  setSettingsSection,
  type SettingsSection,
} from '@/lib/settings.js';
import { scoreOffer } from '@/curator/score.js';
import { formatOfferMessage } from '@/dispatcher/format.js';
import { runCampaign } from '@/services/campaign-runner.js';

type EvolutionGroupRaw = {
  id?: string;
  remoteJid?: string;
  subject?: string;
  name?: string;
  size?: number;
  participants?: unknown[];
};

type NormalizedGroup = {
  id: string;
  subject: string;
  size: number;
};

/**
 * Aceita "*" (libera tudo, dev), uma URL única, ou lista separada por vírgula.
 * Suporta wildcard com `*` em qualquer parte (ex: `https://*.vercel.app` libera
 * previews automáticos da Vercel) — converte cada entrada com `*` em RegExp e
 * combina tudo em um array misto que o `@fastify/cors` aceita.
 *
 * Em produção configure ex.:
 *   WEB_ORIGIN_URL=https://*.vercel.app,https://app.exemplo.com
 */
function parseAllowedOrigins(raw: string): boolean | (string | RegExp)[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return true;
  const entries = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return entries.map<string | RegExp>((entry) => {
    if (!entry.includes('*')) return entry;
    // Split on `*`, escape cada pedaço, junta com `.*` — evita escapar o
    // próprio `*` por engano.
    const pattern = entry
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${pattern}$`);
  });
}

function normalizeGroups(raw: unknown): NormalizedGroup[] {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .map((item: EvolutionGroupRaw): NormalizedGroup | null => {
      const id = item.id ?? item.remoteJid;
      if (!id || !id.endsWith('@g.us')) return null;
      return {
        id,
        subject: item.subject ?? item.name ?? id,
        size: item.size ?? item.participants?.length ?? 0,
      };
    })
    .filter((g): g is NormalizedGroup => g !== null)
    .sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
}

export async function buildServer() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? {
            level: env.LOG_LEVEL,
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : { level: env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, {
    origin: parseAllowedOrigins(env.WEB_ORIGIN_URL),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // PÚBLICO — vitrine de produtos pra página /ofertas (sem auth).
  // Amazon's bot precisa indexar pra aprovar o programa de afiliados.
  // Retorna top N produtos por score, com affiliateUrl tagueado.
  app.get(
    '/public/featured-products',
    {
      schema: {
        querystring: z.object({
          source: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        }),
      },
    },
    async (req) => {
      const limit = req.query.limit ?? 20;
      const where: Record<string, unknown> = {
        affiliateUrl: { not: null },
        imageUrl: { not: null },
        price: { gt: 0 },
      };
      if (req.query.source) {
        where.source = { kind: req.query.source };
      }
      const items = await prisma.offer.findMany({
        where,
        orderBy: [{ score: 'desc' }, { rating: 'desc' }],
        take: limit,
        include: { source: { select: { kind: true } } },
      });
      // Pra Amazon: reconstrói affiliateUrl com a tag ATUAL do settings.
      // Evita servir links com tag antiga gravada no DB quando a tag muda
      // (ex: reaprovação Amazon Associates gera nova ID).
      const mkt = await getSettingsSection<{ amazonAffiliateTag?: string }>('marketplaces');
      const currentAmazonTag = mkt.amazonAffiliateTag?.trim();
      return {
        items: items.map((o) => {
          let affiliateUrl = o.affiliateUrl;
          if (o.source.kind === 'AMAZON' && currentAmazonTag) {
            affiliateUrl = `https://www.amazon.com.br/dp/${o.externalId}?tag=${encodeURIComponent(currentAmazonTag)}`;
          }
          return {
            id: o.id,
            externalId: o.externalId,
            title: o.title,
            imageUrl: o.imageUrl,
            price: Number(o.price),
            originalPrice: o.originalPrice ? Number(o.originalPrice) : null,
            discountPct: o.discountPct ? Number(o.discountPct) : null,
            rating: o.rating ? Number(o.rating) : null,
            ratingCount: o.ratingCount,
            salesCount: o.salesCount,
            affiliateUrl,
            source: o.source.kind,
          };
        }),
      };
    },
  );

  // Endpoint PÚBLICO — landing page (/) consome essa config sem auth.
  // Devolve só dados de display (sem secrets).
  app.get('/landing-config', async () => {
    const cfg = await getSettingsSection<{
      groupLinks?: string[];
      totalVagas?: number;
      vagasBase?: number;
      deadlineSeconds?: number;
      headline?: string;
      subheadline?: string;
      metaPixelId?: string;
    }>('landing');
    return {
      groupLinks: cfg.groupLinks ?? [],
      totalVagas: cfg.totalVagas ?? 500,
      vagasBase: cfg.vagasBase ?? 423,
      deadlineSeconds: cfg.deadlineSeconds ?? 120,
      headline: cfg.headline ?? 'Achadinhos de mãe pra mãe 💕',
      subheadline:
        cfg.subheadline ??
        'Promoções selecionadas com cupons exclusivos direto no seu WhatsApp.',
      metaPixelId: cfg.metaPixelId ?? '',
    };
  });

  // ===== Settings (configuração editável pelo dashboard) =====
  // GET /settings devolve todas as seções com secrets MASCARADOS (cookie/apiKey).
  // GET /settings/:section?reveal=1 devolve secrets em claro (pra edição).
  // PATCH /settings/:section faz merge raso e invalida cache.

  const SECTIONS = [
    'evolution',
    'mercadolivre_panel',
    'shopee_panel',
    'riachuelo_panel',
    'marketplaces',
    'antiban',
    'automation',
    'admin',
    'landing',
  ] as const;

  app.get('/settings', async () => {
    const all = await getAllSettings();
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(all)) {
      masked[key] = maskSecrets(value as Record<string, unknown>);
    }
    return masked;
  });

  app.get(
    '/settings/:section',
    {
      schema: {
        params: z.object({ section: z.enum(SECTIONS) }),
        querystring: z.object({ reveal: z.string().optional() }),
      },
    },
    async (req) => {
      const value = await getSettingsSection(req.params.section as SettingsSection);
      return req.query.reveal ? value : maskSecrets(value);
    },
  );

  app.patch(
    '/settings/:section',
    {
      schema: {
        params: z.object({ section: z.enum(SECTIONS) }),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async (req) => {
      const next = await setSettingsSection(req.params.section as SettingsSection, req.body);
      invalidateSetting(req.params.section as SettingsSection);
      return maskSecrets(next as Record<string, unknown>);
    },
  );

  app.get('/evolution/instances', async () => evolution.listInstances());
  app.get(
    '/evolution/groups',
    {
      schema: {
        querystring: z.object({ instance: z.string().optional() }),
      },
    },
    async (req) => normalizeGroups(await evolution.listGroups(req.query.instance)),
  );

  app.post(
    '/sources/:kind/fetch',
    {
      schema: {
        params: z.object({ kind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'RIACHUELO']) }),
        body: z.object({ limit: z.number().int().min(1).max(200).optional() }).nullish(),
      },
    },
    async (req) => {
      const { kind } = req.params;
      const limit = (req.body as { limit?: number } | undefined)?.limit ?? 30;
      const job = await fetchQueue.add('fetch', { sourceKind: kind, limit });
      return { queued: true, jobId: job.id };
    },
  );

  app.get(
    '/sources/:kind',
    {
      schema: {
        params: z.object({ kind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']) }),
      },
    },
    async (req) => {
      const source = await prisma.source.upsert({
        where: { kind: req.params.kind },
        update: {},
        create: { kind: req.params.kind },
      });
      return source;
    },
  );

  // PATCH /sources/:kind — atualiza Source.config (categorias, keywords, filtros)
  // Esses settings são lidos pelo cron a cada fetch automático.
  app.patch(
    '/sources/:kind/config',
    {
      schema: {
        params: z.object({ kind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']) }),
        body: z.object({
          categoryIds: z.array(z.string()).optional(),
          keywords: z.array(z.string()).optional(),
          minDiscount: z.number().min(0).max(100).optional(),
          limitPerCategory: z.number().int().min(1).max(50).optional(),
          onlyMall: z.boolean().optional(),
          onlyKeySellers: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const updated = await prisma.source.upsert({
        where: { kind: req.params.kind },
        update: { config: req.body as never },
        create: { kind: req.params.kind, config: req.body as never },
      });
      return updated;
    },
  );

  app.get('/offers', async (req) => {
    const q = req.query as {
      take?: string;
      skip?: string;
      minScore?: string;
      source?: string;
      // Busca por título (case-insensitive)
      search?: string;
      // Ordenação: 'score' (default), 'recent' (fetchedAt desc), 'oldest', 'price-asc', 'price-desc'
      sort?: string;
      // Filtro Shopee Mall — só lojas oficiais (raw.isOfficialMall=true)
      onlyMall?: string;
    };
    const take = Math.min(100, Number(q.take ?? 20));
    const skip = Math.max(0, Number(q.skip ?? 0));
    const where: Record<string, unknown> = {
      score: q.minScore ? { gte: Number(q.minScore) } : undefined,
      source: q.source ? { kind: q.source as 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' } : undefined,
    };
    if (q.search?.trim()) {
      where.title = { contains: q.search.trim(), mode: 'insensitive' };
    }
    const orderBy =
      q.sort === 'recent'
        ? { fetchedAt: 'desc' as const }
        : q.sort === 'oldest'
          ? { fetchedAt: 'asc' as const }
          : q.sort === 'price-asc'
            ? { price: 'asc' as const }
            : q.sort === 'price-desc'
              ? { price: 'desc' as const }
              : { score: 'desc' as const };
    // Filtro "só Loja Oficial Mall" (Shopee). Pesquisa no JSON do raw via
    // path filter do Prisma.
    if (q.onlyMall === 'true') {
      where.raw = { path: ['isOfficialMall'], equals: true };
    }
    const [items, total] = await Promise.all([
      prisma.offer.findMany({
        take,
        skip,
        where,
        orderBy,
        include: { source: { select: { kind: true } } },
      }),
      prisma.offer.count({ where }),
    ]);
    // Deriva isOfficialMall do raw pra UI mostrar badge sem precisar
    // re-parsear o JSON inteiro no client.
    const enriched = items.map((o) => ({
      ...o,
      isOfficialMall: Boolean(
        (o.raw as { isOfficialMall?: boolean } | null)?.isOfficialMall,
      ),
    }));
    return { items: enriched, total, take, skip };
  });

  // Contagem agregada por plataforma — usado pelo dashboard pra mostrar
  // "X Shopee · Y ML" sem precisar paginar tudo.
  app.get('/offers/stats', async () => {
    const grouped = await prisma.offer.groupBy({
      by: ['sourceId'],
      _count: { _all: true },
    });
    const sources = await prisma.source.findMany({
      select: { id: true, kind: true },
    });
    const byKind: Record<string, number> = { SHOPEE: 0, MERCADOLIVRE: 0, AMAZON: 0 };
    for (const g of grouped) {
      const src = sources.find((s) => s.id === g.sourceId);
      if (src) byKind[src.kind] = (byKind[src.kind] ?? 0) + g._count._all;
    }
    const total = Object.values(byKind).reduce((a, b) => a + b, 0);
    return { total, byKind };
  });

  // Lista ofertas que precisam do seu input (link tageado manual).
  // Útil pra Shopee/ML enquanto não tem Open API: você vê o que o Promobit
  // descobriu, gera os shortlinks no painel, e devolve via PATCH.
  app.get('/offers/pending-affiliate-link', async (req) => {
    const q = req.query as { source?: string; take?: string };
    return prisma.offer.findMany({
      take: Math.min(100, Number(q.take ?? 30)),
      where: {
        affiliateUrl: null,
        source: q.source
          ? { kind: q.source as 'SHOPEE' | 'MERCADOLIVRE' }
          : { kind: { in: ['SHOPEE', 'MERCADOLIVRE'] } },
      },
      orderBy: [{ score: 'desc' }, { fetchedAt: 'desc' }],
      include: { source: { select: { kind: true } } },
    });
  });

  app.patch(
    '/offers/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          affiliateUrl: z.string().url().optional(),
          title: z.string().optional(),
          imageUrl: z.string().url().optional(),
          price: z.number().positive().optional(),
          originalPrice: z.number().positive().optional(),
          coupon: z.string().min(1).max(40).nullable().optional(),
          installments: z.number().int().min(1).max(24).nullable().optional(),
        }),
      },
    },
    async (req) => prisma.offer.update({ where: { id: req.params.id }, data: req.body }),
  );

  app.delete(
    '/offers/:id',
    {
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      // FK Dispatch.offerId não tem cascade — limpa primeiro pra evitar P2003.
      // Variants também tem FK pra Offer, idem.
      await prisma.dispatch.deleteMany({ where: { offerId: req.params.id } });
      await prisma.variant.deleteMany({ where: { offerId: req.params.id } });
      await prisma.offer.delete({ where: { id: req.params.id } });
      return { deleted: true };
    },
  );

  app.post(
    '/offers/bulk-delete',
    {
      schema: {
        body: z.object({
          ids: z.array(z.string()).optional(),
          source: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']).optional(),
          olderThanDays: z.number().int().positive().optional(),
        }),
      },
    },
    async (req, reply) => {
      // 3 modos de limpeza em massa (mutuamente exclusivos):
      //   1) ids[] explícitos — UI checkbox selection (preferido)
      //   2) source — todos de um marketplace
      //   3) olderThanDays — limpeza por idade
      //
      // SEGURANÇA: rejeita se TODOS os filtros vazios (evita apagar tudo).
      const hasIds = Array.isArray(req.body.ids) && req.body.ids.length > 0;
      const hasSource = Boolean(req.body.source);
      const hasAge = Boolean(req.body.olderThanDays);
      if (!hasIds && !hasSource && !hasAge) {
        return reply.code(400).send({
          error: 'Nada filtrado — passe ids[], source ou olderThanDays explicitamente',
        });
      }
      let ids: string[];
      if (hasIds) {
        ids = req.body.ids!;
      } else {
        const where = {
          source: hasSource ? { kind: req.body.source } : undefined,
          fetchedAt: hasAge
            ? { lt: new Date(Date.now() - req.body.olderThanDays! * 86_400_000) }
            : undefined,
        };
        const offers = await prisma.offer.findMany({ where, select: { id: true } });
        ids = offers.map((o) => o.id);
      }
      if (ids.length === 0) return { deleted: 0 };
      await prisma.dispatch.deleteMany({ where: { offerId: { in: ids } } });
      await prisma.variant.deleteMany({ where: { offerId: { in: ids } } });
      const result = await prisma.offer.deleteMany({ where: { id: { in: ids } } });
      return { deleted: result.count };
    },
  );

  // Import manual de ofertas (útil enquanto Shopee Open API não libera, ou pra
  // curadoria hand-picked de qualquer marketplace). User cola affiliateUrl pronto.
  app.post(
    '/offers/import',
    {
      schema: {
        body: z.object({
          sourceKind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']),
          offers: z
            .array(
              z.object({
                externalId: z.string(),
                title: z.string().min(3),
                url: z.string().url(),
                affiliateUrl: z.string().url(),
                imageUrl: z.string().url().optional(),
                price: z.number().positive(),
                originalPrice: z.number().positive().optional(),
                category: z.string().optional(),
                commissionPct: z.number().min(0).max(100).optional(),
              }),
            )
            .min(1)
            .max(100),
        }),
      },
    },
    async (req) => {
      const { sourceKind, offers } = req.body;
      const source = await prisma.source.upsert({
        where: { kind: sourceKind },
        update: {},
        create: { kind: sourceKind },
      });
      const results = [];
      for (const o of offers) {
        const discountPct =
          o.originalPrice && o.originalPrice > o.price
            ? Number((((o.originalPrice - o.price) / o.originalPrice) * 100).toFixed(2))
            : undefined;
        const offer = await prisma.offer.upsert({
          where: { sourceId_externalId: { sourceId: source.id, externalId: o.externalId } },
          create: {
            sourceId: source.id,
            externalId: o.externalId,
            title: o.title,
            imageUrl: o.imageUrl,
            price: o.price,
            originalPrice: o.originalPrice,
            discountPct,
            category: o.category,
            url: o.url,
            affiliateUrl: o.affiliateUrl,
            commissionPct: o.commissionPct,
            score: scoreOffer({
              discountPct: discountPct ?? null,
              rating: null,
              ratingCount: null,
              salesCount: null,
              commissionPct: o.commissionPct ?? null,
            }),
            raw: { manual: true } as object,
          },
          update: {
            title: o.title,
            price: o.price,
            originalPrice: o.originalPrice,
            discountPct,
            affiliateUrl: o.affiliateUrl,
            fetchedAt: new Date(),
          },
        });
        results.push(offer.id);
      }
      return { imported: results.length, offerIds: results };
    },
  );

  app.post(
    '/channels',
    {
      schema: {
        body: z.object({
          name: z.string(),
          kind: z.enum(['WHATSAPP_GROUP', 'TELEGRAM_CHANNEL']),
          evolutionInstance: z.string().optional(),
          whatsappGroupId: z.string().optional(),
          telegramBotToken: z.string().optional(),
          telegramChatId: z.string().optional(),
        }),
      },
    },
    async (req) => prisma.channel.create({ data: req.body }),
  );

  app.get('/channels', async () => prisma.channel.findMany());

  app.get('/campaigns', async () =>
    prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { channels: { select: { id: true, name: true } } },
    }),
  );

  app.get(
    '/campaigns/:id',
    {
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) =>
      prisma.campaign.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { channels: true },
      }),
  );

  app.post(
    '/campaigns',
    {
      schema: {
        body: z.object({
          name: z.string(),
          filters: z
            .object({
              sources: z.array(z.string()).optional(),
              minDiscount: z.number().optional(),
              minScore: z.number().optional(),
              categories: z.array(z.string()).optional(),
              maxPrice: z.number().optional(),
            })
            .optional(),
          schedule: z
            .object({
              intervalMinutes: z.number().int().min(1),
              // Override por campanha — se ausente, fallback pra settings.antiban.
              windowStartHour: z.number().int().min(0).max(23).optional(),
              windowEndHour: z.number().int().min(0).max(24).optional(),
              dailyLimit: z.number().int().min(1).optional(),
              postLoop: z.boolean().optional(), // true = recomeça quando tudo dispatched
            })
            .optional(),
          channelIds: z.array(z.string()).min(1),
          nicheIds: z.array(z.string()).optional(),
        }),
      },
    },
    async (req) => {
      const { channelIds, nicheIds, ...rest } = req.body;
      return prisma.campaign.create({
        data: {
          ...rest,
          filters: rest.filters ?? {},
          schedule: rest.schedule ?? {},
          channels: { connect: channelIds.map((id) => ({ id })) },
          ...(nicheIds && nicheIds.length > 0
            ? { niches: { connect: nicheIds.map((id) => ({ id })) } }
            : {}),
        },
      });
    },
  );

  app.post(
    '/campaigns/:id/run-now',
    {
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => runCampaign(req.params.id, 1),
  );

  // Dispara uma OFERTA ESPECÍFICA agora (bypass score/random pick).
  // Útil pra mandar produto curado manualmente sem mexer em score.
  // delaySec: agenda o dispatch pra X segundos no futuro (espaça batches manuais).
  app.post(
    '/campaigns/:id/dispatch-offer',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          offerId: z.string(),
          delaySec: z.number().int().min(0).max(86400).optional(),
          bypassWindow: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { dispatchQueue } = await import('@/queue/queues.js');
      const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { channels: true },
      });
      if (campaign.channels.length === 0) return { dispatched: 0, error: 'no channels' };
      const delayMs = (req.body.delaySec ?? 0) * 1000;
      const scheduledFor = new Date(Date.now() + delayMs);
      const dispatchIds: string[] = [];
      for (const channel of campaign.channels) {
        const d = await prisma.dispatch.upsert({
          where: {
            campaignId_offerId_channelId: {
              campaignId: campaign.id,
              offerId: req.body.offerId,
              channelId: channel.id,
            },
          },
          create: {
            campaignId: campaign.id,
            offerId: req.body.offerId,
            channelId: channel.id,
            scheduledFor,
          },
          update: { status: 'PENDING', scheduledFor },
        });
        await dispatchQueue.add(
          'dispatch',
          {
            dispatchId: d.id,
            bypassWindow: req.body.bypassWindow,
            // Dispatch manual via dashboard = intenção explícita do usuário,
            // bypassa daily limit (anti-ban) igual /import-link/dispatch
            bypassDailyLimit: req.body.bypassWindow,
          },
          { delay: delayMs },
        );
        dispatchIds.push(d.id);
      }
      return { dispatched: dispatchIds.length, dispatchIds, scheduledFor };
    },
  );

  // Lista offerIds já com Dispatch (qualquer status) pra essa campanha.
  // Usado pra evitar re-dispatch manual do mesmo produto.
  app.get(
    '/campaigns/:id/dispatched-offer-ids',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req) => {
      const rows = await prisma.dispatch.findMany({
        where: { campaignId: req.params.id },
        select: { offerId: true },
        distinct: ['offerId'],
      });
      return { offerIds: rows.map((r) => r.offerId) };
    },
  );

  app.patch(
    '/campaigns/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          enabled: z.boolean().optional(),
          name: z.string().optional(),
          filters: z.record(z.unknown()).optional(),
          schedule: z
            .object({
              intervalMinutes: z.number().int().min(1).optional(),
              intervalMinutesMin: z.number().int().min(1).optional(),
              intervalMinutesMax: z.number().int().min(1).optional(),
              windowStartHour: z.number().int().min(0).max(23).optional(),
              windowEndHour: z.number().int().min(0).max(24).optional(),
              dailyLimit: z.number().int().min(1).optional(),
              postLoop: z.boolean().optional(),
              burstSizeMin: z.number().int().min(1).max(30).optional(),
              burstSizeMax: z.number().int().min(1).max(30).optional(),
              burstSpreadMinSec: z.number().int().min(0).max(1800).optional(),
              burstSpreadMaxSec: z.number().int().min(0).max(1800).optional(),
            })
            .optional(),
          channelIds: z.array(z.string()).optional(),
          nicheIds: z.array(z.string()).optional(),
        }),
      },
    },
    async (req) => {
      const { channelIds, nicheIds, ...rest } = req.body as {
        channelIds?: string[];
        nicheIds?: string[];
      } & Record<string, unknown>;
      // Merge schedule existente com o partial — pra não perder fields que o front omitiu.
      const data: Record<string, unknown> = { ...rest };
      if (rest.schedule || rest.filters) {
        const current = await prisma.campaign.findUniqueOrThrow({
          where: { id: req.params.id },
          select: { schedule: true, filters: true },
        });
        if (rest.schedule) {
          data.schedule = {
            ...((current.schedule as Record<string, unknown>) ?? {}),
            ...(rest.schedule as Record<string, unknown>),
          };
        }
        if (rest.filters) {
          data.filters = {
            ...((current.filters as Record<string, unknown>) ?? {}),
            ...(rest.filters as Record<string, unknown>),
          };
        }
      }
      // Relations: usa `set` pra substituir (zero downtime — campanha não pausa).
      if (channelIds) {
        data.channels = { set: channelIds.map((id) => ({ id })) };
      }
      if (nicheIds) {
        data.niches = { set: nicheIds.map((id) => ({ id })) };
      }
      return prisma.campaign.update({
        where: { id: req.params.id },
        data: data as never,
        include: { channels: true, niches: true },
      });
    },
  );

  app.delete(
    '/campaigns/:id',
    {
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      // FK Dispatch.campaignId não tem cascade — limpa antes pra evitar P2003.
      await prisma.dispatch.deleteMany({ where: { campaignId: req.params.id } });
      await prisma.campaign.delete({ where: { id: req.params.id } });
      return { deleted: true };
    },
  );

  // Introspection do schema GraphQL Shopee — útil pra descobrir queries
  // como couponOffer, shopOfferV2 etc sem precisar da doc oficial.
  app.get('/sources/SHOPEE/introspect', async () => introspectShopeeSchema());

  // ===========================================================================
  // AWIN / RIACHUELO — endpoints pra Settings UI validar credenciais + listar
  // programmes (find advertiserId), feeds e gerar deeplinks ad-hoc.
  // ===========================================================================
  app.get('/sources/RIACHUELO/verify', async (_req, reply) => {
    try {
      const { listAccounts } = await import('@/sources/awin.js');
      const accounts = await listAccounts();
      return { ok: true, accounts };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get(
    '/sources/RIACHUELO/programmes',
    {
      schema: {
        querystring: z.object({
          relationship: z
            .enum(['joined', 'pending', 'notjoined', 'suspended', 'rejected'])
            .optional()
            .default('joined'),
        }),
      },
    },
    async (req, reply) => {
      try {
        const { listProgrammes } = await import('@/sources/awin.js');
        const programmes = await listProgrammes(req.query.relationship);
        return { ok: true, programmes };
      } catch (err) {
        return reply.code(400).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  app.get('/sources/RIACHUELO/feeds', async (_req, reply) => {
    try {
      const { listFeeds } = await import('@/sources/awin.js');
      const feeds = await listFeeds();
      return { ok: true, feeds };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post(
    '/sources/RIACHUELO/generate-deeplink',
    {
      schema: {
        body: z.object({
          destinationUrl: z.string().url(),
          advertiserId: z.number().int().optional(),
          clickRef: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      try {
        const { generateDeeplink } = await import('@/sources/awin.js');
        const deeplink = await generateDeeplink(req.body.destinationUrl, {
          advertiserId: req.body.advertiserId,
          clickRef: req.body.clickRef,
        });
        return { ok: true, deeplink };
      } catch (err) {
        return reply.code(400).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  // Conversion Report — relatório de vendas/comissões D+1 da Shopee.
  // Cacheia 24h por chave de filtro (force refresh com ?refresh=1).
  app.get(
    '/sources/SHOPEE/conversions',
    {
      schema: {
        querystring: z.object({
          purchaseTimeStart: z.coerce.number().int().optional(),
          purchaseTimeEnd: z.coerce.number().int().optional(),
          orderStatus: z
            .enum(['COMPLETED', 'PENDING', 'CANCELLED', 'UNPAID', 'ALL'])
            .optional(),
          buyerType: z.enum(['NEW', 'EXISTING', 'ALL']).optional(),
          device: z.enum(['APP', 'WEB', 'ALL']).optional(),
          shopName: z.string().optional(),
          productName: z.string().optional(),
          orderId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
          scrollId: z.string().optional(),
          refresh: z.coerce.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { fetchShopeeConversions } = await import('@/sources/shopee.js');
      const now = Math.floor(Date.now() / 1000);
      const start = req.query.purchaseTimeStart ?? now - 30 * 86400;
      const end = req.query.purchaseTimeEnd ?? now;
      const limit = req.query.limit ?? 100;

      const conv = await fetchShopeeConversions({
        purchaseTimeStart: start,
        purchaseTimeEnd: end,
        limit,
        scrollId: req.query.scrollId,
      });

      // Flatten orders×items pra cada conversion vira N linhas (1 por item)
      type FlatItem = {
        conversionId: string;
        orderId: string;
        orderStatus: string;
        purchaseTime: number;
        device: string | null;
        buyerType: string | null;
        shopName: string;
        shopId: string;
        itemId: string;
        itemName: string;
        itemPrice: number;
        actualAmount: number;
        qty: number;
        imageUrl: string;
        itemTotalCommission: number;
        category: string | null;
        // Cruzamento com nossa base — produto está no nosso DB?
        ourOfferId: string | null;
        ourCampaignName: string | null;
        ourDispatchedAt: string | null;
      };
      const allItems: FlatItem[] = [];
      const itemIdsForLookup = new Set<string>();
      for (const c of conv.nodes) {
        for (const o of c.orders) {
          for (const it of o.items) {
            allItems.push({
              conversionId: c.conversionId,
              orderId: o.orderId,
              orderStatus: o.orderStatus,
              purchaseTime: c.purchaseTime,
              device: c.device,
              buyerType: null, // não usado por enquanto
              shopName: it.shopName,
              shopId: it.shopId,
              itemId: it.itemId,
              itemName: it.itemName,
              itemPrice: it.itemPrice,
              actualAmount: it.actualAmount,
              qty: it.qty,
              imageUrl: it.imageUrl,
              itemTotalCommission: it.itemTotalCommission,
              category: [it.categoryLv1Name, it.categoryLv2Name]
                .filter(Boolean)
                .join(' > ') || null,
              ourOfferId: null,
              ourCampaignName: null,
              ourDispatchedAt: null,
            });
            itemIdsForLookup.add(it.itemId);
          }
        }
      }

      // Cruzamento: pra cada itemId Shopee, busca se temos Offer + Dispatch
      // pra GRUPO PROMO — assim a gente sabe se o pedido veio de uma mensagem
      // que mandamos vs orgânico (cliente clicou em outro link nosso).
      if (itemIdsForLookup.size > 0) {
        const ourOffers = await prisma.offer.findMany({
          where: {
            externalId: { in: Array.from(itemIdsForLookup) },
            source: { kind: 'SHOPEE' },
          },
          include: {
            dispatches: {
              where: { status: 'SENT' },
              orderBy: { sentAt: 'desc' },
              take: 1,
              include: { campaign: { select: { name: true } } },
            },
          },
        });
        const offerByExtId = new Map(ourOffers.map((o) => [o.externalId, o]));
        for (const item of allItems) {
          const o = offerByExtId.get(item.itemId);
          if (!o) continue;
          item.ourOfferId = o.id;
          const d = o.dispatches[0];
          if (d) {
            item.ourCampaignName = d.campaign?.name ?? null;
            item.ourDispatchedAt = d.sentAt?.toISOString() ?? null;
          }
        }
      }

      // Filtros client-side (que Shopee API não expõe direto)
      let filtered = allItems;
      if (req.query.orderStatus && req.query.orderStatus !== 'ALL') {
        filtered = filtered.filter((i) => i.orderStatus === req.query.orderStatus);
      }
      if (req.query.device && req.query.device !== 'ALL') {
        filtered = filtered.filter((i) => i.device === req.query.device);
      }
      if (req.query.shopName) {
        const q = req.query.shopName.toLowerCase();
        filtered = filtered.filter((i) => i.shopName.toLowerCase().includes(q));
      }
      if (req.query.productName) {
        const q = req.query.productName.toLowerCase();
        filtered = filtered.filter((i) => i.itemName.toLowerCase().includes(q));
      }
      if (req.query.orderId) {
        filtered = filtered.filter((i) => i.orderId.includes(req.query.orderId!));
      }

      // Agregados — usa items FILTRADOS pra refletir o que o usuário vê
      const totals = {
        totalCommission: filtered.reduce((s, i) => s + i.itemTotalCommission, 0),
        netCommission: filtered.reduce((s, i) => s + i.itemTotalCommission, 0), // sem MCN fee = igual
        totalOrders: new Set(filtered.map((i) => i.orderId)).size,
        totalItems: filtered.reduce((s, i) => s + i.qty, 0),
        totalAmount: filtered.reduce((s, i) => s + i.actualAmount, 0),
        statusCounts: {
          COMPLETED: filtered.filter((i) => i.orderStatus === 'COMPLETED').length,
          PENDING: filtered.filter((i) => i.orderStatus === 'PENDING').length,
          CANCELLED: filtered.filter((i) => i.orderStatus === 'CANCELLED').length,
          UNPAID: filtered.filter((i) => i.orderStatus === 'UNPAID').length,
        },
        fromOurDispatches: filtered.filter((i) => i.ourDispatchedAt).length,
      };

      return {
        items: filtered,
        totals,
        pageInfo: {
          hasNextPage: !!conv.nextScrollId,
          scrollId: conv.nextScrollId,
        },
        cached: false,
      };
    },
  );

  // Importa produtos via LISTA DE URLs colada manualmente.
  // Mais confiável que scraping (Shopee bloqueia Apify/Puppeteer). User abre
  // loja, copia 30-50 URLs dos produtos top, cola num textarea — sistema
  // processa cada uma: gera shortlink afiliado, busca dados via productOfferV2
  // ou scrape leve, cria Offer no DB.
  app.post(
    '/sources/SHOPEE/import-urls',
    {
      schema: {
        body: z.object({
          urls: z.array(z.string().url()).min(1).max(200),
          shopName: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { urls, shopName } = req.body;
      const source = await prisma.source.findUnique({ where: { kind: 'SHOPEE' } });
      if (!source) return { imported: 0, error: 'Source SHOPEE não cadastrada' };

      const { generateShopeeShortLink } = await import('@/sources/shopee.js');
      let inserted = 0;
      let failed = 0;
      const results: Array<{ url: string; ok: boolean; reason?: string }> = [];

      for (const url of urls) {
        // Extrai shopId/itemId da URL Shopee
        const m =
          url.match(/\/product\/(\d+)\/(\d+)/) || url.match(/[.\-]i\.(\d+)\.(\d+)/);
        if (!m) {
          failed++;
          results.push({ url, ok: false, reason: 'URL fora do formato shopee' });
          continue;
        }
        const itemId = m[2];
        try {
          const affiliateUrl = await generateShopeeShortLink(url);
          // Cria offer minimalista — title vem da URL ou genérico
          // decodeURIComponent fixa %C3%A3o → ão, %20 → espaço etc
          let titleSlug = url.match(/shopee\.com\.br\/([^?]+?)-i\./)?.[1]?.replace(/-/g, ' ') ?? itemId;
          try {
            titleSlug = decodeURIComponent(titleSlug);
          } catch {
            // ignora se URL malformada
          }
          await prisma.offer.upsert({
            where: { sourceId_externalId: { sourceId: source.id, externalId: itemId } },
            create: {
              sourceId: source.id,
              externalId: itemId,
              title: titleSlug.slice(0, 200),
              imageUrl: null,
              price: 0,
              url,
              affiliateUrl,
              raw: { importedFrom: 'manual-url-list', shopName: shopName ?? '' } as object,
              fetchedAt: new Date(),
              score: 0.95, // PRIORIDADE MÁXIMA — manual de loja parceira sempre vence
            },
            update: {
              affiliateUrl,
              fetchedAt: new Date(),
              score: 0.95, // bump existing também (idempotente: re-import = update score)
            },
          });
          inserted++;
          results.push({ url, ok: true });
        } catch (err) {
          failed++;
          results.push({ url, ok: false, reason: (err as Error).message });
        }
      }
      return { imported: inserted, failed, total: urls.length, results: results.slice(0, 20) };
    },
  );

  // Aba "Importar Link" — esposa cola UMA URL Shopee, sistema puxa título/foto/preço
  // via productOfferV2 (free) ou Apify scraper (fallback), aplica melhor cupom Shopee,
  // cria Offer com score máximo e dispara dispatch imediato no grupo Promo Helena.
  // Bypass janela 8-22 BRT via flag bypassWindow:true no job.
  app.post(
    '/import-link/preview',
    { schema: { body: z.object({ url: z.string().url() }) } },
    async (req) => {
      try {
        const { enrichFromUrl } = await import('@/sources/url_enrich.js');
        const enriched = await enrichFromUrl(req.body.url);
        // Cupons só aplicam pra Shopee (Amazon não tem cupom Shopee)
        let bestCoupon:
          | {
              code: string | null;
              discount: number;
              finalPrice: number;
              discountText: string;
              redeemLink?: string;
            }
          | null = null;
        let allCoupons: Array<{
          code: string | null;
          description: string;
          discountText: string;
          minPurchase: number | null;
          isAuto: boolean;
          eligible: boolean;
        }> = [];
        let isOfficialMall = false;
        if (enriched.platform === 'SHOPEE') {
          isOfficialMall = Boolean(
            (enriched.raw as { isOfficialMall?: boolean } | undefined)?.isOfficialMall,
          );
          const coupons = await prisma.shopeeCoupon.findMany({
            where: { enabled: true, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
            orderBy: [{ value: 'desc' }],
          });
          const eligibleCoupons = coupons.filter((c) => !c.officialOnly || isOfficialMall);
          const { applyCoupon } = await import('@/dispatcher/format.js');
          const shopeeSettings = await getSettingsSection<{ shopeeCouponRedeemShortlink?: string }>(
            'marketplaces',
          );
          const masterLink = shopeeSettings.shopeeCouponRedeemShortlink?.trim();

          const buildDiscountText = (c: typeof coupons[number]): string => {
            if (c.discountText) return c.discountText;
            if (c.type === 'FIXED') return `R$ ${Math.round(Number(c.value))} OFF`;
            const max = c.maxDiscount ? ` (até R$ ${Math.round(Number(c.maxDiscount))})` : '';
            return `${Number(c.value)}% OFF${max}`;
          };

          for (const c of eligibleCoupons) {
            const result = applyCoupon(enriched.price ?? 0, {
              code: c.code,
              type: (c.type as 'PERCENT' | 'FIXED') ?? 'PERCENT',
              value: Number(c.value),
              minPurchase: c.minPurchase ? Number(c.minPurchase) : null,
              maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
            });
            if (result.applies && (!bestCoupon || result.discountValue > bestCoupon.discount)) {
              bestCoupon = {
                code: c.code,
                discount: result.discountValue,
                finalPrice: result.finalPrice,
                discountText: buildDiscountText(c),
                redeemLink: c.code ? undefined : masterLink,
              };
            }
          }
          // Lista TODOS os cupons (com e sem code), marcando eligible pra UI
          allCoupons = coupons.map((c) => {
            const r = applyCoupon(enriched.price ?? 0, {
              code: c.code,
              type: (c.type as 'PERCENT' | 'FIXED') ?? 'PERCENT',
              value: Number(c.value),
              minPurchase: c.minPurchase ? Number(c.minPurchase) : null,
              maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
            });
            const officialFilter = !c.officialOnly || isOfficialMall;
            return {
              code: c.code,
              description: c.description ?? '',
              discountText: buildDiscountText(c),
              minPurchase: c.minPurchase ? Number(c.minPurchase) : null,
              isAuto: !c.code,
              eligible: r.applies && officialFilter,
            };
          });
        }
        return { ok: true, product: enriched, bestCoupon, allCoupons, isOfficialMall };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.post(
    '/import-link/dispatch',
    {
      schema: {
        body: z.object({
          url: z.string().url(),
          priceOverride: z.number().positive().optional(),
          couponOverride: z.string().optional(),
        }),
      },
    },
    async (req) => {
      try {
        const { enrichFromUrl } = await import('@/sources/url_enrich.js');
        const enriched = await enrichFromUrl(req.body.url);
        const finalPrice = req.body.priceOverride ?? enriched.price;
        if (!finalPrice || finalPrice <= 0) {
          return { ok: false, error: 'Preço inválido (zero ou negativo)' };
        }

        const source = await prisma.source.upsert({
          where: { kind: enriched.platform },
          update: {},
          create: { kind: enriched.platform },
        });

        // Cupom Shopee: override > melhor automático > nenhum (Amazon não tem cupom Shopee)
        let couponCode: string | undefined;
        if (enriched.platform === 'SHOPEE') {
          if (req.body.couponOverride === undefined) {
            const activeCoupons = await prisma.shopeeCoupon.findMany({
              where: { enabled: true, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
            });
            const { applyCoupon } = await import('@/dispatcher/format.js');
            let best: { code: string; discount: number } | null = null;
            for (const c of activeCoupons) {
              if (!c.code) continue;
              const r = applyCoupon(finalPrice, {
                code: c.code,
                type: (c.type as 'PERCENT' | 'FIXED') ?? 'PERCENT',
                value: Number(c.value),
                minPurchase: c.minPurchase ? Number(c.minPurchase) : null,
                maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
              });
              if (r.applies && (!best || r.discountValue > best.discount)) {
                best = { code: c.code, discount: r.discountValue };
              }
            }
            couponCode = best?.code;
          } else if (req.body.couponOverride !== '') {
            couponCode = req.body.couponOverride;
          }
        }

        const offer = await prisma.offer.upsert({
          where: {
            sourceId_externalId: { sourceId: source.id, externalId: enriched.externalId },
          },
          create: {
            sourceId: source.id,
            externalId: enriched.externalId,
            title: enriched.title,
            description: enriched.description,
            imageUrl: enriched.imageUrl,
            price: finalPrice,
            originalPrice: enriched.originalPrice,
            discountPct: enriched.discountPct,
            coupon: couponCode,
            rating: enriched.rating,
            ratingCount: enriched.ratingCount,
            salesCount: enriched.salesCount,
            commissionPct: enriched.commissionPct,
            unitPrice: (enriched.raw as { unitPrice?: string } | undefined)?.unitPrice,
            url: enriched.url,
            affiliateUrl: enriched.affiliateUrl,
            score: 0.99,
            raw: {
              ...(enriched.raw as object | undefined),
              importedFrom: 'manual-link-wife',
              enrichSource: enriched.source,
              importedAt: new Date().toISOString(),
            } as object,
            fetchedAt: new Date(),
          },
          update: {
            title: enriched.title,
            description: enriched.description,
            imageUrl: enriched.imageUrl,
            price: finalPrice,
            originalPrice: enriched.originalPrice,
            discountPct: enriched.discountPct,
            coupon: couponCode,
            unitPrice: (enriched.raw as { unitPrice?: string } | undefined)?.unitPrice,
            affiliateUrl: enriched.affiliateUrl,
            score: 0.99,
            fetchedAt: new Date(),
          },
        });

        const campaign = await prisma.campaign.findFirst({
          where: {
            OR: [
              { name: { contains: 'Helena', mode: 'insensitive' } },
              { name: { contains: 'PROMO', mode: 'insensitive' } },
            ],
          },
          include: { channels: true },
        });
        if (!campaign || campaign.channels.length === 0) {
          return {
            ok: false,
            offer: { id: offer.id },
            error: 'Campanha Promo Helena/PROMO não encontrada ou sem canais configurados',
          };
        }

        const dispatchIds: string[] = [];
        for (const channel of campaign.channels) {
          const d = await prisma.dispatch.upsert({
            where: {
              campaignId_offerId_channelId: {
                campaignId: campaign.id,
                offerId: offer.id,
                channelId: channel.id,
              },
            },
            create: {
              campaignId: campaign.id,
              offerId: offer.id,
              channelId: channel.id,
              scheduledFor: new Date(),
            },
            update: { status: 'PENDING', scheduledFor: new Date() },
          });
          await dispatchQueue.add(
            'dispatch',
            { dispatchId: d.id, bypassWindow: true, bypassDailyLimit: true },
            { delay: 0 },
          );
          dispatchIds.push(d.id);
        }

        return {
          ok: true,
          offer: {
            id: offer.id,
            title: offer.title,
            price: Number(offer.price),
            couponApplied: couponCode ?? null,
          },
          dispatchIds,
          campaignName: campaign.name,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // Preview de loja Shopee — lista produtos pra esposa selecionar quais quer enviar.
  // Custo Apify (xtracto/shopee-scraper, pay-per-event):
  //   ~$0.20 start fee + ~$0.015 por produto = $0.50/20prod, $1.00/50prod
  // Batch preview: até 30 URLs Shopee enriquecidas em paralelo (concurrency 5).
  // Cada URL passa pelo enrichShopeeFromUrl (Open API → fallback Apify).
  // Retorna lista de { url, ok, product?, error? } na ordem dos inputs.
  app.post(
    '/import-link/batch-preview',
    {
      schema: {
        body: z.object({
          urls: z.array(z.string().min(8)).min(1).max(30),
        }),
      },
    },
    async (req) => {
      const { enrichFromUrl } = await import('@/sources/url_enrich.js');
      const urls = req.body.urls.map((u) => u.trim()).filter((u) => u.length > 0);
      const concurrency = 5;
      const results: Array<{ url: string; ok: boolean; product?: unknown; error?: string }> = [];
      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const settled = await Promise.all(
          batch.map(async (url) => {
            try {
              const enriched = await enrichFromUrl(url);
              return { url, ok: true, product: enriched };
            } catch (err) {
              return { url, ok: false, error: (err as Error).message };
            }
          }),
        );
        results.push(...settled);
      }
      // Cupons disponíveis pra UI mostrar dropdown
      const coupons = await prisma.shopeeCoupon.findMany({
        where: { enabled: true, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
        orderBy: { code: 'asc' },
      });
      return {
        ok: true,
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        items: results,
        allCoupons: coupons
          .filter((c) => c.code)
          .map((c) => ({ code: c.code as string, description: c.description ?? '' })),
      };
    },
  );

  // Batch dispatch: recebe array de produtos (já enriquecidos no preview) +
  // intervalSec entre cada disparo. Cria Offers + Dispatches escalonados.
  app.post(
    '/import-link/batch-dispatch',
    {
      schema: {
        body: z.object({
          products: z
            .array(
              z.object({
                url: z.string().url(),
                externalId: z.string(),
                title: z.string().min(3),
                imageUrl: z.string().optional(),
                price: z.number().positive(),
                originalPrice: z.number().positive().optional(),
                discountPct: z.number().optional(),
                rating: z.number().optional(),
                salesCount: z.number().int().optional(),
                commissionPct: z.number().optional(),
                affiliateUrl: z.string().url().optional(),
                platform: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'RIACHUELO']).optional().default('SHOPEE'),
                // Flag Shopee Mall propagado do preview pro dispatch — sem isso
                // o cupom officialOnly:true seria filtrado fora indevidamente.
                isOfficialMall: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(30),
          intervalSec: z.number().int().min(60).max(600).default(180),
          couponOverride: z.string().optional(),
        }),
      },
    },
    async (req) => {
      // Pré-cria/recupera sources das plataformas presentes no batch
      const platforms = [...new Set(req.body.products.map((p) => p.platform))];
      const sourceByPlatform: Record<string, { id: string }> = {};
      for (const pl of platforms) {
        const s = await prisma.source.upsert({
          where: { kind: pl },
          update: {},
          create: { kind: pl },
        });
        sourceByPlatform[pl] = s;
      }
      const campaign = await prisma.campaign.findFirst({
        where: {
          OR: [
            { name: { contains: 'Helena', mode: 'insensitive' } },
            { name: { contains: 'PROMO', mode: 'insensitive' } },
          ],
        },
        include: { channels: true },
      });
      if (!campaign || campaign.channels.length === 0) {
        return { ok: false, error: 'Campanha Promo Helena/PROMO não encontrada ou sem canais' };
      }

      const { generateShopeeShortLink } = await import('@/sources/shopee.js');
      const activeCoupons = await prisma.shopeeCoupon.findMany({
        where: { enabled: true, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
      });
      const { applyCoupon } = await import('@/dispatcher/format.js');

      const results: Array<{ externalId: string; ok: boolean; reason?: string; dispatchId?: string }> = [];
      let scheduledOffset = 0;
      for (const p of req.body.products) {
        try {
          const productSource = sourceByPlatform[p.platform];
          // Cupons Shopee só aplicam pra produtos SHOPEE
          let couponCode: string | undefined;
          if (p.platform === 'SHOPEE') {
            if (req.body.couponOverride === undefined) {
              // Filtra cupons officialOnly respeitando o flag Mall propagado do preview.
              const eligibleHere = activeCoupons.filter(
                (c) => !c.officialOnly || p.isOfficialMall,
              );
              let best: { code: string | null; discount: number } | null = null;
              for (const c of eligibleHere) {
                const r = applyCoupon(p.price, {
                  code: c.code,
                  type: (c.type as 'PERCENT' | 'FIXED') ?? 'PERCENT',
                  value: Number(c.value),
                  minPurchase: c.minPurchase ? Number(c.minPurchase) : null,
                  maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
                });
                if (r.applies && (!best || r.discountValue > best.discount)) {
                  best = { code: c.code, discount: r.discountValue };
                }
              }
              // Só seta couponCode se for cupom DIGITÁVEL (com code). Auto-cupons
              // (sem code) são re-resolvidos no dispatch worker via masterLink.
              couponCode = best?.code ?? undefined;
            } else if (req.body.couponOverride !== '') {
              couponCode = req.body.couponOverride;
            }
          }

          // Amazon já vem com tag no affiliateUrl (do enrich); Shopee gera shortlink se faltar;
          // ML hard-fail se vier sem affiliateUrl (preview já bloqueia, isso é só rede de segurança
          // pra não dispatchar permalink puro do ML e perder comissão silenciosamente)
          if (p.platform === 'MERCADOLIVRE' && !p.affiliateUrl) {
            throw new Error(
              `Produto ML ${p.externalId} sem link de afiliado — cookie ML pode ter expirado entre preview e envio. Refaça o preview.`,
            );
          }
          const affiliateUrl =
            p.affiliateUrl ?? (p.platform === 'SHOPEE' ? await generateShopeeShortLink(p.url) : p.url);

          // CRÍTICO: propaga isOfficialMall pro raw. Sem isso, o dispatcher
          // worker (whatsapp.ts) lê raw.isOfficialMall=undefined e filtra
          // fora os cupons officialOnly (ex: 20% OFF Lojas Oficiais).
          const rawObj: Record<string, unknown> = {
            importedFrom: 'batch-link',
            importedAt: new Date().toISOString(),
          };
          if (p.isOfficialMall) rawObj.isOfficialMall = true;

          const offer = await prisma.offer.upsert({
            where: { sourceId_externalId: { sourceId: productSource.id, externalId: p.externalId } },
            create: {
              sourceId: productSource.id,
              externalId: p.externalId,
              title: p.title,
              imageUrl: p.imageUrl,
              price: p.price,
              originalPrice: p.originalPrice,
              discountPct: p.discountPct,
              coupon: couponCode,
              rating: p.rating,
              salesCount: p.salesCount,
              commissionPct: p.commissionPct,
              url: p.url,
              affiliateUrl,
              score: 0.99,
              raw: rawObj as object,
              fetchedAt: new Date(),
            },
            update: {
              title: p.title,
              imageUrl: p.imageUrl,
              price: p.price,
              originalPrice: p.originalPrice,
              discountPct: p.discountPct,
              coupon: couponCode,
              affiliateUrl,
              score: 0.99,
              raw: rawObj as object,
              fetchedAt: new Date(),
            },
          });

          const delaySec = scheduledOffset;
          scheduledOffset += req.body.intervalSec;
          for (const channel of campaign.channels) {
            const d = await prisma.dispatch.upsert({
              where: {
                campaignId_offerId_channelId: {
                  campaignId: campaign.id,
                  offerId: offer.id,
                  channelId: channel.id,
                },
              },
              create: {
                campaignId: campaign.id,
                offerId: offer.id,
                channelId: channel.id,
                scheduledFor: new Date(Date.now() + delaySec * 1000),
              },
              update: {
                status: 'PENDING',
                scheduledFor: new Date(Date.now() + delaySec * 1000),
              },
            });
            await dispatchQueue.add(
              'dispatch',
              { dispatchId: d.id, bypassWindow: true, bypassDailyLimit: true },
              { delay: delaySec * 1000 },
            );
            results.push({ externalId: p.externalId, ok: true, dispatchId: d.id });
          }
        } catch (err) {
          results.push({ externalId: p.externalId, ok: false, reason: (err as Error).message });
        }
      }

      return {
        ok: true,
        scheduled: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        intervalSec: req.body.intervalSec,
        totalSpanSec: scheduledOffset,
        campaignName: campaign.name,
      };
    },
  );

  // Cache em memória 1h por shopName pra evitar re-fetch.
  const shopPreviewCache = new Map<string, { at: number; data: unknown }>();
  const SHOP_CACHE_TTL_MS = 60 * 60 * 1000;
  app.post(
    '/import-shop/preview',
    {
      schema: {
        body: z.object({
          shop: z.string().min(2),
          maxItems: z.number().int().min(5).max(50).optional(),
        }),
      },
    },
    async (req) => {
      try {
        const maxItems = req.body.maxItems ?? 20;
        const cacheKey = `${req.body.shop}:${maxItems}`;
        const cached = shopPreviewCache.get(cacheKey);
        if (cached && Date.now() - cached.at < SHOP_CACHE_TTL_MS) {
          return { ...(cached.data as object), cached: true };
        }
        const { previewShopeeShop } = await import('@/sources/shopee_url_enrich.js');
        const products = await previewShopeeShop(req.body.shop, maxItems);
        const coupons = await prisma.shopeeCoupon.findMany({
          where: {
            enabled: true,
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          },
          orderBy: { code: 'asc' },
        });
        const response = {
          ok: true,
          count: products.length,
          products,
          // Custo aproximado em USD: $0.20 start fee + $0.015 por produto retornado
          estimatedCostUsd: Number((0.2 + products.length * 0.015).toFixed(2)),
          allCoupons: coupons
            .filter((c) => c.code)
            .map((c) => ({ code: c.code as string, description: c.description ?? '' })),
        };
        shopPreviewCache.set(cacheKey, { at: Date.now(), data: response });
        return { ...response, cached: false };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // Dispatch sequencial de N produtos selecionados da loja, espaçados por intervalSec.
  app.post(
    '/import-shop/dispatch',
    {
      schema: {
        body: z.object({
          products: z
            .array(
              z.object({
                externalId: z.string(),
                shopId: z.string().optional(),
                title: z.string().min(3),
                imageUrl: z.string().optional(),
                price: z.number().positive(),
                originalPrice: z.number().positive().optional(),
                discountPct: z.number().optional(),
                rating: z.number().optional(),
                salesCount: z.number().int().optional(),
                commissionPct: z.number().optional(),
                url: z.string().url(),
                affiliateUrl: z.string().url().optional(),
              }),
            )
            .min(1)
            .max(50),
          intervalSec: z.number().int().min(60).max(600).default(180),
          couponOverride: z.string().optional(),
        }),
      },
    },
    async (req) => {
      try {
        const source = await prisma.source.upsert({
          where: { kind: 'SHOPEE' },
          update: {},
          create: { kind: 'SHOPEE' },
        });

        const campaign = await prisma.campaign.findFirst({
          where: {
            OR: [
              { name: { contains: 'Helena', mode: 'insensitive' } },
              { name: { contains: 'PROMO', mode: 'insensitive' } },
            ],
          },
          include: { channels: true },
        });
        if (!campaign || campaign.channels.length === 0) {
          return { ok: false, error: 'Campanha Promo Helena/PROMO não encontrada ou sem canais' };
        }

        const { generateShopeeShortLink } = await import('@/sources/shopee.js');
        const activeCoupons = await prisma.shopeeCoupon.findMany({
          where: {
            enabled: true,
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          },
        });
        const { applyCoupon } = await import('@/dispatcher/format.js');

        const results: Array<{ externalId: string; ok: boolean; reason?: string; dispatchId?: string }> = [];
        let scheduledOffset = 0;
        for (let idx = 0; idx < req.body.products.length; idx++) {
          const p = req.body.products[idx];
          try {
            // Cupom: override > melhor automático
            let couponCode: string | undefined;
            if (req.body.couponOverride === undefined) {
              let best: { code: string; discount: number } | null = null;
              for (const c of activeCoupons) {
                if (!c.code) continue;
                const r = applyCoupon(p.price, {
                  code: c.code,
                  type: (c.type as 'PERCENT' | 'FIXED') ?? 'PERCENT',
                  value: Number(c.value),
                  minPurchase: c.minPurchase ? Number(c.minPurchase) : null,
                  maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
                });
                if (r.applies && (!best || r.discountValue > best.discount)) {
                  best = { code: c.code, discount: r.discountValue };
                }
              }
              couponCode = best?.code;
            } else if (req.body.couponOverride !== '') {
              couponCode = req.body.couponOverride;
            }

            // Usa affiliateUrl já tagueado vindo do preview híbrido (Open API).
            // Fallback: gera shortlink (caso preview legado sem affiliateUrl).
            const affiliateUrl = p.affiliateUrl ?? (await generateShopeeShortLink(p.url));

            const offer = await prisma.offer.upsert({
              where: {
                sourceId_externalId: { sourceId: source.id, externalId: p.externalId },
              },
              create: {
                sourceId: source.id,
                externalId: p.externalId,
                title: p.title,
                imageUrl: p.imageUrl,
                price: p.price,
                originalPrice: p.originalPrice,
                discountPct: p.discountPct,
                coupon: couponCode,
                rating: p.rating,
                salesCount: p.salesCount,
                url: p.url,
                affiliateUrl,
                score: 0.99,
                raw: {
                  importedFrom: 'manual-shop-wife',
                  importedAt: new Date().toISOString(),
                  shopId: p.shopId,
                } as object,
                fetchedAt: new Date(),
              },
              update: {
                title: p.title,
                imageUrl: p.imageUrl,
                price: p.price,
                originalPrice: p.originalPrice,
                discountPct: p.discountPct,
                coupon: couponCode,
                affiliateUrl,
                score: 0.99,
                fetchedAt: new Date(),
              },
            });

            // Enfileira cada dispatch com delay crescente (idx * intervalSec)
            const dispatchIds: string[] = [];
            for (const channel of campaign.channels) {
              const d = await prisma.dispatch.upsert({
                where: {
                  campaignId_offerId_channelId: {
                    campaignId: campaign.id,
                    offerId: offer.id,
                    channelId: channel.id,
                  },
                },
                create: {
                  campaignId: campaign.id,
                  offerId: offer.id,
                  channelId: channel.id,
                  scheduledFor: new Date(Date.now() + scheduledOffset * 1000),
                },
                update: {
                  status: 'PENDING',
                  scheduledFor: new Date(Date.now() + scheduledOffset * 1000),
                },
              });
              await dispatchQueue.add(
                'dispatch',
                { dispatchId: d.id, bypassWindow: true, bypassDailyLimit: true },
                { delay: scheduledOffset * 1000 },
              );
              dispatchIds.push(d.id);
            }
            results.push({
              externalId: p.externalId,
              ok: true,
              dispatchId: dispatchIds[0],
            });
            scheduledOffset += req.body.intervalSec;
          } catch (err) {
            results.push({
              externalId: p.externalId,
              ok: false,
              reason: (err as Error).message,
            });
          }
        }
        const okCount = results.filter((r) => r.ok).length;
        return {
          ok: okCount > 0,
          scheduled: okCount,
          failed: results.length - okCount,
          intervalSec: req.body.intervalSec,
          totalSpanSec: scheduledOffset,
          campaignName: campaign.name,
          results,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // Importa produtos de uma LOJA específica via Apify (renderiza JS do SPA Shopee).
  // V1 da API afiliada foi deprecada e V2 não filtra por loja, então scraping é
  // a única opção. Apify usa Chrome headless + proxy pra evitar bot detection.
  // Pra cada produto encontrado: gera shortlink afiliado e cria Offer no DB.
  app.post(
    '/sources/SHOPEE/import-shop',
    {
      schema: {
        body: z.object({
          shop: z.string().min(2), // username (mundo.kidssc) ou shopId (374807007)
          maxItems: z.number().int().min(10).max(2000).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { shop, maxItems = 200 } = req.body;
      // Pega o token do settings/marketplaces
      const cfg = await getSettingsSection<{ apifyToken?: string }>('marketplaces');
      const token = cfg.apifyToken?.trim();
      if (!token) {
        return reply.code(400).send({
          error: 'Apify token não configurado. Vá em /settings → Marketplaces → Apify Token',
        });
      }
      const offers = await fetchShopeeShopViaApify(shop, token, maxItems);
      // Acha source SHOPEE pra associar
      const source = await prisma.source.findUnique({ where: { kind: 'SHOPEE' } });
      if (!source) return { imported: 0, error: 'Source SHOPEE não cadastrada' };
      let inserted = 0;
      for (const o of offers) {
        try {
          await prisma.offer.upsert({
            where: {
              sourceId_externalId: { sourceId: source.id, externalId: o.externalId },
            },
            create: {
              sourceId: source.id,
              externalId: o.externalId,
              title: o.title,
              description: null,
              imageUrl: o.imageUrl,
              price: o.price,
              originalPrice: o.originalPrice,
              discountPct: o.discountPct,
              category: o.category,
              url: o.url,
              affiliateUrl: o.affiliateUrl,
              commissionPct: o.commissionPct,
              rating: o.rating,
              ratingCount: o.ratingCount,
              salesCount: o.salesCount,
              raw: (o.raw ?? {}) as object,
              fetchedAt: new Date(),
              score: 0.7, // score default p/ produtos curados de loja parceira
            },
            update: {
              title: o.title,
              imageUrl: o.imageUrl,
              price: o.price,
              affiliateUrl: o.affiliateUrl,
              fetchedAt: new Date(),
            },
          });
          inserted++;
        } catch (err) {
          logger.warn({ err, externalId: o.externalId }, 'shop import: upsert falhou');
        }
      }
      return { imported: inserted, totalFromApi: offers.length, shop };
    },
  );

  // Busca ad-hoc Shopee — análogo ao ML search-by-category. Retorna lista
  // de produtos pra preview na UI; quando autoImport=true, cria offers no DB.
  app.post(
    '/sources/SHOPEE/search-by-category',
    {
      schema: {
        body: z.object({
          categoryId: z.number().int().optional(),
          keyword: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional(),
          onlyMall: z.boolean().optional(),
          onlyKeySellers: z.boolean().optional(),
          autoImport: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { fetchShopeeProducts } = await import('@/sources/shopee.js');
      const products = await fetchShopeeProducts({
        keyword: req.body.keyword,
        productCatId: req.body.categoryId,
        limit: req.body.limit ?? 20,
        sortType: 2, // bestseller
        onlyMall: req.body.onlyMall,
        onlyKeySellers: req.body.onlyKeySellers,
      });
      if (!req.body.autoImport) {
        return { found: products.length, products };
      }
      // Auto-import: igual flow do worker fetch (sem dedup com cron)
      const source = await prisma.source.upsert({
        where: { kind: 'SHOPEE' },
        update: {},
        create: { kind: 'SHOPEE' },
      });
      const offerIds: string[] = [];
      for (const p of products) {
        if (!p.affiliateUrl) continue;
        const offer = await prisma.offer.upsert({
          where: { sourceId_externalId: { sourceId: source.id, externalId: p.externalId } },
          create: {
            sourceId: source.id,
            externalId: p.externalId,
            title: p.title,
            imageUrl: p.imageUrl,
            price: p.price,
            originalPrice: p.originalPrice,
            discountPct: p.discountPct,
            url: p.url,
            affiliateUrl: p.affiliateUrl,
            commissionPct: p.commissionPct,
            rating: p.rating,
            salesCount: p.salesCount,
            category: p.category,
            score: scoreOffer({
              discountPct: p.discountPct ?? null,
              rating: p.rating ?? null,
              ratingCount: null,
              salesCount: p.salesCount ?? null,
              commissionPct: p.commissionPct ?? null,
            }),
            raw: (p.raw ?? {}) as object,
          },
          update: {
            title: p.title,
            imageUrl: p.imageUrl,
            price: p.price,
            originalPrice: p.originalPrice,
            discountPct: p.discountPct,
            affiliateUrl: p.affiliateUrl,
            fetchedAt: new Date(),
          },
        });
        offerIds.push(offer.id);
      }
      return { found: products.length, imported: offerIds.length, offerIds, products };
    },
  );

  app.post(
    '/sources/SHOPEE/validate-cookie',
    async () => {
      const health = await validateShopeeCookie();
      await prisma.source.upsert({
        where: { kind: 'SHOPEE' },
        update: { cookieHealth: health, cookieValidatedAt: new Date() },
        create: { kind: 'SHOPEE', cookieHealth: health, cookieValidatedAt: new Date() },
      });
      return health;
    },
  );

  app.post(
    '/sources/MERCADOLIVRE/validate-cookie',
    async () => {
      const health = await validateMercadoLivreCookie();
      await prisma.source.upsert({
        where: { kind: 'MERCADOLIVRE' },
        update: { cookieHealth: health, cookieValidatedAt: new Date() },
        create: { kind: 'MERCADOLIVRE', cookieHealth: health, cookieValidatedAt: new Date() },
      });
      return health;
    },
  );

  app.post(
    '/sources/MERCADOLIVRE/search-by-category',
    {
      schema: {
        body: z.object({
          categoryId: z.string().min(1),
          subCategoryId: z.string().optional(),
          bestSellersOnly: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          autoImport: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const args = {
        categoryId: req.body.categoryId,
        subCategoryId: req.body.subCategoryId,
        bestSellersOnly: req.body.bestSellersOnly,
        limit: req.body.limit,
      };
      // autoImport=true gera shortlink de afiliado pra cada produto (paridade
      // Divulga Links). Sem autoImport, só faz a busca rápida (sem chamar o
      // endpoint de geração — útil pra preview de catálogo).
      const products = req.body.autoImport
        ? await searchAndAffiliateByCategory(args, { maxAffiliated: req.body.limit ?? 50 })
        : await searchMercadoLivreByCategory(args);
      if (!req.body.autoImport) {
        return { found: products.length, products };
      }
      const source = await prisma.source.upsert({
        where: { kind: 'MERCADOLIVRE' },
        update: {},
        create: { kind: 'MERCADOLIVRE' },
      });
      // Pré-carrega cupons ativos pra match rápido O(1) por seller name.
      // Match é case-insensitive (vendor name pode vir capitalizado diferente
      // entre /afiliados/coupons e o polycard).
      const activeCoupons = await prisma.mlCoupon.findMany({
        where: { enabled: true, status: 'ACTIVE', alias: { not: null } },
      });
      // Normalização agressiva: lowercase + remove diacríticos + remove
      // não-alfanuméricos. Garante que "Profit_laboratorios" do cupom case
      // com "profit laboratórios" / "PROFIT LABORATORIOS" do polycard.
      const norm = (s: string): string =>
        s
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]/g, '');
      const couponBySeller = new Map(activeCoupons.map((c) => [norm(c.seller), c]));
      const offerIds: string[] = [];
      let couponsApplied = 0;
      for (const p of products) {
        if (!p.affiliateUrl) continue;
        // Aplica cupom se vendedor da oferta tem cupom ativo associado.
        // Se não bater, deixa coupon=null e a oferta vai sem desconto extra.
        const matchedCoupon = p.seller ? couponBySeller.get(norm(p.seller)) : undefined;
        if (matchedCoupon) couponsApplied++;
        const offer = await prisma.offer.upsert({
          where: { sourceId_externalId: { sourceId: source.id, externalId: p.externalId } },
          create: {
            sourceId: source.id,
            externalId: p.externalId,
            title: p.title,
            imageUrl: p.imageUrl,
            price: p.price,
            originalPrice: p.originalPrice,
            discountPct: p.discountPct,
            category: p.category,
            url: p.url,
            affiliateUrl: p.affiliateUrl,
            coupon: matchedCoupon?.alias ?? null,
            score: scoreOffer({
              discountPct: p.discountPct ?? null,
              rating: null,
              ratingCount: null,
              salesCount: p.isBestSeller ? 1000 : null,
              commissionPct: null,
            }),
            raw: { panelSearch: true, isBestSeller: p.isBestSeller, seller: p.seller } as object,
          },
          update: {
            title: p.title,
            imageUrl: p.imageUrl,
            price: p.price,
            originalPrice: p.originalPrice,
            discountPct: p.discountPct,
            affiliateUrl: p.affiliateUrl,
            coupon: matchedCoupon?.alias ?? undefined,
            fetchedAt: new Date(),
          },
        });
        offerIds.push(offer.id);
      }
      app.log.info(
        { found: products.length, imported: offerIds.length, couponsApplied, activeCoupons: activeCoupons.length },
        'ml search-by-category upsert done',
      );
      // Retorna products também pra UI mostrar preview (lista + badges)
      return { found: products.length, imported: offerIds.length, offerIds, products };
    },
  );

  // ===========================================================================
  // CUPONS DO PROGRAMA DE AFILIADOS ML
  // ===========================================================================
  // Fluxo:
  //   1) GET  /sources/MERCADOLIVRE/coupons/sync     → scrape ML + upsert no DB
  //   2) GET  /sources/MERCADOLIVRE/coupons          → lista do nosso DB
  //   3) POST /sources/MERCADOLIVRE/coupons/:id/generate { code }
  //                                                  → gera alias no ML + salva
  //   4) PATCH /sources/MERCADOLIVRE/coupons/:id { enabled }
  //                                                  → toggle local
  //
  // Cron diário (cron/index.ts) chama (1) pra refrescar remainingBudget e
  // marcar EXPIRED quando data passa ou orçamento zera.

  app.get('/sources/MERCADOLIVRE/coupons', async () => {
    return prisma.mlCoupon.findMany({
      orderBy: [{ status: 'asc' }, { remainingBudget: 'desc' }],
    });
  });

  app.post('/sources/MERCADOLIVRE/coupons/sync', async (_req, reply) => {
    try {
      const [available, generated] = await Promise.all([
        listAvailableCoupons(),
        listGeneratedCoupons().catch(() => [] as Awaited<ReturnType<typeof listGeneratedCoupons>>),
      ]);
      const generatedById = new Map(generated.map((g) => [g.id, g]));
      let upserted = 0;
      for (const c of available.coupons) {
        const gen = generatedById.get(c.id);
        const status = gen
          ? gen.status === 'ACTIVE' && c.remaining_budget <= 0
            ? 'EXHAUSTED'
            : gen.status
          : new Date(c.expiration_date) < new Date()
            ? 'EXPIRED'
            : 'AVAILABLE';
        await prisma.mlCoupon.upsert({
          where: { mlCouponId: c.id },
          create: {
            mlCouponId: c.id,
            alias: gen?.alias,
            prefix: available.prefix,
            title: c.title,
            seller: c.seller,
            category: c.category,
            remainingBudget: c.remaining_budget,
            expirationDate: new Date(c.expiration_date),
            status,
            lastSyncedAt: new Date(),
          },
          update: {
            alias: gen?.alias ?? undefined,
            prefix: available.prefix,
            title: c.title,
            seller: c.seller,
            remainingBudget: c.remaining_budget,
            expirationDate: new Date(c.expiration_date),
            status,
            lastSyncedAt: new Date(),
          },
        });
        upserted++;
      }
      return { prefix: available.prefix, upserted, generated: generated.length };
    } catch (err) {
      if (err instanceof MercadoLivrePanelError) {
        return reply.code(400).send({ error: err.message, kind: err.kind });
      }
      throw err;
    }
  });

  app.post(
    '/sources/MERCADOLIVRE/coupons/:id/generate',
    {
      schema: {
        params: z.object({ id: z.string() }),
        // ML rejeita sufixos > 10 chars com "Invalid values in body object".
        // Regex aceita só A-Z + 0-9. min 3 evita códigos genéricos demais.
        body: z.object({ code: z.string().min(3).max(10).regex(/^[A-Z0-9]+$/) }),
      },
    },
    async (req, reply) => {
      const local = await prisma.mlCoupon.findUnique({ where: { id: req.params.id } });
      if (!local) return reply.code(404).send({ error: 'cupom não encontrado' });
      if (local.alias) return reply.code(409).send({ error: `cupom já gerado: ${local.alias}` });
      try {
        const { alias } = await generateMlCouponCode({
          couponId: local.mlCouponId,
          code: req.body.code.toUpperCase(),
        });
        return prisma.mlCoupon.update({
          where: { id: req.params.id },
          data: {
            alias,
            code: req.body.code.toUpperCase(),
            status: 'ACTIVE',
          },
        });
      } catch (err) {
        if (err instanceof MercadoLivrePanelError) {
          return reply
            .code(err.kind === 'conflict' ? 409 : 400)
            .send({ error: err.message, kind: err.kind });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/sources/MERCADOLIVRE/coupons/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (req) => {
      return prisma.mlCoupon.update({
        where: { id: req.params.id },
        data: { enabled: req.body.enabled },
      });
    },
  );

  // Gera AUTOMATICAMENTE códigos pra todos os cupons disponíveis sem alias.
  // Sufixo padrão = defaultCouponSuffix(title) = "RADAR" + valor numérico.
  // Throttle 2-4s entre chamadas pra parecer humano. Skipa silenciosamente:
  //   - Conflict (409 — sufixo duplicado pra esse cupom)
  //   - Auth fail no meio → para tudo (cookie expirou)
  app.post('/sources/MERCADOLIVRE/coupons/auto-generate', async (_req, reply) => {
    const candidates = await prisma.mlCoupon.findMany({
      where: { alias: null, status: 'AVAILABLE', enabled: true },
      orderBy: { remainingBudget: 'desc' },
    });
    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: { title: string; reason: string }[] = [];
    for (const c of candidates) {
      const code = defaultCouponSuffix(c.title);
      try {
        const { alias } = await generateMlCouponCode({ couponId: c.mlCouponId, code });
        await prisma.mlCoupon.update({
          where: { id: c.id },
          data: { alias, code, status: 'ACTIVE' },
        });
        generated++;
        await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
      } catch (err) {
        if (err instanceof MercadoLivrePanelError) {
          if (err.kind === 'auth') {
            return reply.code(503).send({
              error: 'Cookie ML expirou — re-valide em /sources/mercadolivre/cookie',
              generated,
              skipped,
              failed,
              errors,
            });
          }
          if (err.kind === 'conflict') {
            skipped++;
            continue;
          }
        }
        failed++;
        errors.push({
          title: c.title,
          reason: err instanceof Error ? err.message.slice(0, 100) : String(err),
        });
      }
    }
    return { total: candidates.length, generated, skipped, failed, errors };
  });

  // Gerador genérico de shortlink Shopee: pega QUALQUER URL Shopee e devolve
  // shortlink encurtado com seu affiliate ID. Equivale ao "criador de links"
  // do painel oficial. Útil pra:
  //   - Página de cupons: /m/cupom-de-desconto
  //   - Promo flash específica de loja
  //   - Coleção/campanha curada manualmente
  //   - Produto avulso que não tá no catálogo automático
  app.post(
    '/sources/SHOPEE/short-link',
    {
      schema: {
        body: z.object({
          originUrl: z.string().url(),
          subIds: z.array(z.string().max(50)).max(5).optional(),
        }),
      },
    },
    async (req) => {
      const { generateShopeeShortLink } = await import('@/sources/shopee.js');
      const shortLink = await generateShopeeShortLink(req.body.originUrl, req.body.subIds ?? []);
      return { shortLink, originUrl: req.body.originUrl, subIds: req.body.subIds ?? [] };
    },
  );

  // Gera shortlink Shopee da página de cupons já tageado com seu affiliate ID.
  // Equivale ao link "APROVEITA E RESGATA AQUI" que outros grupos divulgam —
  // qualquer cupom que o usuário pegue + use → comissão pra você.
  //
  // Uso típico: divulga 1-2x/dia no grupo (manual ou via post recorrente).
  // Body opcional `{ subIds: ["grupo1"] }` permite tracking por canal.
  app.post(
    '/sources/SHOPEE/coupon-page-shortlink',
    {
      schema: {
        body: z
          .object({
            subIds: z.array(z.string().max(50)).max(5).optional(),
          })
          .optional(),
      },
    },
    async (req) => {
      const { generateShopeeShortLink } = await import('@/sources/shopee.js');
      const subIds = (req.body as { subIds?: string[] } | undefined)?.subIds ?? [];
      const COUPON_PAGE = 'https://shopee.com.br/m/cupom-de-desconto';
      const shortLink = await generateShopeeShortLink(COUPON_PAGE, subIds);
      return { shortLink, originUrl: COUPON_PAGE, subIds };
    },
  );

  // ===========================================================================
  // CUPONS SHOPEE (cadastro manual — Open API não expõe)
  // ===========================================================================
  // Doc oficial Shopee: cupons vêm via App/Email/Portal afiliado, não API.
  // User cola aqui os códigos que recebe. Sistema faz match automático com
  // offer.raw.seller no momento do fetch SHOPEE.
  app.get('/sources/SHOPEE/coupons', async () => {
    return prisma.shopeeCoupon.findMany({ orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }] });
  });

  app.post(
    '/sources/SHOPEE/coupons',
    {
      schema: {
        body: z.object({
          code: z.string().min(3).max(40).optional(),
          description: z.string().max(200).optional(),
          type: z.enum(['PERCENT', 'FIXED']).default('PERCENT'),
          value: z.number().min(0).max(10000),
          minPurchase: z.number().min(0).optional(),
          maxDiscount: z.number().min(0).optional(),
          seller: z.string().max(100).optional(),
          discountText: z.string().max(80).optional(),
          imageUrl: z.string().url().optional(),
          validUntil: z.string().datetime().optional(),
          officialOnly: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const code = req.body.code ? req.body.code.toUpperCase() : null;
      const data = {
        code,
        description: req.body.description,
        type: req.body.type,
        value: req.body.value,
        minPurchase: req.body.minPurchase,
        maxDiscount: req.body.maxDiscount,
        seller: req.body.seller,
        discountText: req.body.discountText,
        imageUrl: req.body.imageUrl,
        validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
        officialOnly: req.body.officialOnly ?? false,
      };
      // Upsert por code SE tiver code; senão sempre cria novo (cupons automáticos
      // sem code não dedupam — múltiplos auto-coupons podem coexistir).
      if (code) {
        return prisma.shopeeCoupon.upsert({
          where: { code },
          create: data,
          update: data,
        });
      }
      return prisma.shopeeCoupon.create({ data });
    },
  );

  app.patch(
    '/sources/SHOPEE/coupons/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (req) =>
      prisma.shopeeCoupon.update({ where: { id: req.params.id }, data: { enabled: req.body.enabled } }),
  );

  // Bulk-create de cupons Shopee a partir de array já parseado (do frontend
  // depois do usuário escolher quais incluir no preview). Mais flexível que
  // parse-and-create porque permite seleção parcial.
  app.post(
    '/sources/SHOPEE/coupons/bulk-create',
    {
      schema: {
        body: z.object({
          validUntil: z.string().datetime(),
          items: z.array(
            z.object({
              title: z.string(),
              type: z.enum(['PERCENT', 'FIXED']),
              value: z.number().min(0),
              minPurchase: z.number().nullable().optional(),
              maxDiscount: z.number().nullable().optional(),
              discountText: z.string(),
              officialOnly: z.boolean(),
            }),
          ).min(1).max(50),
        }),
      },
    },
    async (req) => {
      const created: Array<{ id: string; title: string; discountText: string }> = [];
      const failed: Array<{ title: string; error: string }> = [];
      const validUntil = new Date(req.body.validUntil);
      for (const it of req.body.items) {
        try {
          const c = await prisma.shopeeCoupon.create({
            data: {
              code: null,
              description: `${it.title}: ${it.discountText}${it.minPurchase ? ` (min R$${it.minPurchase})` : ''}`,
              type: it.type,
              value: it.value,
              minPurchase: it.minPurchase ?? null,
              maxDiscount: it.maxDiscount ?? null,
              discountText: it.discountText,
              validUntil,
              officialOnly: it.officialOnly,
            },
          });
          created.push({ id: c.id, title: it.title, discountText: it.discountText });
        } catch (err) {
          failed.push({ title: it.title, error: (err as Error).message });
        }
      }
      return { created: created.length, failed: failed.length, items: created, errors: failed };
    },
  );

  // Parser de página de cupons da Shopee — esposa cola o texto inteiro da
  // página /afiliados/coupons (ou similar) e sistema identifica os cupons,
  // mostra preview (dry-run) ou cria em massa.
  //
  // Formato esperado (blocos separados por linhas em branco):
  //   <CATEGORIA TÍTULO>
  //   <VALOR (R$X OFF ou X% OFF ou X% DE CASHBACK)>
  //   Nas compras acima de R$X
  //   [Limitado a R$X]
  //   [Oficial]
  //   Condições
  //   <STATUS: Eu quero / Esgotado / Resgatado>
  //
  // Pula: esgotados, resgatados, categorias específicas (MODA/CASA/etc),
  // gift cards. Cadastra: "Todas as Lojas" + "Lojas Oficiais" genérico.
  app.post(
    '/sources/SHOPEE/coupons/parse-and-create',
    {
      schema: {
        body: z.object({
          rawText: z.string().min(20),
          validUntil: z.string().datetime(),
          dryRun: z.boolean().optional().default(false),
        }),
      },
    },
    async (req) => {
      type ParsedItem = {
        action: 'create' | 'skip';
        reason?: string;
        title: string;
        type: 'PERCENT' | 'FIXED';
        value: number;
        minPurchase: number | null;
        maxDiscount: number | null;
        officialOnly: boolean;
        discountText: string;
        status: string;
      };

      // Universais — sempre cadastra
      const ALLOWED_EXACT = ['TODAS AS LOJAS', 'LOJAS OFICIAIS'];
      const ALLOWED_PREFIXES = ['CUPOM RELÂMPAGO', 'CUPOM RELAMPAGO', 'PROMO RELÂMPAGO'];
      // Categorias específicas — sempre pula (não temos matching de categoria)
      const CATEGORY_DENY = [
        'MODA', 'MODA OFICIAL', 'CASA E DECORAÇÃO', 'CASA E DECORAÇÃO OFICIAL',
        'MÓVEIS', 'MÓVEIS OFICIAL', 'CONSTRUÇÃO E FERRAMENTAS',
        'CONSTRUÇÃO E FERRAMENTAS OFICIAL', 'TECNOLOGIA', 'TECNOLOGIA OFICIAL',
        'AUTOMÓVEIS E MOTOCICLETAS', 'AUTOMÓVEIS E MOTOCICLETAS OFICIAL',
        'BELEZA', 'BELEZA OFICIAL', 'ESSENCIAIS', 'ESSENCIAIS OFICIAL',
        'CUPOM SHOPEE DOAÇÕES', 'CUPOM',
      ];
      const GIFT_CARD_PREFIX = 'GIFT CARD';

      const parseValue = (line: string): { type: 'PERCENT' | 'FIXED'; value: number } | null => {
        // "R$30 OFF", "R$ 30 OFF", "30% OFF", "30% DE CASHBACK"
        const fixed = line.match(/^R\$\s?(\d+(?:,\d+)?)\s+OFF/i);
        if (fixed) return { type: 'FIXED', value: Number(fixed[1].replace(',', '.')) };
        const pct = line.match(/^(\d+(?:,\d+)?)\s?%/);
        if (pct) return { type: 'PERCENT', value: Number(pct[1].replace(',', '.')) };
        return null;
      };

      const parseMinPurchase = (text: string): number | null => {
        // "Nas compras acima de R$199" / "Nas compras acima de R$1,5mil"
        const m = text.match(/acima de R\$\s?([\d,.]+)(mil)?/i);
        if (!m) return null;
        let n = Number(m[1].replace(/\./g, '').replace(',', '.'));
        if (m[2]?.toLowerCase() === 'mil') n *= 1000;
        return n;
      };

      const parseMaxDiscount = (text: string): number | null => {
        // "Limitado a R$20" / "Limitado a R$10 (cashback)"
        const m = text.match(/Limitado a R\$\s?(\d+(?:,\d+)?)/i);
        return m ? Number(m[1].replace(',', '.')) : null;
      };

      // Pre-processamento: remove HEADER + FOOTER da página Shopee.
      // Header tem coisas tipo "Carrinho", "Buscar na Shopee", "Lojas Oficiais"
      // como section title. Footer começa quando aparece "Cupons de Desconto:"
      // ou similar (área de texto institucional). Tudo após = lixo.
      let cleanText = req.body.rawText;
      const footerCutoff = cleanText.search(
        /Cupons de Desconto:|Como conseguir cupons|ATENDIMENTO AO CLIENTE|© \d{4} Shopee/i,
      );
      if (footerCutoff > 0) cleanText = cleanText.slice(0, footerCutoff);

      // Section markers — separam grupos mas NÃO são cupons.
      const SECTION_MARKERS = ['Lojas Oficiais', 'Cupons', 'Gift Cards'];
      const isSectionMarker = (l: string): boolean =>
        SECTION_MARKERS.some((m) => l.trim().toLowerCase() === m.toLowerCase());

      // Parser stateful linha-a-linha:
      // - Pula section markers
      // - Detecta início de bloco quando vê linha em CAIXA ALTA
      // - Bloco termina quando encontra status (Eu quero/Esgotado/Resgatado)
      //   OU próxima linha em CAIXA ALTA OU section marker OU EOF
      const STATUS_REGEX = /^(Eu quero|Esgotado|Resgatado)$/i;
      // Título é CAIXA ALTA, tem letra, NÃO tem dígito nem $ nem % (pra não
      // capturar "R$20 OFF" ou "30%" como título de bloco). Mín 3 chars.
      const isTitleLine = (l: string): boolean =>
        l.length >= 3 &&
        l === l.toUpperCase() &&
        /[A-Z]/.test(l) &&
        !/[\d$%]/.test(l) &&
        !STATUS_REGEX.test(l);

      const allLines = cleanText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      // Agrupa em blocos: cada bloco começa numa linha de título (CAIXA ALTA)
      // e termina quando encontra status OU próximo título OU section marker
      const blocks: string[][] = [];
      let current: string[] | null = null;
      for (const line of allLines) {
        if (isSectionMarker(line)) {
          if (current) { blocks.push(current); current = null; }
          continue;
        }
        if (isTitleLine(line)) {
          if (current) blocks.push(current);
          current = [line];
        } else if (current) {
          current.push(line);
          if (STATUS_REGEX.test(line)) {
            blocks.push(current);
            current = null;
          }
        }
      }
      if (current) blocks.push(current);

      const parsed: ParsedItem[] = [];

      for (const lines of blocks) {
        if (lines.length < 3) continue;

        const title = lines[0];

        // Status: procura linha que match STATUS_REGEX (não necessariamente a última)
        const statusLine = lines.find((l) => STATUS_REGEX.test(l));
        const status = statusLine ?? lines[lines.length - 1];
        const isActive = /^Eu quero$/i.test(status);
        const isSoldOut = /^(Esgotado|Resgatado)$/i.test(status);

        // Valor (linha após o título)
        const valueLine = lines[1];
        const parsedValue = parseValue(valueLine);
        if (!parsedValue) continue;

        // Min/max — procurar em todas as linhas restantes
        const restText = lines.slice(2).join(' ');
        const minPurchase = parseMinPurchase(restText);
        const maxDiscount = parseMaxDiscount(restText);
        const officialOnly = /Oficial/i.test(restText) || title.endsWith('OFICIAL');

        // Decide ação
        let action: 'create' | 'skip' = 'create';
        let reason: string | undefined;

        if (isSoldOut) {
          action = 'skip';
          reason = 'esgotado/resgatado';
        } else if (!isActive) {
          action = 'skip';
          reason = `status desconhecido: ${status}`;
        } else if (title.startsWith(GIFT_CARD_PREFIX)) {
          action = 'skip';
          reason = 'gift card (produto específico)';
        } else if (CATEGORY_DENY.includes(title)) {
          action = 'skip';
          reason = 'categoria específica (sem matching no sistema)';
        } else if (
          !ALLOWED_EXACT.includes(title) &&
          !ALLOWED_PREFIXES.some((p) => title.startsWith(p))
        ) {
          action = 'skip';
          reason = `título não reconhecido: ${title} (marcar manualmente se for universal)`;
        }

        // discountText pra mensagem WhatsApp
        const discountText =
          parsedValue.type === 'FIXED'
            ? `R$${Math.round(parsedValue.value)} OFF`
            : maxDiscount
              ? `${parsedValue.value}% OFF (max R$${Math.round(maxDiscount)})`
              : `${parsedValue.value}% OFF`;

        parsed.push({
          action,
          reason,
          title,
          type: parsedValue.type,
          value: parsedValue.value,
          minPurchase,
          maxDiscount,
          officialOnly,
          discountText: officialOnly ? `${discountText} Lojas Oficiais` : discountText,
          status,
        });
      }

      // Dry-run: só retorna preview
      if (req.body.dryRun) {
        return {
          parsed,
          summary: {
            total: parsed.length,
            toCreate: parsed.filter((p) => p.action === 'create').length,
            toSkip: parsed.filter((p) => p.action === 'skip').length,
          },
        };
      }

      // Commit: cria os com action='create'
      const created: Array<{ id: string; discountText: string }> = [];
      const skipped: Array<{ title: string; reason: string }> = [];
      for (const p of parsed) {
        if (p.action === 'skip') {
          skipped.push({ title: p.title, reason: p.reason ?? '' });
          continue;
        }
        try {
          const c = await prisma.shopeeCoupon.create({
            data: {
              code: null,
              description: `${p.title}: ${p.discountText}${p.minPurchase ? ` (min R$${p.minPurchase})` : ''}`,
              type: p.type,
              value: p.value,
              minPurchase: p.minPurchase,
              maxDiscount: p.maxDiscount,
              discountText: p.discountText,
              validUntil: new Date(req.body.validUntil),
              officialOnly: p.officialOnly,
            },
          });
          created.push({ id: c.id, discountText: p.discountText });
        } catch (err) {
          skipped.push({
            title: p.title,
            reason: `erro ao criar: ${(err as Error).message}`,
          });
        }
      }

      return {
        parsed,
        summary: {
          total: parsed.length,
          created: created.length,
          skipped: skipped.length,
        },
        created,
        skipped,
      };
    },
  );

  app.delete(
    '/sources/SHOPEE/coupons/:id',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req) => {
      await prisma.shopeeCoupon.delete({ where: { id: req.params.id } });
      return { deleted: true };
    },
  );

  // ===========================================================================
  // CUPONS AMAZON — tabela própria, suporta N cupons simultâneos.
  // Dispatcher escolhe o de MAIOR desconto válido pra cada produto.
  // ===========================================================================
  app.get('/sources/AMAZON/coupons', async () =>
    prisma.amazonCoupon.findMany({ orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }] }),
  );

  app.post(
    '/sources/AMAZON/coupons',
    {
      schema: {
        body: z.object({
          code: z.string().min(3).max(40),
          description: z.string().max(200).optional(),
          type: z.enum(['PERCENT', 'FIXED']).default('PERCENT'),
          value: z.number().min(0).max(10000),
          minPurchase: z.number().min(0).optional(),
          maxDiscount: z.number().min(0).optional(),
          discountText: z.string().max(80).optional(),
          instructionText: z.string().max(80).optional(),
          validUntil: z.string().datetime().optional(),
        }),
      },
    },
    async (req) => {
      const code = req.body.code.toUpperCase();
      const data = {
        code,
        description: req.body.description,
        type: req.body.type,
        value: req.body.value,
        minPurchase: req.body.minPurchase,
        maxDiscount: req.body.maxDiscount,
        discountText: req.body.discountText,
        instructionText: req.body.instructionText,
        validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
      };
      // Upsert por code — recadastrar mesmo code atualiza
      return prisma.amazonCoupon.upsert({ where: { code }, create: data, update: data });
    },
  );

  app.patch(
    '/sources/AMAZON/coupons/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (req) =>
      prisma.amazonCoupon.update({ where: { id: req.params.id }, data: { enabled: req.body.enabled } }),
  );

  app.delete(
    '/sources/AMAZON/coupons/:id',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req) => {
      await prisma.amazonCoupon.delete({ where: { id: req.params.id } });
      return { deleted: true };
    },
  );

  // Dispara post dedicado de "alerta de cupom" no canal escolhido. Estilo
  // de grupos brasileiros (achadinhoo_do_bebe). Gera shortlink da página
  // de cupons + monta template formatCouponAlert + manda via Evolution.
  app.post(
    '/sources/SHOPEE/coupons/:id/dispatch',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ channelId: z.string() }),
      },
    },
    async (req, reply) => {
      const coupon = await prisma.shopeeCoupon.findUnique({ where: { id: req.params.id } });
      if (!coupon) return reply.code(404).send({ error: 'cupom não encontrado' });
      const channel = await prisma.channel.findUnique({ where: { id: req.body.channelId } });
      if (!channel?.whatsappGroupId) {
        return reply.code(400).send({ error: 'canal sem whatsappGroupId' });
      }
      if (!coupon.code) {
        return reply.code(400).send({
          error: 'Cupom sem code não pode ser disparado como alerta (é automático no checkout)',
        });
      }
      const { generateShopeeShortLink } = await import('@/sources/shopee.js');
      const { formatCouponAlert } = await import('@/dispatcher/format.js');
      const { evolution } = await import('@/lib/evolution.js');
      let shortLink: string | null = null;
      try {
        shortLink = await generateShopeeShortLink('https://shopee.com.br/m/cupom-de-desconto', [
          coupon.code,
        ]);
      } catch (err) {
        app.log.warn({ err }, 'failed to generate shortlink for coupon alert');
      }
      const text = formatCouponAlert({
        code: coupon.code,
        discountText: coupon.discountText,
        description: coupon.description,
        validUntil: coupon.validUntil,
        shortLink,
      });
      const delayMs = 3000 + Math.floor(Math.random() * 5000); // typing 3-8s
      // Se tem imagem cadastrada, manda como mídia (caption) — mais visual.
      // Senão, texto puro. Evolution já cuida do typing presence durante delay.
      const result = coupon.imageUrl
        ? await evolution.sendMedia({
            instance: channel.evolutionInstance ?? undefined,
            to: channel.whatsappGroupId,
            mediaUrl: coupon.imageUrl,
            mediaType: 'image',
            caption: text,
            delayMs,
          })
        : await evolution.sendText({
            instance: channel.evolutionInstance ?? undefined,
            to: channel.whatsappGroupId,
            text,
            delayMs,
          });
      return {
        sent: true,
        text,
        withImage: Boolean(coupon.imageUrl),
        externalMsgId: (result as { key?: { id?: string } })?.key?.id,
      };
    },
  );

  // ===========================================================================
  // NICHOS — preset reutilizável de filtros pra atribuir a 1+ campanhas
  // ===========================================================================
  app.get('/niches', async () =>
    prisma.niche.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { campaigns: true } } },
    }),
  );

  app.post(
    '/niches',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(60),
          description: z.string().max(200).optional(),
          icon: z.string().max(8).optional(), // emoji curto
          filters: z
            .object({
              categoryIds: z
                .object({
                  SHOPEE: z.array(z.string()).optional(),
                  MERCADOLIVRE: z.array(z.string()).optional(),
                  AMAZON: z.array(z.string()).optional(),
                  PROMOBIT: z.array(z.string()).optional(),
                })
                .optional(),
              keywords: z.array(z.string()).optional(),
              minDiscount: z.number().min(0).max(100).optional(),
              minScore: z.number().min(0).max(1).optional(),
              maxPrice: z.number().min(0).optional(),
            })
            .optional(),
        }),
      },
    },
    async (req) => {
      return prisma.niche.create({
        data: {
          name: req.body.name,
          description: req.body.description,
          icon: req.body.icon,
          filters: (req.body.filters ?? {}) as never,
        },
      });
    },
  );

  app.patch(
    '/niches/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          icon: z.string().optional(),
          enabled: z.boolean().optional(),
          filters: z.record(z.unknown()).optional(),
        }),
      },
    },
    async (req) => prisma.niche.update({ where: { id: req.params.id }, data: req.body as never }),
  );

  app.delete('/niches/:id', { schema: { params: z.object({ id: z.string() }) } }, async (req) => {
    await prisma.niche.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });

  // Dedupe global por source (image + fuzzy title). Dispara sob demanda.
  // dryRun=true só lista o que seria deletado sem apagar.
  app.post(
    '/admin/dedupe',
    {
      schema: {
        body: z.object({
          source: z.enum(['SHOPEE', 'MERCADOLIVRE', 'AMAZON']),
          maxDeleteRatio: z.number().min(0).max(0.5).optional(),
          dryRun: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { runOfferDedupe } = await import('@/lib/dedup.js');
      return runOfferDedupe(req.body.source, {
        maxDeleteRatio: req.body.maxDeleteRatio,
        dryRun: req.body.dryRun,
      });
    },
  );

  app.get('/admin/cookie-health', async () => {
    const sources = await prisma.source.findMany({
      where: { kind: { in: ['SHOPEE', 'MERCADOLIVRE'] } },
      select: { kind: true, cookieHealth: true, cookieValidatedAt: true, enabled: true },
    });
    return { sources };
  });

  app.get('/stats/today', async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    // ⚠️ "Captadas hoje" = ofertas NOVAS criadas hoje (createdAt).
    // Antes usava fetchedAt mas isso é atualizado em CADA upsert do cron
    // (a cada 30min), inflando o número absurdamente.
    const [offersToday, dispatchAgg, cookieHealth, totalsBySource] = await Promise.all([
      prisma.offer.groupBy({
        by: ['sourceId'],
        where: { createdAt: { gte: start } },
        _count: true,
      }),
      prisma.dispatch.groupBy({
        by: ['status'],
        where: { createdAt: { gte: start } },
        _count: true,
      }),
      prisma.source.findMany({
        where: { kind: { in: ['SHOPEE', 'MERCADOLIVRE'] } },
        select: { kind: true, cookieHealth: true, cookieValidatedAt: true },
      }),
      // Totais por source (banco inteiro) — útil pra dashboard mostrar separado
      prisma.offer.groupBy({
        by: ['sourceId'],
        _count: true,
      }),
    ]);
    return { offersToday, dispatchAgg, cookieHealth, totalsBySource };
  });

  /**
   * Stats EXTENDED — agrega TUDO pro dashboard novo num único call.
   * Inclui: funil hoje, throughput por hora (24h), top sources, comissão
   * potencial, distribuição por status, health geral + spark line 7 dias.
   */
  app.get('/stats/extended', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Maps de sourceId pra kind (pra UI mostrar nome correto)
    const sources = await prisma.source.findMany({
      select: { id: true, kind: true, lastFetchAt: true, cookieHealth: true, cookieValidatedAt: true, enabled: true },
    });
    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    const [
      totalsBySource,
      offersToday,
      offersYesterday,
      offersBySource7d,
      dispatchToday,
      dispatchYesterday,
      offersWithCommission,
      dispatches24hRaw,
      sparkRaw,
    ] = await Promise.all([
      // Totais por source (banco inteiro)
      prisma.offer.groupBy({ by: ['sourceId'], _count: true }),
      // Captadas hoje (createdAt)
      prisma.offer.count({ where: { createdAt: { gte: today } } }),
      // Captadas ontem (delta)
      prisma.offer.count({
        where: { createdAt: { gte: yesterday, lt: today } },
      }),
      // Captadas por source nos últimos 7d (pra bar chart distribuição)
      prisma.offer.groupBy({
        by: ['sourceId'],
        where: { createdAt: { gte: weekAgo } },
        _count: true,
      }),
      // Dispatches hoje (por status)
      prisma.dispatch.groupBy({
        by: ['status'],
        where: { createdAt: { gte: today } },
        _count: true,
      }),
      // Dispatches ontem (pra delta)
      prisma.dispatch.count({
        where: { createdAt: { gte: yesterday, lt: today }, status: 'SENT' },
      }),
      // Pra comissão potencial: ofertas que tiveram dispatch SENT hoje
      prisma.dispatch.findMany({
        where: { createdAt: { gte: today }, status: 'SENT' },
        select: { offer: { select: { price: true, commissionPct: true, discountPct: true } } },
      }),
      // Throughput por hora — dispatches enviados hoje agrupados por hora (UTC)
      prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
        SELECT EXTRACT(HOUR FROM "sentAt")::int as hour, COUNT(*)::bigint as count
        FROM "Dispatch"
        WHERE "sentAt" >= ${today} AND status = 'SENT'
        GROUP BY hour ORDER BY hour
      `,
      // Sparkline ofertas captadas últimos 7 dias (count por dia)
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT DATE_TRUNC('day', "createdAt") as day, COUNT(*)::bigint as count
        FROM "Offer"
        WHERE "createdAt" >= ${weekAgo}
        GROUP BY day ORDER BY day
      `,
    ]);

    // Comissão potencial (sum de price * commissionPct/100) + discount médio
    let commissionTotal = 0;
    let discountSum = 0;
    let discountCount = 0;
    for (const d of offersWithCommission) {
      const p = d.offer?.price ? Number(d.offer.price) : 0;
      const c = d.offer?.commissionPct ?? 0;
      if (p && c) commissionTotal += (p * c) / 100;
      if (d.offer?.discountPct) {
        discountSum += d.offer.discountPct;
        discountCount++;
      }
    }
    const discountAvg = discountCount > 0 ? discountSum / discountCount : 0;

    // Throughput como array 24h (preenche horas vazias com 0)
    const throughput24h = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: Number(dispatches24hRaw.find((r) => r.hour === h)?.count ?? 0),
    }));

    // Sparkline 7d preenchendo dias vazios
    const sparkline7d: Array<{ day: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const row = sparkRaw.find((r) => r.day.toISOString().slice(0, 10) === iso);
      sparkline7d.push({ day: iso, count: Number(row?.count ?? 0) });
    }

    // Enriquece grupos por source com kind (UI usa kind, não sourceId)
    const enrich = <T extends { sourceId: string; _count: number }>(items: T[]) =>
      items
        .map((it) => ({ kind: sourceMap.get(it.sourceId)?.kind ?? 'UNKNOWN', count: it._count }))
        .reduce<Record<string, number>>((acc, cur) => {
          acc[cur.kind] = (acc[cur.kind] ?? 0) + cur.count;
          return acc;
        }, {});

    // Dispatch status mapping
    const dispatchByStatus = dispatchToday.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = d._count;
      return acc;
    }, {});

    const sentToday = dispatchByStatus.SENT ?? 0;
    const sentDelta =
      dispatchYesterday > 0 ? ((sentToday - dispatchYesterday) / dispatchYesterday) * 100 : null;
    const offersDelta =
      offersYesterday > 0 ? ((offersToday - offersYesterday) / offersYesterday) * 100 : null;

    return {
      today: {
        offersCaptadas: offersToday,
        offersDelta,
        sent: sentToday,
        sentDelta,
        failed: dispatchByStatus.FAILED ?? 0,
        skipped: dispatchByStatus.SKIPPED ?? 0,
        pending: dispatchByStatus.PENDING ?? 0,
        commissionPotential: Number(commissionTotal.toFixed(2)),
        discountAvg: Number(discountAvg.toFixed(2)),
        successRate:
          sentToday + (dispatchByStatus.FAILED ?? 0) > 0
            ? Number(
                ((sentToday * 100) / (sentToday + (dispatchByStatus.FAILED ?? 0))).toFixed(1),
              )
            : 100,
      },
      totals: {
        bySource: enrich(totalsBySource),
        all: totalsBySource.reduce((a, b) => a + b._count, 0),
      },
      week: {
        bySource: enrich(offersBySource7d),
        sparkline: sparkline7d, // [{day, count}]
      },
      throughput24h, // [{hour, count}]
      sources: sources.map((s) => ({
        kind: s.kind,
        enabled: s.enabled,
        lastFetchAt: s.lastFetchAt,
        hoursAgo: s.lastFetchAt
          ? Math.floor((Date.now() - s.lastFetchAt.getTime()) / 3600_000)
          : null,
        cookieValid: (s.cookieHealth as { valid?: boolean } | null)?.valid ?? null,
        cookieValidatedAt: s.cookieValidatedAt,
      })),
    };
  });

  app.get(
    '/campaigns/:id/dispatches',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          take: z.coerce.number().int().min(1).max(200).optional(),
          status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(),
        }),
      },
    },
    async (req) =>
      prisma.dispatch.findMany({
        where: { campaignId: req.params.id, status: req.query.status },
        take: req.query.take ?? 50,
        orderBy: { createdAt: 'desc' },
        include: { offer: { select: { title: true, imageUrl: true } }, channel: { select: { name: true } } },
      }),
  );

  // Monta o texto que seria enviado em um dispatch real, sem efetivamente
  // disparar — útil pra preview na UI de campanhas/canais.
  app.post(
    '/channels/preview-message',
    {
      schema: {
        body: z.object({
          offerId: z.string().optional(),
          channelId: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const offer = await pickPreviewOffer(req.body.offerId);
      if (!offer) {
        return reply.code(404).send({ error: 'no offer with affiliateUrl available for preview' });
      }
      const channelKind = await resolveChannelKind(req.body.channelId);
      const variant = await prisma.variant.findFirst({
        where: { offerId: offer.id, channelKind },
        orderBy: { createdAt: 'desc' },
      });
      const previewLink = offer.affiliateUrl ?? offer.url;
      // Banner+footer por plataforma (Shopee/Amazon/ML) — mesma lógica do dispatcher
      const mkt = await getSettingsSection<{
        messageBanner?: string;
        messageBannerShopee?: string;
        messageBannerAmazon?: string;
        messageBannerMercadolivre?: string;
        messageFooterShopee?: string;
        messageFooterAmazon?: string;
        messageFooterMercadolivre?: string;
      }>('marketplaces');
      const offerSource = await prisma.source.findUnique({ where: { id: offer.sourceId } });
      const bannerByKind: Record<string, string | undefined> = {
        SHOPEE: mkt.messageBannerShopee,
        AMAZON: mkt.messageBannerAmazon,
        MERCADOLIVRE: mkt.messageBannerMercadolivre,
      };
      const footerByKind: Record<string, string | undefined> = {
        SHOPEE: mkt.messageFooterShopee,
        AMAZON: mkt.messageFooterAmazon,
        MERCADOLIVRE: mkt.messageFooterMercadolivre,
      };
      const banner =
        (offerSource?.kind ? bannerByKind[offerSource.kind]?.trim() : '') ||
        mkt.messageBanner?.trim();
      const footer = offerSource?.kind ? footerByKind[offerSource.kind]?.trim() : '';
      const text = formatOfferMessage({
        title: offer.title,
        price: Number(offer.price),
        originalPrice: offer.originalPrice ? Number(offer.originalPrice) : null,
        installments: offer.installments,
        couponCode: offer.coupon,
        bannerBlock: banner || null,
        hookLine: banner ? null : variant?.caption ?? null,
        footerLine: footer,
        link: previewLink,
      });
      return {
        text,
        offer: {
          id: offer.id,
          title: offer.title,
          imageUrl: offer.imageUrl,
        },
        variantUsed: variant ? { caption: variant.caption } : null,
      };
    },
  );

  // Envia uma mensagem de teste pelo channel — escolhe a oferta de maior
  // score com affiliateUrl preenchido, ignora janela e limites diários.
  app.post(
    '/channels/:id/test-message',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z
          .object({ offerId: z.string().optional() })
          .nullish(),
      },
    },
    async (req, reply) => {
      const channel = await prisma.channel.findUnique({ where: { id: req.params.id } });
      if (!channel) return reply.code(404).send({ error: 'channel not found' });
      if (!channel.whatsappGroupId) {
        return reply.code(400).send({ error: 'channel missing whatsappGroupId' });
      }
      const offer = await pickPreviewOffer((req.body as { offerId?: string } | undefined)?.offerId);
      if (!offer) {
        return reply.code(404).send({ error: 'no offer with affiliateUrl available for test' });
      }
      const variant = await prisma.variant.findFirst({
        where: { offerId: offer.id, channelKind: channel.kind },
        orderBy: { createdAt: 'desc' },
      });
      const text = formatOfferMessage({
        title: offer.title,
        price: Number(offer.price),
        originalPrice: offer.originalPrice ? Number(offer.originalPrice) : null,
        installments: offer.installments,
        couponCode: offer.coupon,
        hookLine: variant?.caption ?? '[TESTE] OFERTA DE EXEMPLO🚀',
        link: offer.affiliateUrl ?? offer.url,
      });
      const result = offer.imageUrl
        ? await evolution.sendMedia({
            instance: channel.evolutionInstance ?? undefined,
            to: channel.whatsappGroupId,
            mediaUrl: offer.imageUrl,
            mediaType: 'image',
            caption: text,
          })
        : await evolution.sendText({
            instance: channel.evolutionInstance ?? undefined,
            to: channel.whatsappGroupId,
            text,
          });
      return { sent: true, text, result };
    },
  );

  return app;
}

async function pickPreviewOffer(offerId?: string) {
  if (offerId) {
    return prisma.offer.findUnique({ where: { id: offerId } });
  }
  return prisma.offer.findFirst({
    where: { affiliateUrl: { not: null } },
    orderBy: { score: 'desc' },
  });
}

async function resolveChannelKind(channelId?: string): Promise<'WHATSAPP_GROUP' | 'TELEGRAM_CHANNEL'> {
  if (!channelId) return 'WHATSAPP_GROUP';
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { kind: true },
  });
  return channel?.kind ?? 'WHATSAPP_GROUP';
}
