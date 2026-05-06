import type { Offer } from '@prisma/client';
import { prisma } from '@/lib/db.js';
import { dispatchQueue } from '@/queue/queues.js';
import { logger } from '@/lib/logger.js';

export type CampaignRunResult = {
  campaignId: string;
  queued: number;
  dispatchIds: string[];
  reason?: 'no-offers' | 'no-channels' | 'all-already-dispatched';
};

/**
 * Executa uma campanha agora: pega a PRÓXIMA oferta ainda não despachada
 * pra essa campanha (ordem: maior score primeiro), cria Dispatches por
 * channel, enfileira no dispatchQueue.
 *
 * Cada chamada despacha NO MÁXIMO `takeOffers` ofertas NOVAS — as já
 * despachadas (qualquer status) ficam de fora. Isso evita o bug do upsert
 * antigo, que após popular as top 10 nunca mais disparava nada (o cron
 * pegava sempre as mesmas top 10 que já tinham dispatch criado).
 *
 * Usado por:
 *   - POST /campaigns/:id/run-now (handler manual)
 *   - cron de campanhas (auto loop por intervalMinutes — usa takeOffers=1)
 */
export async function runCampaign(campaignId: string, takeOffers = 1): Promise<CampaignRunResult> {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { channels: true, niches: true },
  });
  if (campaign.channels.length === 0) {
    return { campaignId, queued: 0, dispatchIds: [], reason: 'no-channels' };
  }
  // Filtros base da campanha
  const filters = (campaign.filters as {
    sources?: string[];
    minDiscount?: number;
    minScore?: number;
    maxPrice?: number;
  }) ?? {};

  // Agrega filtros dos nichos (UNION de categorias/keywords, MAX dos filtros).
  // Permite ter campanha "Grupo Tudo" com niches=[Bebê, Casa] que pega offers
  // de qualquer um dos dois nichos.
  type NicheFilters = {
    categoryIds?: { SHOPEE?: string[]; MERCADOLIVRE?: string[]; AMAZON?: string[]; PROMOBIT?: string[] };
    keywords?: string[];
    minDiscount?: number;
    minScore?: number;
    maxPrice?: number;
  };
  const nicheCategoryIds = new Set<string>();
  const nicheKeywords = new Set<string>();
  let nicheMinDiscount: number | undefined;
  let nicheMinScore: number | undefined;
  let nicheMaxPrice: number | undefined;
  for (const n of campaign.niches.filter((x) => x.enabled)) {
    const f = (n.filters as NicheFilters) ?? {};
    for (const arr of Object.values(f.categoryIds ?? {})) {
      for (const id of arr ?? []) nicheCategoryIds.add(id);
    }
    for (const k of f.keywords ?? []) nicheKeywords.add(k.toLowerCase());
    if (f.minDiscount != null) nicheMinDiscount = Math.max(nicheMinDiscount ?? 0, f.minDiscount);
    if (f.minScore != null) nicheMinScore = Math.max(nicheMinScore ?? 0, f.minScore);
    if (f.maxPrice != null) nicheMaxPrice = Math.min(nicheMaxPrice ?? Infinity, f.maxPrice);
  }
  // Filtros efetivos: campaign.filters override > niche aggregated > default
  const effective = {
    minDiscount: filters.minDiscount ?? nicheMinDiscount,
    minScore: filters.minScore ?? nicheMinScore ?? 0,
    maxPrice: filters.maxPrice ?? (nicheMaxPrice === Infinity ? undefined : nicheMaxPrice),
    categoryIds: nicheCategoryIds,
    keywords: nicheKeywords,
  };

  const schedule = (campaign.schedule as {
    postLoop?: boolean;
    burstSpreadMinSec?: number;
    burstSpreadMaxSec?: number;
  }) ?? {};

  // Sub-query: IDs de offers que JÁ têm dispatch criado pra essa campanha.
  // Usa `none` (Prisma) — equivalente a NOT EXISTS no SQL. Garante que cada
  // tick do cron pega uma offer fresh, sem repetir.
  // Match por categoria do nicho — offer.category armazena o ID que veio do
  // adapter (ex MLB1384, 100068). Se há categorias do nicho, exige match.
  // Keywords: substring no title (case-insensitive).
  const categoryFilter =
    effective.categoryIds.size > 0
      ? { category: { in: Array.from(effective.categoryIds) } }
      : undefined;
  const keywordFilter =
    effective.keywords.size > 0
      ? {
          OR: Array.from(effective.keywords).map((kw) => ({
            title: { contains: kw, mode: 'insensitive' as const },
          })),
        }
      : undefined;
  const baseWhere = {
    affiliateUrl: { not: null },
    score: { gte: effective.minScore },
    discountPct: effective.minDiscount ? { gte: effective.minDiscount } : undefined,
    price: effective.maxPrice ? { lte: effective.maxPrice } : undefined,
    source: filters.sources?.length
      ? { kind: { in: filters.sources as ('SHOPEE' | 'AMAZON' | 'MERCADOLIVRE')[] } }
      : undefined,
    // Combinador: se tem categoria E keyword, OR. Se tem só uma, aplica direto.
    ...(categoryFilter && keywordFilter
      ? { OR: [categoryFilter, ...(keywordFilter.OR as { title: object }[])] }
      : categoryFilter
        ? categoryFilter
        : keywordFilter
          ? keywordFilter
          : {}),
  };
  // Rotação round-robin entre sources quando há múltiplas configuradas.
  // Para takeOffers=1 (cron normal): pega oferta da source DIFERENTE da última disparada.
  // Para takeOffers>1 (run-now manual): intercala ofertas top-score de cada source.
  // Sem isso, se Shopee tem ofertas com score maior, ela monopoliza o grupo.
  const sources = (filters.sources ?? []) as ('SHOPEE' | 'AMAZON' | 'MERCADOLIVRE')[];
  const shouldRotate = sources.length > 1;

  async function pickOffersWithRotation(): Promise<Offer[]> {
    if (!shouldRotate) {
      return prisma.offer.findMany({
        where: { ...baseWhere, dispatches: { none: { campaignId: campaign.id } } },
        orderBy: { score: 'desc' },
        take: takeOffers,
      });
    }
    if (takeOffers === 1) {
      // Próxima oferta = source DIFERENTE da última disparada
      const last = await prisma.dispatch.findFirst({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
        include: { offer: { include: { source: { select: { kind: true } } } } },
      });
      const lastKind = last?.offer.source.kind;
      const others = lastKind ? sources.filter((s) => s !== lastKind) : sources;
      // Tenta source diferente primeiro
      for (const src of others.length > 0 ? others : sources) {
        const found = await prisma.offer.findMany({
          where: {
            ...baseWhere,
            source: { kind: src },
            dispatches: { none: { campaignId: campaign.id } },
          },
          orderBy: { score: 'desc' },
          take: 1,
        });
        if (found.length > 0) return found;
      }
      return [];
    }
    // takeOffers>1: pega top-N de cada source e intercala
    const perSource = await Promise.all(
      sources.map((src) =>
        prisma.offer.findMany({
          where: {
            ...baseWhere,
            source: { kind: src },
            dispatches: { none: { campaignId: campaign.id } },
          },
          orderBy: { score: 'desc' },
          take: takeOffers,
        }),
      ),
    );
    const interleaved: Offer[] = [];
    let idx = 0;
    while (interleaved.length < takeOffers && perSource.some((arr) => arr.length > idx)) {
      for (const arr of perSource) {
        if (interleaved.length >= takeOffers) break;
        if (arr[idx]) interleaved.push(arr[idx]);
      }
      idx++;
    }
    return interleaved;
  }

  let offers = await pickOffersWithRotation();
  // postLoop=true: quando esgotou as offers novas, deleta dispatches dessa
  // campanha pra recomeçar o ciclo desde a oferta de maior score.
  if (offers.length === 0 && schedule.postLoop) {
    const deleted = await prisma.dispatch.deleteMany({ where: { campaignId: campaign.id } });
    logger.info({ campaignId, deleted: deleted.count }, 'postLoop: ciclo reiniciado');
    offers = await pickOffersWithRotation();
  }
  if (offers.length === 0) {
    return { campaignId, queued: 0, dispatchIds: [], reason: 'no-offers' };
  }

  // Spread de burst: dentro do mesmo lote, espaça mensagens 30-120s por padrão
  // pra parecer humano postando uma achadinho de cada vez (não tudo de vez).
  // Configurável por campanha via schedule.burstSpreadMin/MaxSec.
  const spreadMin = Math.max(0, schedule.burstSpreadMinSec ?? 30);
  const spreadMax = Math.max(spreadMin, schedule.burstSpreadMaxSec ?? 120);
  const dispatchIds: string[] = [];
  let cumulativeDelayMs = 0;
  for (const offer of offers) {
    for (const channel of campaign.channels) {
      // Como filtramos NOT-dispatched no findMany, esses CREATEs são novos.
      // Mas mantém upsert pra robustez contra race condition (2 workers).
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
          scheduledFor: new Date(Date.now() + cumulativeDelayMs),
        },
        update: {},
      });
      if (d.status === 'PENDING') {
        await dispatchQueue.add(
          'dispatch',
          { dispatchId: d.id },
          { delay: cumulativeDelayMs },
        );
        dispatchIds.push(d.id);
      }
    }
    // Próxima oferta do burst: agenda spreadMin~spreadMax segundos depois
    const nextGapSec = Math.floor(spreadMin + Math.random() * (spreadMax - spreadMin));
    cumulativeDelayMs += nextGapSec * 1000;
  }
  if (dispatchIds.length === 0) {
    return { campaignId, queued: 0, dispatchIds, reason: 'all-already-dispatched' };
  }
  return { campaignId, queued: dispatchIds.length, dispatchIds };
}

/**
 * Cron: descobre campanhas habilitadas que estão "vencidas" (passou do
 * intervalMinutes desde o último dispatch criado) e roda cada uma.
 */
export async function runDueCampaigns(): Promise<void> {
  const campaigns = await prisma.campaign.findMany({
    where: { enabled: true },
    include: {
      dispatches: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, scheduledFor: true },
      },
    },
  });
  const now = Date.now();
  for (const c of campaigns) {
    const sched = (c.schedule as {
      intervalMinutes?: number;
      intervalMinutesMin?: number;
      intervalMinutesMax?: number;
      burstSizeMin?: number;
      burstSizeMax?: number;
    }) ?? {};
    // Intervalo randomizado: usa Min/Max se setados, senão fallback pro fixo legacy.
    // A cada tick do cron escolhe um valor random no range — gera sensação suave
    // (ex: 10-15min varia em vez de exato 12min sempre).
    const iMin = sched.intervalMinutesMin ?? sched.intervalMinutes ?? 60;
    const iMax = sched.intervalMinutesMax ?? sched.intervalMinutes ?? 60;
    const intervalMin = iMin + Math.random() * Math.max(0, iMax - iMin);
    // Usa scheduledFor (não createdAt) — assim bursts longos (10-15min entre msgs)
    // não disparam novo burst antes do anterior terminar.
    const last = c.dispatches[0]?.scheduledFor ?? c.dispatches[0]?.createdAt;
    const isDue = !last || now - last.getTime() >= intervalMin * 60_000;
    if (!isDue) continue;
    // Burst variável: cada disparo de campanha manda N mensagens (5-12 default).
    // Imita curador humano que junta achadinhos e posta em onda, depois pausa.
    const burstMin = Math.max(1, sched.burstSizeMin ?? 5);
    const burstMax = Math.max(burstMin, sched.burstSizeMax ?? 12);
    const burstSize = Math.floor(burstMin + Math.random() * (burstMax - burstMin + 1));
    try {
      const result = await runCampaign(c.id, burstSize);
      logger.info(
        { campaign: c.name, burstSize, ...result },
        result.queued > 0 ? 'cron campaign burst dispatched' : 'cron campaign skip',
      );
    } catch (err) {
      logger.error({ err, campaign: c.name }, 'cron campaign error');
    }
  }
}
