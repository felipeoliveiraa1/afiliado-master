import { fetch } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';

type MlPanelConfig = {
  autoEnabled?: boolean;
  cookie?: string;
  defaultTag?: string;
  dailyLimit?: number;
  minIntervalSec?: number;
  maxIntervalSec?: number;
};

async function getCfg(): Promise<MlPanelConfig> {
  return getSettingsSection<MlPanelConfig>('mercadolivre_panel');
}

/**
 * Mercado Livre affiliate panel adapter.
 *
 * Reverse-engineered from the live affiliate hub at
 * `https://www.mercadolivre.com.br/afiliados/hub` (2026-05). Endpoints used by
 * the official UI when the user clicks "Compartilhar" on a product:
 *
 *   1. GET  /afiliados/hub?is_affiliate=true        -> SSR HTML with csrfToken
 *   2. POST /affiliate-program/api/v2/stripe/user/links  -> create meli.la link
 *   3. GET  /affiliate-program/api/v2/stripe/user/tags   -> list affiliate tags
 *   4. GET  /affiliate-program/api/meliconnect/commissions?itemId=MLB...
 *   5. POST /affiliate-program/api/hub/search?is_affiliate=true&device=desktop
 *
 * AUTH MODEL:
 * - All endpoints require a logged-in browser session (cookie jar from
 *   mercadolivre.com.br) provided via MERCADOLIVRE_PANEL_COOKIE.
 * - POST endpoints additionally require the X-CSRF-Token header. The token is
 *   embedded in the HTML of /afiliados/hub as `csrfToken":"<TOKEN>"`. We fetch
 *   it once and cache in memory for CSRF_TTL_MS.
 *
 * RESPONSE FORMAT for POST /stripe/user/links:
 * - Body is base64-encoded JSON. Decoded shape:
 *     { id, created, tag, text, short_url, long_url, type_url, generated_date,
 *       origin_url, regex, list_url, deeplink_list_url }
 *
 * SAFETY NETS:
 * - Cooldown on 401/403/429.
 * - Soft daily limit via MERCADOLIVRE_PANEL_DAILY_LIMIT (workers enforce).
 * - Realistic browser headers + Referer per request.
 *
 * The cookie expires every 1-2 weeks; cron `validateMercadoLivreCookie` runs
 * daily to flag staleness before it bites a campaign in production.
 */

const HUB_URL = 'https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true';
const CREATE_LINK_URL =
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links';
const TAGS_URL = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/tags';
const COMMISSIONS_URL = 'https://www.mercadolivre.com.br/affiliate-program/api/meliconnect/commissions';
const HUB_SEARCH_URL =
  'https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop';

const CSRF_TTL_MS = 5 * 60 * 1000;
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RATE_COOLDOWN_MS = 60 * 60 * 1000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export class MercadoLivrePanelError extends Error {
  constructor(
    message: string,
    public readonly kind: 'config' | 'auth' | 'rate' | 'unknown',
  ) {
    super(message);
    this.name = 'MercadoLivrePanelError';
  }
}

export type MercadoLivreCookieHealth = {
  valid: boolean;
  affiliateName?: string;
  tag?: string;
  checkedAt: string;
  errorMessage?: string;
};

export type MercadoLivrePanelProduct = {
  externalId: string;
  title: string;
  imageUrl?: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  url: string;
  affiliateUrl?: string;
  category?: string;
  isBestSeller?: boolean;
  participatesInProgram: boolean;
};

export type SearchByCategoryArgs = {
  categoryId: string;
  subCategoryId?: string;
  bestSellersOnly?: boolean;
  limit?: number;
};

export type CreateLinkResponse = {
  id: string;
  created: boolean;
  tag: string;
  text: string;
  short_url: string;
  long_url: string;
  type_url: string;
  generated_date: string;
  origin_url: string;
  regex: string;
  list_url?: string;
  deeplink_list_url?: string;
};

type CsrfCacheEntry = {
  token: string;
  tag: string | null;
  fetchedAt: number;
};

let csrfCache: CsrfCacheEntry | null = null;
let cooldownUntil = 0;

/**
 * Lê configuração ativa (DB → fallback env), valida e retorna o cookie pra
 * usar nos headers. Lança MercadoLivrePanelError quando incompleto/em cooldown.
 */
async function ensureEnabled(): Promise<MlPanelConfig> {
  const cfg = await getCfg();
  if (!cfg.autoEnabled) {
    throw new MercadoLivrePanelError('autoEnabled=false (configure em /settings)', 'config');
  }
  if (!cfg.cookie || cfg.cookie.trim().length < 50) {
    throw new MercadoLivrePanelError('cookie vazio ou muito curto (configure em /settings)', 'config');
  }
  if (Date.now() < cooldownUntil) {
    throw new MercadoLivrePanelError(
      `em cooldown até ${new Date(cooldownUntil).toISOString()}`,
      'auth',
    );
  }
  return cfg;
}

type HeaderOpts = {
  acceptHtml?: boolean;
  csrfToken?: string;
  referer?: string;
  withJsonBody?: boolean;
  cookie: string;
};

function buildBrowserHeaders(opts: HeaderOpts): Record<string, string> {
  const isHtml = opts.acceptHtml === true;
  const headers: Record<string, string> = {
    Accept: isHtml
      ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      : 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    Origin: 'https://www.mercadolivre.com.br',
    Referer: opts.referer ?? HUB_URL,
    'User-Agent': DEFAULT_USER_AGENT,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': isHtml ? 'document' : 'empty',
    'sec-fetch-mode': isHtml ? 'navigate' : 'cors',
    'sec-fetch-site': isHtml ? 'none' : 'same-origin',
    Cookie: opts.cookie,
  };
  if (opts.withJsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.csrfToken) {
    headers['X-CSRF-Token'] = opts.csrfToken;
  }
  return headers;
}

function handleAuthFailure(status: number): never {
  cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
  csrfCache = null;
  logger.error({ status }, 'mercadolivre panel auth failed — cookie provavelmente expirou');
  throw new MercadoLivrePanelError(
    `auth failed (${status}) — atualizar MERCADOLIVRE_PANEL_COOKIE`,
    'auth',
  );
}

function handleRateLimit(): never {
  cooldownUntil = Date.now() + RATE_COOLDOWN_MS;
  throw new MercadoLivrePanelError('rate limited (429)', 'rate');
}

/**
 * Extracts the csrfToken and (optionally) the affiliate tag from the SSR HTML
 * of `/afiliados/hub`. The token is needed for every state-changing POST.
 */
export function parseCsrfTokenFromHtml(html: string): { csrfToken: string; tag: string | null } {
  const csrfMatch = html.match(/csrfToken"\s*:\s*"([^"]+)"/);
  if (!csrfMatch) {
    throw new MercadoLivrePanelError('csrfToken não encontrado no HTML do hub', 'auth');
  }
  const tagMatch = html.match(/"tag"\s*:\s*"(ofp\d+)"/);
  return { csrfToken: csrfMatch[1], tag: tagMatch?.[1] ?? null };
}

async function getCsrfTokenAndTag(
  cookie: string,
  force = false,
): Promise<{ csrfToken: string; tag: string | null }> {
  if (!force && csrfCache && Date.now() - csrfCache.fetchedAt < CSRF_TTL_MS) {
    return { csrfToken: csrfCache.token, tag: csrfCache.tag };
  }
  const res = await fetch(HUB_URL, {
    method: 'GET',
    headers: buildBrowserHeaders({ acceptHtml: true, cookie }),
    redirect: 'follow',
  });
  if (res.status === 401 || res.status === 403) handleAuthFailure(res.status);
  if (!res.ok) {
    throw new MercadoLivrePanelError(`HTTP ${res.status} ao buscar /afiliados/hub`, 'unknown');
  }
  const html = await res.text();
  const parsed = parseCsrfTokenFromHtml(html);
  csrfCache = { token: parsed.csrfToken, tag: parsed.tag, fetchedAt: Date.now() };
  return parsed;
}

/**
 * Decodes the response body of POST /stripe/user/links. The endpoint returns a
 * base64-encoded JSON string; if the response is already JSON (rare fallback),
 * we accept that too.
 */
export function decodeCreateLinkResponse(raw: string): CreateLinkResponse {
  const trimmed = raw.trim();
  const tryParse = (text: string): CreateLinkResponse | null => {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && typeof obj.short_url === 'string') {
        return obj as CreateLinkResponse;
      }
    } catch {
      return null;
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    const fromB64 = tryParse(decoded);
    if (fromB64) return fromB64;
  } catch {
    // ignore base64 errors and fall through
  }
  throw new MercadoLivrePanelError(
    `resposta inesperada do createLink: ${trimmed.slice(0, 200)}`,
    'unknown',
  );
}

/**
 * Generates a `meli.la/...` shortlink for a given Mercado Livre product URL,
 * using the affiliate tag (defaults to MERCADOLIVRE_PANEL_DEFAULT_TAG, then to
 * the tag discovered in the hub HTML, then `ofp5162`).
 *
 * As a side-effect, the ML server also registers the product on the affiliate's
 * default list ("Minhas recomendações") — this is the same behavior triggered
 * when the user clicks "Compartilhar" in the official UI.
 */
export async function generateMercadoLivreShortlink(
  productUrl: string,
  opts: { tag?: string; subId?: string } = {},
): Promise<string> {
  const cfg = await ensureEnabled();
  const cookie = cfg.cookie!;
  const { csrfToken, tag: discoveredTag } = await getCsrfTokenAndTag(cookie);
  const tag = opts.tag || cfg.defaultTag || discoveredTag || 'ofp5162';
  const body = JSON.stringify({ url: productUrl, tag });
  const headers = buildBrowserHeaders({
    csrfToken,
    referer: productUrl,
    withJsonBody: true,
    cookie,
  });
  const res = await fetch(CREATE_LINK_URL, {
    method: 'POST',
    headers,
    body,
  });
  if (res.status === 401 || res.status === 403) handleAuthFailure(res.status);
  if (res.status === 429) handleRateLimit();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new MercadoLivrePanelError(
      `HTTP ${res.status} no createLink: ${text.slice(0, 200)}`,
      'unknown',
    );
  }
  const raw = await res.text();
  const parsed = decodeCreateLinkResponse(raw);
  return parsed.short_url;
}

/**
 * Generates a shortlink and returns the full decoded response (useful for
 * persisting the long_url, list_url, suggested text, etc.).
 */
export async function generateMercadoLivreLinkDetailed(
  productUrl: string,
  opts: { tag?: string } = {},
): Promise<CreateLinkResponse> {
  const cfg = await ensureEnabled();
  const cookie = cfg.cookie!;
  const { csrfToken, tag: discoveredTag } = await getCsrfTokenAndTag(cookie);
  const tag = opts.tag || cfg.defaultTag || discoveredTag || 'ofp5162';
  const res = await fetch(CREATE_LINK_URL, {
    method: 'POST',
    headers: buildBrowserHeaders({ csrfToken, referer: productUrl, withJsonBody: true, cookie }),
    body: JSON.stringify({ url: productUrl, tag }),
  });
  if (res.status === 401 || res.status === 403) handleAuthFailure(res.status);
  if (res.status === 429) handleRateLimit();
  if (!res.ok) {
    throw new MercadoLivrePanelError(`HTTP ${res.status} no createLink`, 'unknown');
  }
  return decodeCreateLinkResponse(await res.text());
}

export type MercadoLivreTag = {
  tag: string;
  in_use: boolean;
  generated_date: string;
};

/**
 * Lists all affiliate tags (sub-IDs) the user has. Each WhatsApp channel /
 * campaign can use a different tag for per-channel revenue attribution.
 */
export async function getMercadoLivreTags(): Promise<MercadoLivreTag[]> {
  const cfg = await ensureEnabled();
  const res = await fetch(TAGS_URL, {
    method: 'GET',
    headers: buildBrowserHeaders({ cookie: cfg.cookie! }),
  });
  if (res.status === 401 || res.status === 403) handleAuthFailure(res.status);
  if (!res.ok) {
    throw new MercadoLivrePanelError(`HTTP ${res.status} no /stripe/user/tags`, 'unknown');
  }
  const json = (await res.json()) as { tags?: MercadoLivreTag[] };
  return json.tags ?? [];
}

export type MercadoLivreCommission = {
  itemId: string;
  label: string;
  percentage: number;
  extraCommission: boolean;
};

/**
 * Returns the commission % and extra-commission flag for a single MLB item.
 */
export async function getMercadoLivreCommission(itemId: string): Promise<MercadoLivreCommission> {
  const cfg = await ensureEnabled();
  const url = `${COMMISSIONS_URL}?itemId=${encodeURIComponent(itemId)}`;
  const res = await fetch(url, { method: 'GET', headers: buildBrowserHeaders({ cookie: cfg.cookie! }) });
  if (res.status === 401 || res.status === 403) handleAuthFailure(res.status);
  if (!res.ok) {
    throw new MercadoLivrePanelError(`HTTP ${res.status} no /commissions`, 'unknown');
  }
  const json = (await res.json()) as {
    label?: string;
    percentage?: number;
    extra_commission?: boolean;
  };
  return {
    itemId,
    label: json.label ?? 'GANHOS',
    percentage: Number(json.percentage ?? 0),
    extraCommission: Boolean(json.extra_commission),
  };
}

/**
 * Validates the affiliate session by fetching `/afiliados/hub` and parsing the
 * embedded csrfToken + tag. Used by the daily cron and the UI button under
 * `/sources/mercadolivre/cookie`.
 */
export async function validateMercadoLivreCookie(): Promise<MercadoLivreCookieHealth> {
  const checkedAt = new Date().toISOString();
  const cfg = await getCfg();
  if (!cfg.cookie || cfg.cookie.trim().length < 50) {
    return { valid: false, checkedAt, errorMessage: 'cookie vazio (configure em /settings)' };
  }
  try {
    const { tag } = await getCsrfTokenAndTag(cfg.cookie, true);
    return { valid: true, tag: tag ?? undefined, checkedAt };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { valid: false, checkedAt, errorMessage };
  }
}

/** Body shape captured from HAR `www.mercadolivre.com.br3.har` (hub cenário A). */
export type HubSearchFiltersPayload = {
  id: string;
  value: boolean | string;
};

export type HubSearchPostBody = {
  search: string;
  sort: string;
  filters: HubSearchFiltersPayload[];
  offset: number;
};

/**
 * Builds POST `/affiliate-program/api/hub/search` JSON exactly like the
 * official hub UI (see HAR cenário A).
 */
export function buildHubSearchPostBody(args: SearchByCategoryArgs): HubSearchPostBody {
  const filters: HubSearchFiltersPayload[] = [];
  const leafCategoryId = args.subCategoryId ?? args.categoryId;
  if (leafCategoryId.trim()) {
    filters.push({ id: 'category', value: leafCategoryId });
  }
  if (args.bestSellersOnly) {
    filters.push({ id: 'best_seller', value: true });
  }
  return {
    search: '',
    sort: 'relevance',
    filters,
    offset: 0,
  };
}

function pickImageFromUnknown(v: unknown): string | undefined {
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['secure_url', 'url', 'src', 'thumbnail', 'value']) {
      const found = pickImageFromUnknown(o[k]);
      if (found) return found;
    }
    if (Array.isArray(o)) {
      for (const item of o) {
        const found = pickImageFromUnknown(item);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function normalizePolycard(card: Record<string, unknown>): MercadoLivrePanelProduct | null {
  const metadata = card.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const externalId = String(m.id ?? '');
  if (!externalId.startsWith('MLB')) return null;
  const path = String(m.url ?? '');
  if (!path.trim()) return null;
  const urlParams = String(m.url_params ?? '');
  const fragments = String(m.url_fragments ?? '');
  let url = path.startsWith('http') ? path : `https://${path}`;
  if (urlParams) {
    url += urlParams.startsWith('?') ? urlParams : `?${urlParams}`;
  }
  if (fragments) {
    url += fragments.startsWith('#') ? fragments : `#${fragments}`;
  }
  let title = '';
  let price = 0;
  let originalPrice: number | undefined;
  let discountPct: number | undefined;
  let isBestSeller = false;
  let imageUrl: string | undefined =
    pickImageFromUnknown(m.thumbnail) ??
    pickImageFromUnknown(m.image) ??
    pickImageFromUnknown(m.picture_url) ??
    pickImageFromUnknown(m.pictures);
  const components = card.components;
  if (Array.isArray(components)) {
    for (const raw of components) {
      if (!raw || typeof raw !== 'object') continue;
      const comp = raw as Record<string, unknown>;
      const ctype = comp.type;
      if (ctype === 'title') {
        const titleObj = comp.title as Record<string, unknown> | undefined;
        if (typeof titleObj?.text === 'string') title = titleObj.text;
      }
      if (ctype === 'price') {
        const priceObj = comp.price as Record<string, unknown> | undefined;
        const cur = priceObj?.current_price as Record<string, unknown> | undefined;
        const prev = priceObj?.previous_price as Record<string, unknown> | undefined;
        const disc = priceObj?.discount as Record<string, unknown> | undefined;
        if (cur?.value != null) price = Number(cur.value);
        if (prev?.value != null) originalPrice = Number(prev.value);
        if (disc?.value != null) discountPct = Number(disc.value);
      }
      if (ctype === 'highlight') {
        const highlight = comp.highlight as Record<string, unknown> | undefined;
        const text = highlight?.text;
        if (typeof text === 'string' && text.toUpperCase().includes('VENDID')) isBestSeller = true;
      }
      if (!imageUrl && (ctype === 'pictures' || ctype === 'gallery' || ctype === 'image')) {
        imageUrl =
          pickImageFromUnknown(comp.pictures) ??
          pickImageFromUnknown(comp.gallery) ??
          pickImageFromUnknown(comp.image) ??
          pickImageFromUnknown(comp);
      }
    }
  }
  const participatesInProgram = m.type === 'product' || Boolean(externalId);
  return {
    externalId,
    title,
    imageUrl,
    price,
    originalPrice,
    discountPct,
    url,
    affiliateUrl: undefined,
    category: undefined,
    isBestSeller,
    participatesInProgram,
  };
}

/**
 * Hidrata imageUrl em 2 camadas:
 *   1) API pública do ML (`/items?ids=...`) — rápido, batch de 20
 *   2) og:image do HTML do produto (fallback pra IDs não-padrão do hub)
 */
export async function hydrateImagesFromPublicApi(
  products: MercadoLivrePanelProduct[],
): Promise<MercadoLivrePanelProduct[]> {
  const missing = products.filter((p) => !p.imageUrl);
  if (missing.length === 0) return products;
  const byId = new Map<string, string>();

  // Camada 1: ML public API (até 20 IDs por request)
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20).map((p) => p.externalId);
    try {
      const url = `https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,thumbnail,secure_thumbnail,pictures`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        logger.warn({ status: res.status, batchSize: batch.length }, 'public-api hydrate http fail');
        continue;
      }
      const arr = (await res.json()) as Array<{
        code?: number;
        body?: {
          id?: string;
          thumbnail?: string;
          secure_thumbnail?: string;
          pictures?: { url?: string; secure_url?: string }[];
        };
      }>;
      for (const entry of arr) {
        if (entry.code !== 200 || !entry.body?.id) continue;
        const b = entry.body;
        const img =
          b.pictures?.[0]?.secure_url ||
          b.pictures?.[0]?.url ||
          b.secure_thumbnail ||
          b.thumbnail;
        if (img && b.id) byId.set(b.id, img);
      }
    } catch (err) {
      logger.warn({ err }, 'hydrateImagesFromPublicApi failed batch');
    }
  }

  // Camada 2: og:image do HTML do produto (concurrency 4, 5s timeout)
  const stillMissing = missing.filter((p) => !byId.has(p.externalId) && p.url);
  if (stillMissing.length > 0) {
    logger.info({ count: stillMissing.length }, 'falling back to og:image scraping');
    const queue = [...stillMissing];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        const p = queue.shift();
        if (!p) break;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(p.url, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html' },
            redirect: 'follow',
            signal: ctrl.signal,
          });
          clearTimeout(t);
          if (!res.ok) continue;
          const html = await res.text();
          const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          if (m?.[1]) byId.set(p.externalId, m[1]);
        } catch {
          // skip on error/timeout
        }
      }
    });
    await Promise.all(workers);
  }

  return products.map((p) => (p.imageUrl ? p : { ...p, imageUrl: byId.get(p.externalId) }));
}

/**
 * Maps the `polycard_client_model.polycards[]` array from POST /hub/search into
 * `MercadoLivrePanelProduct` rows.
 */
export function parseProductsFromHubSearchJson(json: unknown): MercadoLivrePanelProduct[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const pcm = root.polycard_client_model as Record<string, unknown> | undefined;
  if (!pcm) return [];
  const polycards = pcm.polycards;
  if (!Array.isArray(polycards)) return [];
  return polycards
    .map((c) => normalizePolycard(c as Record<string, unknown>))
    .filter((p): p is MercadoLivrePanelProduct => p !== null && p.participatesInProgram);
}

/**
 * Searches products in the affiliate hub with optional category and
 * best-sellers filter. Uses POST `/affiliate-program/api/hub/search` with the
 * body captured from HAR cenário A (`search`, `sort`, `filters`, `offset`).
 * Falls back to SSR `/afiliados/hub` parsing when the API returns zero cards
 * or a non-2xx status.
 */
export async function searchMercadoLivreByCategory(
  args: SearchByCategoryArgs,
): Promise<MercadoLivrePanelProduct[]> {
  const cfg = await ensureEnabled();
  const cookie = cfg.cookie!;
  const { csrfToken } = await getCsrfTokenAndTag(cookie);
  const limit = args.limit ?? 50;
  const body = buildHubSearchPostBody(args);
  try {
    const res = await fetch(HUB_SEARCH_URL, {
      method: 'POST',
      headers: buildBrowserHeaders({ csrfToken, withJsonBody: true, cookie }),
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) handleAuthFailure(res.status);
    if (res.status === 429) handleRateLimit();
    if (!res.ok) {
      logger.warn({ status: res.status }, 'hub/search non-OK — SSR fallback');
      return (await searchFromHubHtml(cookie, limit)).slice(0, limit);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const products = parseProductsFromHubSearchJson(json);
    if (!products.length) {
      logger.warn(
        { filters: body.filters },
        'hub/search returned 0 polycards — SSR fallback (category filter may need adjustment)',
      );
      const fallback = (await searchFromHubHtml(cookie, limit)).slice(0, limit);
      return await hydrateImagesFromPublicApi(fallback);
    }
    return await hydrateImagesFromPublicApi(products.slice(0, limit));
  } catch (err) {
    logger.warn({ err }, 'hub/search failed — SSR fallback');
    return (await searchFromHubHtml(cookie, limit)).slice(0, limit);
  }
}

/**
 * Fallback when POST /hub/search fails: parse the JSON state embedded in the
 * SSR HTML of /afiliados/hub. Returns the default "Produtos selecionados para
 * você" list (no category filter — best-effort).
 */
async function searchFromHubHtml(cookie: string, limit: number): Promise<MercadoLivrePanelProduct[]> {
  const res = await fetch(HUB_URL, {
    method: 'GET',
    headers: buildBrowserHeaders({ acceptHtml: true, cookie }),
    redirect: 'follow',
  });
  if (!res.ok) return [];
  const html = await res.text();
  const startMarker = 'window.__NAVIGATION_PRELOADED_STATE__ = ';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return [];
  const tail = html.slice(startIdx + startMarker.length);
  const jsonStr = sliceJsonObject(tail);
  if (!jsonStr) return [];
  let preloaded: unknown;
  try {
    preloaded = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  const items = extractItems(preloaded);
  return items.map(normalizePanelProduct).filter((p) => p.participatesInProgram).slice(0, limit);
}

/**
 * Reads a balanced JSON object literal from the start of `text` and returns it
 * as a string. Handles strings and escapes correctly.
 */
function sliceJsonObject(text: string): string | null {
  if (text[0] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return null;
}

function extractItems(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    const candidates = [obj.items, obj.results, obj.products, obj.data];
    for (const c of candidates) {
      if (Array.isArray(c)) return c as Record<string, unknown>[];
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        const nested = extractItems(value);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

function pickStringField(obj: unknown, keys: readonly string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function normalizePanelProduct(item: Record<string, unknown>): MercadoLivrePanelProduct {
  const externalId = String(item.id ?? item.itemId ?? item.item_id ?? item.productId ?? '');
  const title = String(item.title ?? item.name ?? '');
  const url = String(item.permalink ?? item.url ?? item.productUrl ?? item.product_url ?? '');
  const price = Number(item.price ?? 0);
  const originalPrice =
    item.originalPrice != null
      ? Number(item.originalPrice)
      : item.original_price != null
        ? Number(item.original_price)
        : undefined;
  const discountPct =
    originalPrice && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;
  const affiliateUrl = pickStringField(item, [
    'affiliateUrl',
    'shortUrl',
    'short_url',
    'shortlink',
    'sharingUrl',
  ]);
  const imageUrl = pickStringField(item, ['imageUrl', 'thumbnail', 'image', 'pictureUrl']);
  const category = pickStringField(item, ['categoryId', 'category', 'categoryName']);
  const isBestSeller = Boolean(
    item.isBestSeller ?? item.bestSeller ?? item.best_seller ?? item.is_best_seller,
  );
  const participatesInProgram = Boolean(
    item.affiliated ?? item.eligible ?? item.isEligible ?? affiliateUrl ?? externalId,
  );
  return {
    externalId,
    title,
    imageUrl,
    price,
    originalPrice,
    discountPct,
    url,
    affiliateUrl,
    category,
    isBestSeller,
    participatesInProgram,
  };
}

/**
 * Paridade com Divulga Links: dado uma categoria, busca produtos no painel ML
 * e gera shortlink de afiliado para cada um (em série, com throttle pra parecer
 * humano). Produtos que não participam do programa de afiliados ou que falham
 * na geração são silenciosamente pulados — isso é exatamente o "X de Y produtos
 * adicionados" mostrado pelo Divulga Links no vídeo de referência.
 *
 * Por que não paralelizar: a Shopee/ML observa cadência. 50 requisições em
 * paralelo em <1s seriam classificadas como bot na hora.
 */
export async function searchAndAffiliateByCategory(
  args: SearchByCategoryArgs,
  opts: { jitterMinMs?: number; jitterMaxMs?: number; maxAffiliated?: number } = {},
): Promise<MercadoLivrePanelProduct[]> {
  const products = await searchMercadoLivreByCategory(args);
  const minMs = opts.jitterMinMs ?? 800;
  const maxMs = opts.jitterMaxMs ?? 2400;
  const cap = opts.maxAffiliated ?? products.length;
  const result: MercadoLivrePanelProduct[] = [];
  for (const p of products) {
    if (result.length >= cap) break;
    if (!p.url) continue;
    if (p.affiliateUrl) {
      result.push(p);
      continue;
    }
    try {
      const shortUrl = await generateMercadoLivreShortlink(p.url);
      result.push({ ...p, affiliateUrl: shortUrl });
      await new Promise((r) =>
        setTimeout(r, minMs + Math.floor(Math.random() * (maxMs - minMs))),
      );
    } catch (err) {
      if (err instanceof MercadoLivrePanelError && err.kind === 'auth') {
        // Cookie expirou: aborta o loop inteiro — cooldown global já marcado.
        logger.warn({ err: err.message }, 'ml panel cookie expired during bulk affiliate');
        break;
      }
      logger.debug(
        { url: p.url, err: err instanceof Error ? err.message : String(err) },
        'ml shortlink gen skipped (likely product not in affiliate program)',
      );
    }
  }
  return result;
}

/** Test-only helper to reset the in-memory CSRF and cooldown state. */
export function __resetPanelStateForTests(): void {
  csrfCache = null;
  cooldownUntil = 0;
}
