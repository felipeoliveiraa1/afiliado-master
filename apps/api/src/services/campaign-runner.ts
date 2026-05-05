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
    include: { channels: true },
  });
  if (campaign.channels.length === 0) {
    return { campaignId, queued: 0, dispatchIds: [], reason: 'no-channels' };
  }
  const filters = (campaign.filters as {
    sources?: string[];
    minDiscount?: number;
    minScore?: number;
    maxPrice?: number;
  }) ?? {};

  // Sub-query: IDs de offers que JÁ têm dispatch criado pra essa campanha.
  // Usa `none` (Prisma) — equivalente a NOT EXISTS no SQL. Garante que cada
  // tick do cron pega uma offer fresh, sem repetir.
  const offers = await prisma.offer.findMany({
    where: {
      affiliateUrl: { not: null },
      score: { gte: filters.minScore ?? 0 },
      discountPct: filters.minDiscount ? { gte: filters.minDiscount } : undefined,
      price: filters.maxPrice ? { lte: filters.maxPrice } : undefined,
      source: filters.sources?.length
        ? { kind: { in: filters.sources as ('SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' | 'PROMOBIT')[] } }
        : undefined,
      // Filtro chave — exclui offers já despachadas nessa campanha (qualquer status).
      dispatches: { none: { campaignId: campaign.id } },
    },
    orderBy: { score: 'desc' },
    take: takeOffers,
  });
  if (offers.length === 0) {
    return { campaignId, queued: 0, dispatchIds: [], reason: 'no-offers' };
  }

  const dispatchIds: string[] = [];
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
          scheduledFor: new Date(),
        },
        update: {},
      });
      if (d.status === 'PENDING') {
        await dispatchQueue.add('dispatch', { dispatchId: d.id });
        dispatchIds.push(d.id);
      }
    }
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
      dispatches: { take: 1, orderBy: { createdAt: 'desc' }, select: { createdAt: true } },
    },
  });
  const now = Date.now();
  for (const c of campaigns) {
    const intervalMin = ((c.schedule as { intervalMinutes?: number })?.intervalMinutes ?? 60);
    const last = c.dispatches[0]?.createdAt;
    const isDue = !last || now - last.getTime() >= intervalMin * 60_000;
    if (!isDue) continue;
    try {
      const result = await runCampaign(c.id);
      logger.info(
        { campaign: c.name, ...result },
        result.queued > 0 ? 'cron campaign dispatched' : 'cron campaign skip',
      );
    } catch (err) {
      logger.error({ err, campaign: c.name }, 'cron campaign error');
    }
  }
}
