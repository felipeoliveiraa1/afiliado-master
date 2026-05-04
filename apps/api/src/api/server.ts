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
import {
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
    'tracking',
    'admin',
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
        params: z.object({ kind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'PROMOBIT']) }),
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

  app.get('/offers', async (req) => {
    const q = req.query as { take?: string; minScore?: string; source?: string };
    return prisma.offer.findMany({
      take: Math.min(100, Number(q.take ?? 20)),
      where: {
        score: q.minScore ? { gte: Number(q.minScore) } : undefined,
        source: q.source ? { kind: q.source as 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' | 'PROMOBIT' } : undefined,
      },
      orderBy: { score: 'desc' },
      include: { source: { select: { kind: true } } },
    });
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
          schedule: z.object({ intervalMinutes: z.number().int().min(5) }).optional(),
          channelIds: z.array(z.string()).min(1),
        }),
      },
    },
    async (req) => {
      const { channelIds, ...rest } = req.body;
      return prisma.campaign.create({
        data: {
          ...rest,
          filters: rest.filters ?? {},
          schedule: rest.schedule ?? {},
          channels: { connect: channelIds.map((id) => ({ id })) },
        },
      });
    },
  );

  app.post(
    '/campaigns/:id/run-now',
    {
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => runCampaign(req.params.id),
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
            category: p.category,
            url: p.url,
            affiliateUrl: p.affiliateUrl,
            score: scoreOffer({
              discountPct: p.discountPct ?? null,
              rating: null,
              salesCount: p.isBestSeller ? 1000 : null,
              commissionPct: null,
            }),
            raw: { panelSearch: true, isBestSeller: p.isBestSeller } as object,
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
      // Retorna products também pra UI mostrar preview (lista + badges)
      return { found: products.length, imported: offerIds.length, offerIds, products };
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

  app.get('/r/:dispatchId', async (req, reply) => {
    const params = req.params as { dispatchId: string };
    if (!env.CLICK_TRACKING_ENABLED) {
      return reply.code(404).send({ error: 'click tracking disabled' });
    }
    const dispatch = await prisma.dispatch.findUnique({
      where: { id: params.dispatchId },
      include: { offer: { select: { affiliateUrl: true, url: true } } },
    });
    if (!dispatch) return reply.code(404).send({ error: 'not found' });
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { clickCount: { increment: 1 } },
    });
    const target = dispatch.offer.affiliateUrl ?? dispatch.offer.url;
    return reply.redirect(target, 302);
  });

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
        coupon: offer.coupon,
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
        coupon: offer.coupon,
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
