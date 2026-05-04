import cron from 'node-cron';
import { prisma } from '@/lib/db.js';
import { fetchQueue } from '@/queue/queues.js';
import { logger } from '@/lib/logger.js';
import { env } from '@/config/env.js';
import { evolution } from '@/lib/evolution.js';
import { validateShopeeCookie } from '@/sources/shopee_panel.js';
import { validateMercadoLivreCookie } from '@/sources/mercadolivre_panel.js';

export function startCron(): void {
  cron.schedule('*/30 * * * *', async () => {
    const sources = await prisma.source.findMany({ where: { enabled: true } });
    for (const s of sources) {
      await fetchQueue.add('fetch', { sourceKind: s.kind, limit: 50 });
    }
    logger.info({ count: sources.length }, 'cron fetch enqueued');
  });

  cron.schedule('0 7 * * *', () => {
    runCookieHealthCheck().catch((err) => logger.error({ err }, 'cookie health check failed'));
  });

  logger.info('cron started');
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
