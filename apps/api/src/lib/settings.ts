import { prisma } from '@/lib/db.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

/**
 * Settings com cache em memória + fallback pro env.
 *
 * Padrão de uso:
 *   const cookie = await getSetting('mercadolivre_panel.cookie', () => env.MERCADOLIVRE_PANEL_COOKIE);
 *   await setSetting('mercadolivre_panel.cookie', 'k=v; ...');
 *
 * Cache TTL curto (5s) pra workers pegarem mudança quase em tempo real
 * sem virar bottleneck no DB.
 */

type CacheEntry = { value: unknown; cachedAt: number };
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

export type SettingsSection =
  | 'evolution'
  | 'mercadolivre_panel'
  | 'shopee_panel'
  | 'marketplaces'
  | 'antiban'
  | 'tracking'
  | 'admin';

/**
 * Default settings expostos via env (legacy). Migrações futuras podem
 * inicializar a tabela com esses valores na primeira boot.
 */
export const ENV_DEFAULTS: Record<SettingsSection, Record<string, unknown>> = {
  evolution: {
    apiUrl: env.EVOLUTION_API_URL,
    apiKey: env.EVOLUTION_API_KEY,
    defaultInstance: env.EVOLUTION_DEFAULT_INSTANCE,
  },
  mercadolivre_panel: {
    autoEnabled: env.MERCADOLIVRE_PANEL_AUTO_ENABLED,
    cookie: env.MERCADOLIVRE_PANEL_COOKIE,
    defaultTag: env.MERCADOLIVRE_PANEL_DEFAULT_TAG,
    dailyLimit: env.MERCADOLIVRE_PANEL_DAILY_LIMIT,
    minIntervalSec: env.MERCADOLIVRE_PANEL_MIN_INTERVAL_SEC,
    maxIntervalSec: env.MERCADOLIVRE_PANEL_MAX_INTERVAL_SEC,
  },
  shopee_panel: {
    autoEnabled: env.SHOPEE_PANEL_AUTO_ENABLED,
    cookie: env.SHOPEE_PANEL_COOKIE,
    generateEndpoint: env.SHOPEE_PANEL_GENERATE_ENDPOINT,
    csrfToken: env.SHOPEE_PANEL_CSRF_TOKEN,
    dailyLimit: env.SHOPEE_PANEL_DAILY_LIMIT,
    minIntervalSec: env.SHOPEE_PANEL_MIN_INTERVAL_SEC,
    maxIntervalSec: env.SHOPEE_PANEL_MAX_INTERVAL_SEC,
  },
  marketplaces: {
    amazonAffiliateTag: env.AMAZON_AFFILIATE_TAG,
    mercadoLivreAffiliateTag: env.MERCADOLIVRE_AFFILIATE_TAG,
    apifyAmazonActor: env.APIFY_AMAZON_ACTOR,
    apifyMercadoLivreActor: env.APIFY_MERCADOLIVRE_ACTOR,
    mercadoLivreScraper: env.MERCADOLIVRE_SCRAPER,
  },
  antiban: {
    minIntervalSec: env.DISPATCH_MIN_INTERVAL,
    maxIntervalSec: env.DISPATCH_MAX_INTERVAL,
    dailyLimitPerInstance: env.DISPATCH_DAILY_LIMIT_PER_INSTANCE,
    windowStartHour: env.DISPATCH_WINDOW_START,
    windowEndHour: env.DISPATCH_WINDOW_END,
  },
  tracking: {
    clickTrackingEnabled: env.CLICK_TRACKING_ENABLED,
    publicBaseUrl: env.PUBLIC_BASE_URL,
  },
  admin: {
    adminAlertGroupId: env.ADMIN_ALERT_GROUP_ID,
    webOriginUrl: env.WEB_ORIGIN_URL,
  },
};

/**
 * Lê uma seção inteira (mescla DB + ENV defaults).
 * DB tem prioridade — só campos faltando no DB caem pro env.
 */
export async function getSettingsSection<T extends Record<string, unknown>>(
  section: SettingsSection,
): Promise<T> {
  const cached = cache.get(section);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.value as T;
  }
  try {
    const row = await prisma.setting.findUnique({ where: { key: section } });
    const dbValue = (row?.value ?? {}) as Record<string, unknown>;
    const merged = { ...ENV_DEFAULTS[section], ...dbValue };
    cache.set(section, { value: merged, cachedAt: Date.now() });
    return merged as T;
  } catch (err) {
    logger.error({ err, section }, 'getSettingsSection failed — using env defaults');
    return ENV_DEFAULTS[section] as T;
  }
}

/**
 * Sobrescreve uma seção (merge raso). Não toca env.
 */
export async function setSettingsSection(
  section: SettingsSection,
  partial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await getSettingsSection(section);
  const next = { ...current, ...partial };
  await prisma.setting.upsert({
    where: { key: section },
    create: { key: section, value: next as object },
    update: { value: next as object },
  });
  cache.set(section, { value: next, cachedAt: Date.now() });
  return next;
}

/** Invalida cache de uma seção (útil após operações externas como validate). */
export function invalidateSetting(section: SettingsSection): void {
  cache.delete(section);
}

/** Lista todas as seções (UI usa pra renderizar formulário). */
export async function getAllSettings(): Promise<Record<SettingsSection, unknown>> {
  const sections: SettingsSection[] = [
    'evolution',
    'mercadolivre_panel',
    'shopee_panel',
    'marketplaces',
    'antiban',
    'tracking',
    'admin',
  ];
  const out = {} as Record<SettingsSection, unknown>;
  for (const s of sections) {
    out[s] = await getSettingsSection(s);
  }
  return out;
}

/**
 * Mascara campos secretos pro retorno via API (cookie, key, token).
 * Mantém os primeiros e últimos 4 chars + length pra você confirmar que tá lá
 * sem expor o valor.
 */
const SECRET_FIELDS = new Set([
  'cookie',
  'apiKey',
  'csrfToken',
  'apifyToken',
  'openaiKey',
]);

export function maskSecrets<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_FIELDS.has(k) && typeof v === 'string' && v.length > 8) {
      out[k] = `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)`;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
