import cron from 'node-cron';
import { prisma } from '@/lib/db.js';
import { fetchQueue } from '@/queue/queues.js';
import { logger } from '@/lib/logger.js';
import { env } from '@/config/env.js';
import { evolution } from '@/lib/evolution.js';
import { validateShopeeCookie } from '@/sources/shopee_panel.js';
import { validateMercadoLivreCookie } from '@/sources/mercadolivre_panel.js';
import { runDueCampaigns } from '@/services/campaign-runner.js';
import { getSettingsSection } from '@/lib/settings.js';

type AutomationCfg = {
  fetchEnabled?: boolean;
  fetchIntervalMin?: number;
  campaignsEnabled?: boolean;
  cookieHealthEnabled?: boolean;
  cookieHealthHour?: number;
};

let lastFetchAt = 0;
let lastCookieCheckDate = '';

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

    // === FETCH (intervalo configurável, default 30min) ===
    const fetchEnabled = cfg.fetchEnabled !== false;
    const fetchIntervalMin = cfg.fetchIntervalMin ?? 30;
    if (fetchEnabled && Date.now() - lastFetchAt >= fetchIntervalMin * 60_000) {
      lastFetchAt = Date.now();
      try {
        const sources = await prisma.source.findMany({ where: { enabled: true } });
        for (const s of sources) {
          await fetchQueue.add('fetch', { sourceKind: s.kind, limit: 50 });
        }
        logger.info({ count: sources.length, fetchIntervalMin }, 'cron fetch enqueued');
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
