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
 * Executa uma campanha agora: busca top N ofertas que batem os filtros,
 * cria/reusa Dispatches por (campaign × offer × channel), enfileira no
 * dispatchQueue. Idempotente — Dispatches já existentes não duplicam.
 *
 * Usado por:
 *   - POST /campaigns/:id/run-now (handler manual no server.ts)
 *   - cron de campanhas (auto loop por intervalMinutes)
 */
export async function runCampaign(campaignId: string, takeOffers = 10): Promise<CampaignRunResult> {
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

  const offers = await prisma.offer.findMany({
    where: {
      affiliateUrl: { not: null },
      score: { gte: filters.minScore ?? 0 },
      discountPct: filters.minDiscount ? { gte: filters.minDiscount } : undefined,
      price: filters.maxPrice ? { lte: filters.maxPrice } : undefined,
      source: filters.sources?.length
        ? { kind: { in: filters.sources as ('SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' | 'PROMOBIT')[] } }
        : undefined,
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
