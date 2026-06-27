import { fetch } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { FetchOpts, RawOffer, SourceAdapter } from './types.js';

/**
 * Amazon Creators API adapter (substitui PA-API v5, aposentada em 15/mai/2026).
 *
 * Doc: https://affiliate-program.amazon.com/creatorsapi/docs/
 *
 * Auth: OAuth 2.0 client_credentials → LWA Bearer token (TTL 3600s, cacheado).
 *   - Credential ID:  amzn1.application-oa2-client.<hex32>
 *   - Credential Secret: amzn1.oa2-cs.v1.<hex64>
 *   - Versão amarra região: 3.1 = NA (US/CA/MX/BR), 3.2 = EU, 3.3 = FE.
 *
 * Endpoint: POST https://creatorsapi.amazon/catalog/v1/{searchItems|getItems}
 *   - Body lowerCamelCase (não Capitalized como PA-API v5).
 *   - partnerTag vai no body (não na credencial).
 *   - marketplace é string "www.amazon.com.br".
 *
 * Elegibilidade: ≥10 vendas qualificadas nos últimos 30 dias na conta
 * Associates (mesma regra da PA-API). Helena bateu em jun/2026.
 */

type CreatorsCfg = {
  amazonProvider?: string;
  amazonAffiliateTag?: string;
  amazonCreatorsClientId?: string;
  amazonCreatorsClientSecret?: string;
  amazonCreatorsVersion?: '3.1' | '3.2' | '3.3';
  amazonCreatorsMinDiscount?: number;
};

const HOST = 'https://creatorsapi.amazon';

const TOKEN_ENDPOINTS: Record<string, string> = {
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};

// Marketplace inferido a partir da versão (v3.1 default = BR pra Helena).
// Pra suportar US/MX no mesmo cron no futuro, esse seria um config por job.
const DEFAULT_MARKETPLACE: Record<string, string> = {
  '3.1': 'www.amazon.com.br',
  '3.2': 'www.amazon.co.uk',
  '3.3': 'www.amazon.co.jp',
};

export class AmazonCreatorsError extends Error {
  constructor(
    message: string,
    public readonly kind: 'config' | 'auth' | 'rate' | 'eligibility' | 'unknown',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AmazonCreatorsError';
  }
}

async function getCfg(): Promise<CreatorsCfg> {
  return getSettingsSection<CreatorsCfg>('marketplaces');
}

// ── Token cache em memória — TTL real menos 60s pra evitar usar token expirando.
let cachedToken: { token: string; expiresAt: number; version: string } | null = null;

async function getAccessToken(cfg: CreatorsCfg): Promise<string> {
  const version = cfg.amazonCreatorsVersion ?? '3.1';
  const now = Date.now();
  if (cachedToken && cachedToken.version === version && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  if (!cfg.amazonCreatorsClientId || !cfg.amazonCreatorsClientSecret) {
    throw new AmazonCreatorsError(
      'Credenciais Creators API vazias (configure em /settings → Marketplaces)',
      'config',
    );
  }
  const endpoint = TOKEN_ENDPOINTS[version];
  if (!endpoint) {
    throw new AmazonCreatorsError(
      `Versão Creators API inválida: ${version} (use 3.1, 3.2 ou 3.3)`,
      'config',
    );
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: cfg.amazonCreatorsClientId,
      client_secret: cfg.amazonCreatorsClientSecret,
      scope: 'creatorsapi::default',
    }),
  });
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '');
    throw new AmazonCreatorsError(
      `Amazon Creators auth ${res.status}: ${text.slice(0, 200)}`,
      'auth',
      res.status,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AmazonCreatorsError(
      `LWA token HTTP ${res.status}: ${text.slice(0, 200)}`,
      'unknown',
      res.status,
    );
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new AmazonCreatorsError('LWA não retornou access_token', 'auth');
  }
  const ttlSec = data.expires_in ?? 3600;
  // -60s de margem pra cobrir latência do request em curso quando o token expirar.
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (ttlSec - 60) * 1000,
    version,
  };
  return data.access_token;
}

// ── Resources que pedimos por padrão. Reduz response time. Mais detalhes:
//    https://affiliate-program.amazon.com/creatorsapi/docs/en-us/resources.html
const DEFAULT_RESOURCES = [
  'images.primary.large',
  'images.primary.medium',
  'itemInfo.title',
  'itemInfo.byLineInfo',
  'itemInfo.features',
  'offersV2.listings.price',
  'offersV2.listings.savings',
  'offersV2.listings.condition',
  'offersV2.listings.deliveryInfo',
  'browseNodeInfo.browseNodes',
  'parentASIN',
];

type CreatorsItem = {
  asin: string;
  detailPageURL?: string;
  images?: {
    primary?: {
      large?: { url: string; height?: number; width?: number };
      medium?: { url: string };
    };
  };
  itemInfo?: {
    title?: { displayValue?: string };
    byLineInfo?: { brand?: { displayValue?: string }; manufacturer?: { displayValue?: string } };
    features?: { displayValues?: string[] };
  };
  offersV2?: {
    listings?: Array<{
      price?: { amount?: number; currency?: string; displayAmount?: string };
      savings?: {
        amount?: number;
        currency?: string;
        percentage?: number;
        displayAmount?: string;
      };
      deliveryInfo?: { isPrimeEligible?: boolean; isFreeShippingEligible?: boolean };
    }>;
  };
  browseNodeInfo?: {
    browseNodes?: Array<{ id?: string; displayName?: string }>;
  };
};

type SearchItemsResponse = {
  searchResult?: {
    items?: CreatorsItem[];
    totalResultCount?: number;
    searchURL?: string;
  };
  errors?: Array<{ code?: string; message?: string }>;
};

async function creatorsRequest<T>(
  operation: 'searchItems' | 'getItems',
  body: Record<string, unknown>,
  cfg: CreatorsCfg,
): Promise<T> {
  const token = await getAccessToken(cfg);
  const url = `${HOST}/catalog/v1/${operation}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'creatorsapi.amazon',
      'x-marketplace': String(body.marketplace ?? 'www.amazon.com'),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    cachedToken = null; // força refresh no próximo
    const text = await res.text().catch(() => '');
    if (/eligibility|10 sales|10 qualified/i.test(text)) {
      throw new AmazonCreatorsError(
        `Creators API: conta Associates ainda não tem 10 vendas qualificadas nos últimos 30 dias (${res.status})`,
        'eligibility',
        res.status,
      );
    }
    throw new AmazonCreatorsError(
      `Creators API auth ${res.status}: ${text.slice(0, 200)}`,
      'auth',
      res.status,
    );
  }
  if (res.status === 429) {
    throw new AmazonCreatorsError('Creators API rate limit (429)', 'rate', 429);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AmazonCreatorsError(
      `Creators API ${operation} HTTP ${res.status}: ${text.slice(0, 200)}`,
      'unknown',
      res.status,
    );
  }
  const data = (await res.json()) as T;
  return data;
}

/**
 * SearchItems — busca por keyword/categoria. Retorna RawOffer[] filtrado por
 * minDiscount (default 20%). Resposta normalizada.
 */
export async function searchItems(opts: {
  keywords?: string;
  browseNodeId?: string;
  searchIndex?: string;
  itemCount?: number;
  itemPage?: number;
  minDiscount?: number;
  minPrice?: number;
  maxPrice?: number;
  cfg?: CreatorsCfg;
}): Promise<RawOffer[]> {
  const cfg = opts.cfg ?? (await getCfg());
  const version = cfg.amazonCreatorsVersion ?? '3.1';
  const marketplace = DEFAULT_MARKETPLACE[version] ?? 'www.amazon.com';
  const partnerTag = cfg.amazonAffiliateTag?.trim();
  if (!partnerTag) {
    throw new AmazonCreatorsError(
      'amazonAffiliateTag vazio (preciso pra gerar deeplink)',
      'config',
    );
  }
  const body: Record<string, unknown> = {
    partnerType: 'Associates',
    partnerTag,
    marketplace,
    searchIndex: opts.searchIndex ?? 'All',
    availability: 'Available',
    itemCount: Math.min(opts.itemCount ?? 10, 10), // Amazon cap 10/req
    itemPage: opts.itemPage ?? 1,
    merchant: 'All',
    condition: 'Any',
    resources: DEFAULT_RESOURCES,
  };
  if (opts.keywords) body.keywords = opts.keywords;
  if (opts.browseNodeId) body.browseNodeId = opts.browseNodeId;
  if (opts.minPrice) body.minPrice = Math.round(opts.minPrice * 100); // em centavos
  if (opts.maxPrice) body.maxPrice = Math.round(opts.maxPrice * 100);

  const minDiscount = opts.minDiscount ?? cfg.amazonCreatorsMinDiscount ?? 20;

  const res = await creatorsRequest<SearchItemsResponse>('searchItems', body, cfg);
  if (res.errors?.length) {
    logger.warn({ errors: res.errors }, 'Amazon Creators searchItems warnings');
  }
  const items = res.searchResult?.items ?? [];
  const offers = items
    .map((it) => mapItemToOffer(it, partnerTag))
    .filter((o): o is RawOffer => o !== null && (o.discountPct ?? 0) >= minDiscount);

  logger.info(
    {
      keywords: opts.keywords,
      browseNodeId: opts.browseNodeId,
      total: items.length,
      withMinDiscount: offers.length,
      minDiscount,
    },
    'amazon-creators searchItems',
  );
  return offers;
}

/**
 * GetItems — detalhes de até 10 ASINs (cap da API). Útil pro pre-flight
 * check + /import-link enrich quando trocarmos o Apify pelo oficial.
 */
export async function getItems(opts: {
  itemIds: string[];
  cfg?: CreatorsCfg;
}): Promise<RawOffer[]> {
  const cfg = opts.cfg ?? (await getCfg());
  const version = cfg.amazonCreatorsVersion ?? '3.1';
  const marketplace = DEFAULT_MARKETPLACE[version] ?? 'www.amazon.com';
  const partnerTag = cfg.amazonAffiliateTag?.trim();
  if (!partnerTag) {
    throw new AmazonCreatorsError('amazonAffiliateTag vazio', 'config');
  }
  const chunks: string[][] = [];
  for (let i = 0; i < opts.itemIds.length; i += 10) {
    chunks.push(opts.itemIds.slice(i, i + 10));
  }
  const all: RawOffer[] = [];
  for (const chunk of chunks) {
    const body = {
      partnerType: 'Associates',
      partnerTag,
      marketplace,
      itemIds: chunk,
      itemIdType: 'ASIN',
      condition: 'Any',
      merchant: 'All',
      resources: DEFAULT_RESOURCES,
    };
    const res = await creatorsRequest<{ itemsResult?: { items?: CreatorsItem[] } }>(
      'getItems',
      body,
      cfg,
    );
    const items = res.itemsResult?.items ?? [];
    for (const it of items) {
      const offer = mapItemToOffer(it, partnerTag);
      if (offer) all.push(offer);
    }
  }
  return all;
}

function mapItemToOffer(item: CreatorsItem, partnerTag: string): RawOffer | null {
  const asin = item.asin;
  if (!asin) return null;
  const title = item.itemInfo?.title?.displayValue?.trim();
  if (!title) return null;
  const listing = item.offersV2?.listings?.[0];
  const priceCents = listing?.price?.amount;
  if (typeof priceCents !== 'number' || priceCents <= 0) return null;
  const price = priceCents / 100;
  const savings = listing?.savings;
  // savings.amount vem em centavos; percentage vem como inteiro 0-100.
  let discountPct: number | undefined;
  let originalPrice: number | undefined;
  if (savings && typeof savings.amount === 'number' && savings.amount > 0) {
    const savedReal = savings.amount / 100;
    originalPrice = Math.round((price + savedReal) * 100) / 100;
    discountPct =
      typeof savings.percentage === 'number'
        ? savings.percentage
        : Number(((savedReal / originalPrice) * 100).toFixed(2));
  }
  // Garante tag afiliada no link mesmo se Amazon não devolver detailPageURL.
  const url = item.detailPageURL || `https://www.amazon.com.br/dp/${asin}`;
  const affiliateUrl = ensureTag(url, partnerTag);
  const image =
    item.images?.primary?.large?.url || item.images?.primary?.medium?.url || undefined;
  const browseNode = item.browseNodeInfo?.browseNodes?.[0]?.displayName;
  return {
    externalId: asin,
    title,
    imageUrl: image,
    price,
    originalPrice,
    discountPct,
    category: browseNode,
    url,
    affiliateUrl,
    raw: {
      asin,
      brand: item.itemInfo?.byLineInfo?.brand?.displayValue,
      isPrime: listing?.deliveryInfo?.isPrimeEligible ?? false,
      source: 'amazon-creators',
    },
  };
}

function ensureTag(url: string, tag: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('tag', tag);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}tag=${encodeURIComponent(tag)}`;
  }
}

// ── Source adapter (consumido pelo fetch worker via getAdapter('AMAZON')) ──

/**
 * Sem keyword/categoria → não dá pra "trending" na Creators API. Fallback:
 * lista de keywords default úteis pro nicho mãe/bebê. Em prod, configure
 * Source.config.keywords pra cobrir mais nichos.
 */
const FALLBACK_KEYWORDS = ['fralda descartavel', 'mamadeira', 'roupa bebe', 'carrinho bebe'];

export const amazonCreatorsSource: SourceAdapter = {
  kind: 'AMAZON',
  async fetch(opts: FetchOpts = {}): Promise<RawOffer[]> {
    const cfg = await getCfg();
    if (opts.keyword) {
      return searchItems({
        keywords: opts.keyword,
        itemCount: opts.limit ?? 10,
        minDiscount: opts.minDiscount,
        cfg,
      });
    }
    if (opts.categoryId) {
      return searchItems({
        browseNodeId: opts.categoryId,
        itemCount: opts.limit ?? 10,
        minDiscount: opts.minDiscount,
        cfg,
      });
    }
    // Fallback: rodada por keywords default.
    const all: RawOffer[] = [];
    const perKeyword = Math.max(2, Math.floor((opts.limit ?? 20) / FALLBACK_KEYWORDS.length));
    for (const kw of FALLBACK_KEYWORDS) {
      try {
        const batch = await searchItems({
          keywords: kw,
          itemCount: perKeyword,
          minDiscount: opts.minDiscount,
          cfg,
        });
        all.push(...batch);
      } catch (err) {
        logger.warn(
          { keyword: kw, err: (err as Error).message },
          'amazon-creators fallback keyword failed',
        );
      }
    }
    // Dedup por ASIN
    const seen = new Set<string>();
    return all.filter((o) => {
      if (seen.has(o.externalId)) return false;
      seen.add(o.externalId);
      return true;
    });
  },
};
