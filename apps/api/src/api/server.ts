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
        params: z.object({ kind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']) }),
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
    };
    const take = Math.min(100, Number(q.take ?? 20));
    const skip = Math.max(0, Number(q.skip ?? 0));
    const where = {
      score: q.minScore ? { gte: Number(q.minScore) } : undefined,
      source: q.source ? { kind: q.source as 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' } : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.offer.findMany({
        take,
        skip,
        where,
        orderBy: { score: 'desc' },
        include: { source: { select: { kind: true } } },
      }),
      prisma.offer.count({ where }),
    ]);
    return { items, total, take, skip };
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
          const titleSlug = url.match(/shopee\.com\.br\/([^?]+?)-i\./)?.[1]?.replace(/-/g, ' ') ?? itemId;
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
              score: 0.75,
            },
            update: { affiliateUrl, fetchedAt: new Date() },
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

  // Importa produtos de uma LOJA específica via Apify (renderiza JS do SPA Shopee).
  // V1 da API afiliada foi deprecada e V2 não filtra por loja, então scraping é
  // a única opção. Apify usa Chrome headless + proxy pra evitar bot detection.
  // Pra cada produto encontrado: gera shortlink afiliado e cria Offer no DB.
  app.post(
    '/sources/SHOPEE/import-shop',
    {
      schema: {
        body: z.object({
          shopUrl: z.string().url(),
          maxItems: z.number().int().min(10).max(1000).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { shopUrl, maxItems = 200 } = req.body;
      // Pega o token do settings/marketplaces
      const cfg = await getSettingsSection<{ apifyToken?: string }>('marketplaces');
      const token = cfg.apifyToken?.trim();
      if (!token) {
        return reply.code(400).send({
          error: 'Apify token não configurado. Vá em /settings → Marketplaces → Apify Token',
        });
      }
      const offers = await fetchShopeeShopViaApify(shopUrl, token, maxItems);
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
      return { imported: inserted, totalFromApi: offers.length, shopUrl };
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

  app.delete(
    '/sources/SHOPEE/coupons/:id',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req) => {
      await prisma.shopeeCoupon.delete({ where: { id: req.params.id } });
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
    const [offersToday, dispatchAgg, cookieHealth] = await Promise.all([
      prisma.offer.groupBy({
        by: ['sourceId'],
        where: { fetchedAt: { gte: start } },
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
    ]);
    return { offersToday, dispatchAgg, cookieHealth };
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
      const text = formatOfferMessage({
        title: offer.title,
        price: Number(offer.price),
        originalPrice: offer.originalPrice ? Number(offer.originalPrice) : null,
        installments: offer.installments,
        couponCode: offer.coupon,
        hookLine: variant?.caption ?? null,
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
