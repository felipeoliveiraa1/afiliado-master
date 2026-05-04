import cron from 'node-cron';
import { prisma } from '@/lib/db.js';
import { fetchQueue } from '@/queue/queues.js';
import { logger } from '@/lib/logger.js';
import { env } from '@/config/env.js';
import { evolution } from '@/lib/evolution.js';
import { validateShopeeCookie } from '@/sources/shopee_panel.js';
import {
  listAvailableCoupons,
  listGeneratedCoupons,
  validateMercadoLivreCookie,
} from '@/sources/mercadolivre_panel.js';
import { runDueCampaigns } from '@/services/campaign-runner.js';
import { getSettingsSection } from '@/lib/settings.js';

type AutomationCfg = {
  fetchEnabled?: boolean;
  fetchIntervalMin?: number;
  /** Interval específico do AMAZON em min. Default 1440 (1x/dia) pra não estourar
   *  Apify free tier ($5/mês). 4 URLs × 3 produtos × $0.012 ≈ $0.14/run.
   *  - 1x/dia → ~$4.30/mês ✅
   *  - 2x/dia → ~$8.60/mês ❌ (estoura)
   *  ML/Shopee continuam usando fetchIntervalMin (scraping não custa). */
  amazonFetchIntervalMin?: number;
  campaignsEnabled?: boolean;
  cookieHealthEnabled?: boolean;
  cookieHealthHour?: number;
};

let lastFetchAt = 0;
let lastAmazonFetchAt = 0;
let lastCookieCheckDate = '';
let lastCouponSyncDate = '';

export function startCron(): void {
  // Tick alto frequência (1 min) decide internamente se cada subtask deve rodar
  // baseado em settings.automation. Permite mudar interval/on-off pelo dashboard
  // sem precisar reiniciar o backend.
  cron.schedule('*/1 * * * *', async () => {
    let cfg: AutomationCfg = {};
    try {
      cfg = await getSettingsSection<AutomationCfg>('automation');
    } catch (err) {
      logger.error({ err }, 'cron: failed to load automation settings — pulando tick');
      return;
    }

    // === FETCH (intervalo configurável por source) ===
    // Amazon tem interval próprio (default 24h) por causa do custo Apify.
    // Demais sources (ML/Shopee/Promobit) usam fetchIntervalMin (default 30min).
    const fetchEnabled = cfg.fetchEnabled !== false;
    const fetchIntervalMin = cfg.fetchIntervalMin ?? 30;
    const amazonFetchIntervalMin = cfg.amazonFetchIntervalMin ?? 1440;
    if (fetchEnabled) {
      try {
        const sources = await prisma.source.findMany({ where: { enabled: true } });
        const nowMs = Date.now();
        const nonAmazonDue = nowMs - lastFetchAt >= fetchIntervalMin * 60_000;
        const amazonDue = nowMs - lastAmazonFetchAt >= amazonFetchIntervalMin * 60_000;
        if (nonAmazonDue) lastFetchAt = nowMs;
        if (amazonDue) lastAmazonFetchAt = nowMs;
        let enqueued = 0;
        for (const s of sources) {
          if (s.kind === 'AMAZON') {
            if (!amazonDue) continue;
          } else if (!nonAmazonDue) continue;
          await fetchQueue.add('fetch', { sourceKind: s.kind, limit: 50 });
          enqueued++;
        }
        if (enqueued > 0) {
          logger.info(
            { enqueued, fetchIntervalMin, amazonFetchIntervalMin },
            'cron fetch enqueued',
          );
        }
      } catch (err) {
        logger.error({ err }, 'cron fetch failed');
      }
    }

    // === CAMPANHAS (cada tick — interval por campanha já controlado em runDueCampaigns) ===
    const campaignsEnabled = cfg.campaignsEnabled !== false;
    if (campaignsEnabled) {
      runDueCampaigns().catch((err) => logger.error({ err }, 'runDueCampaigns failed'));
    }

    // === COOKIE HEALTH (1x por dia na hora configurada) ===
    const cookieHealthEnabled = cfg.cookieHealthEnabled !== false;
    const cookieHealthHour = cfg.cookieHealthHour ?? 7;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (
      cookieHealthEnabled &&
      now.getHours() === cookieHealthHour &&
      lastCookieCheckDate !== today
    ) {
      lastCookieCheckDate = today;
      runCookieHealthCheck().catch((err) => logger.error({ err }, 'cookie health check failed'));
    }

    // === SYNC CUPONS ML (1x por dia, mesma hora do cookie health) ===
    // Refresca remainingBudget e marca EXPIRED/EXHAUSTED. Sem refresh, o
    // template do WhatsApp pode mostrar cupom morto e o comprador não usa.
    if (
      env.MERCADOLIVRE_PANEL_AUTO_ENABLED &&
      now.getHours() === cookieHealthHour &&
      lastCouponSyncDate !== today
    ) {
      lastCouponSyncDate = today;
      runMlCouponSync().catch((err) => logger.error({ err }, 'ml coupon sync failed'));
    }
  });

  logger.info('cron started (1-min tick gating via settings.automation)');
}

async function runCookieHealthCheck(): Promise<void> {
  const checks = [
    { kind: 'SHOPEE' as const, run: validateShopeeCookie, enabled: env.SHOPEE_PANEL_AUTO_ENABLED },
    {
      kind: 'MERCADOLIVRE' as const,
      run: validateMercadoLivreCookie,
      enabled: env.MERCADOLIVRE_PANEL_AUTO_ENABLED,
    },
  ];
  const expired: string[] = [];
  for (const check of checks) {
    if (!check.enabled) continue;
    const health = await check.run();
    await prisma.source.upsert({
      where: { kind: check.kind },
      update: { cookieHealth: health, cookieValidatedAt: new Date() },
      create: { kind: check.kind, cookieHealth: health, cookieValidatedAt: new Date() },
    });
    if (!health.valid) {
      expired.push(`${check.kind}: ${health.errorMessage ?? 'invalid'}`);
    }
  }
  if (expired.length && env.ADMIN_ALERT_GROUP_ID) {
    const text = `⚠️ afiliado-master — cookies expirados:\n\n${expired.join('\n')}\n\nRenove em /sources/{shopee,mercadolivre}/cookie no dashboard.`;
    try {
      await evolution.sendText({ to: env.ADMIN_ALERT_GROUP_ID, text });
    } catch (err) {
      logger.error({ err }, 'failed to send cookie expiry alert');
    }
  }
  logger.info({ expired }, 'cookie health check done');
}

/**
 * Refresh diário dos cupons ML. Mesma lógica do endpoint POST /coupons/sync —
 * pega lista do HTML + status dos gerados, atualiza remainingBudget e marca
 * EXPIRED quando data passa ou EXHAUSTED quando orçamento zera.
 */
async function runMlCouponSync(): Promise<void> {
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
  logger.info({ upserted, generated: generated.length }, 'ml coupon sync done');
}
