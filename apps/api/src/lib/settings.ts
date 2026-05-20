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
  | 'automation'
  | 'admin'
  | 'landing';

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
    // Amazon PA-API (oficial). Provider switch: 'paapi' | 'disabled'
    // Default 'disabled' — só liga quando você bater 10 vendas qualificadas
    // em 180 dias e Amazon BR liberar PA-API pra você.
    amazonProvider: 'disabled',
    amazonPaapiAccessKey: env.AMAZON_PAAPI_ACCESS_KEY,
    amazonPaapiSecretKey: env.AMAZON_PAAPI_SECRET_KEY,
    amazonPaapiPartnerTag: env.AMAZON_PAAPI_PARTNER_TAG,
    amazonPaapiHost: env.AMAZON_PAAPI_HOST,
    amazonPaapiRegion: env.AMAZON_PAAPI_REGION,
    amazonPaapiBrowseNodes: env.AMAZON_PAAPI_BROWSE_NODES,
    amazonPaapiMinDiscount: 20,
    // Shopee Open API (GraphQL). Adapter shopee.ts já implementado —
    // basta preencher credenciais oficiais (https://affiliate.shopee.com.br).
    shopeeAppId: env.SHOPEE_APP_ID,
    shopeeAppSecret: env.SHOPEE_APP_SECRET,
    // Desconto PIX renderizado no post ("OU R$ X no PIX"). DEFAULTS A 0
    // porque PIX off na Shopee é POR PRODUTO/SELLER (não universal) e a
    // Open API não expõe esse campo. Liga aqui (5 = -5%) só se você
    // souber que TODOS os sellers do seu nicho participam do PIX off.
    shopeePixDiscountPct: 0,
    mercadoLivrePixDiscountPct: 0,
    amazonPixDiscountPct: 0,
    // Shortlink master da página de cupons Shopee — usado em posts de cupons
    // AUTOMÁTICOS (sem code). Cliente clica, resgata o cupom, e qualquer
    // compra dele sai com sua comissão (mesmo sem ser o produto exato do post).
    // Gera 1x via /sources/SHOPEE/coupon-page-shortlink ou cole manualmente.
    shopeeCouponRedeemShortlink: '',
    // Shortlink de resgate de cupons DIGITÁVEIS (com code). Aparece no rodapé
    // da linha "Use o cupom XYZ" pra cliente clicar e copiar/aplicar.
    // Diferente do shopeeCouponRedeemShortlink (que é pra AUTO-cupons sem code).
    shopeeCouponCodeRedeemShortlink: '',
    // Cupom default Amazon — código aplicado em TODA mensagem Amazon que
    // atinge minPurchase. Diferente do Shopee (que tem tabela própria).
    amazonCouponCode: '',
    amazonCouponType: 'PERCENT' as 'PERCENT' | 'FIXED',
    amazonCouponValue: 0,
    amazonCouponMinPurchase: 0,
    amazonCouponMaxDiscount: 0,
    // Texto que vai depois de "Use o cupom *XYZ*" na mensagem Amazon
    // (ex: "| Para 10% OFF!"). Customize por cupom ativo.
    amazonCouponInstructionText: '',
    // Cookie do shopee.com.br (logado) — usado pra scraping de páginas de loja
    // específica (endpoint /api/v4/search/search_items por shopId). Sem cookie
    // a Shopee bloqueia com 403. Pegue do DevTools Network, header Cookie.
    // Validade típica: 7-14 dias antes de expirar.
    shopeeCookie: '',
    // Banner global no topo de toda mensagem (legacy — aplica a TODA source).
    // Use messageBannerShopee/Amazon/Mercadolivre pra ter banners por plataforma.
    messageBanner: '',
    // Banner por plataforma — sobrescreve o legacy messageBanner.
    // Setado em /settings → Marketplaces. Substitui o hook AI (variant.caption).
    messageBannerShopee: '',
    messageBannerAmazon: '',
    messageBannerMercadolivre: '',
    // Footer por plataforma — texto adicionado no final da mensagem (acima
    // do "Siga nosso perfil"). Bom pra "Veja todas as ofertas aqui: <link>".
    messageFooterShopee: '',
    messageFooterAmazon: '',
    messageFooterMercadolivre: '',
  },
  antiban: {
    minIntervalSec: env.DISPATCH_MIN_INTERVAL,
    maxIntervalSec: env.DISPATCH_MAX_INTERVAL,
    dailyLimitPerInstance: env.DISPATCH_DAILY_LIMIT_PER_INSTANCE,
    windowStartHour: env.DISPATCH_WINDOW_START,
    windowEndHour: env.DISPATCH_WINDOW_END,
    // Tempo do efeito "digitando..." antes da mensagem aparecer no WhatsApp.
    // Default 3-8s — humano digitando uma frase. NÃO confundir com intervalo
    // entre mensagens (gap REAL entre 2 envios = intervalMinutes da campanha).
    typingMinSec: 3,
    typingMaxSec: 8,
  },
  automation: {
    fetchEnabled: true,
    fetchIntervalMin: 30,
    // Amazon tem cron próprio porque cada fetch custa $0.11 via Apify.
    // Default 1440 (1x/dia) = ~$3.30/mês, dentro do free tier de $5.
    amazonFetchIntervalMin: 1440,
    campaignsEnabled: true,
    cookieHealthEnabled: true,
    cookieHealthHour: 7,
  },
  admin: {
    adminAlertGroupId: env.ADMIN_ALERT_GROUP_ID,
    webOriginUrl: env.WEB_ORIGIN_URL,
  },
  /// Config da landing page pública (/). Editável via dashboard, sem rebuild.
  /// groupLinks aceita 1 ou múltiplos — landing rotaciona automaticamente
  /// (random no mount) quando há > 1.
  landing: {
    groupLinks: [] as string[],
    totalVagas: 500,
    vagasBase: 423,
    deadlineSeconds: 120,
    headline: 'Achadinhos de mãe pra mãe 💕',
    subheadline:
      'Promoções selecionadas com cupons exclusivos direto no seu WhatsApp.',
    /// Meta Pixel ID. Vazio = pixel desativado (script não injeta).
    /// PageView dispara no mount. Lead dispara no clique do CTA do grupo.
    metaPixelId: '',
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

/** Detecta se um valor parece ser o resultado da função `maskSecrets` (formato `abcd…wxyz (NN chars)`).
 *  Usado pra impedir o frontend de regravar a forma mascarada por engano. */
function looksMasked(v: unknown): boolean {
  return typeof v === 'string' && v.includes('…') && /\(\d+ chars\)\s*$/.test(v);
}

/**
 * Remove prefixo de env var caso usuário tenha colado a linha inteira do .env
 * (ex: `MERCADOLIVRE_PANEL_COOKIE=_ga=...` vira `_ga=...`).
 * Detecta padrão `^[A-Z][A-Z0-9_]*=` no início e remove.
 */
function stripEnvPrefix(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  const match = trimmed.match(/^[A-Z][A-Z0-9_]*=/);
  if (!match) return v;
  return trimmed.slice(match[0].length);
}

/**
 * Sobrescreve uma seção (merge raso). Não toca env.
 * Filtra valores que parecem mascarados — proteção contra round-trip do GET (mask) → PATCH:
 * se o frontend ler `apiKey: "abcd…wxyz (218 chars)"` e salvar sem revelar, esse valor
 * NÃO chega na DB. Mantém o atual.
 */
export async function setSettingsSection(
  section: SettingsSection,
  partial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await getSettingsSection(section);
  const cleanPartial: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (looksMasked(v)) {
      logger.warn({ section, field: k }, 'ignoring masked value in setSettingsSection');
      continue;
    }
    cleanPartial[k] = stripEnvPrefix(v);
  }
  const next = { ...current, ...cleanPartial };
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
    'automation',
    'admin',
    'landing',
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
  'shopeeAppSecret',
  'amazonPaapiAccessKey',
  'amazonPaapiSecretKey',
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
