import { runApifyActor } from './apify-client.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { RawOffer } from './types.js';

// pratikdani/amazon-product-scraper — aceita 1 URL por chamada, PAY_PER_EVENT
// $0.002 start (vs $0.07 do junglee/Amazon-crawler — 35x mais barato).
// Retorna asin, title, brand, buybox_prices.final_price, images, description, coupon.
const APIFY_AMAZON_ACTOR = 'pratikdani~amazon-product-scraper';

export type EnrichedAmazonProduct = RawOffer & { source: 'apify' };

// Formato resposta de pratikdani/amazon-product-scraper
type ApifyAmazonItem = {
  asin?: string;
  title?: string;
  brand?: string;
  manufacturer?: string;
  buybox_prices?: {
    final_price?: number;
    initial_price?: number;
    unit_price?: string | number | null;
    discount?: string;
  };
  final_price?: number;
  initial_price?: number;
  list_price?: number;
  discount?: string;
  image_url?: string;
  image?: string;
  images?: string[];
  rating?: number;
  reviews_count?: number;
  bought_past_month?: number;
  currency?: string;
  coupon?: string;
  coupon_description?: string;
  description?: string;
  availability?: string;
  features?: string[];
  categories?: string[];
};

/** Expande shortlinks Amazon (amzn.to, amzn.la, a.co) pra URL canônica. */
async function expandShortlink(url: string): Promise<string> {
  if (!/^https?:\/\/(amzn\.to|amzn\.la|a\.co)/.test(url)) return url;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    return res.url || url;
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, 'amazon shortlink expand failed');
    return url;
  }
}

/** Extrai ASIN de URL Amazon (B0XXXXXXX — 10 chars alfanuméricos). */
function extractAsin(url: string): string | null {
  const m =
    url.match(/\/dp\/([A-Z0-9]{10})/i) ||
    url.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
    url.match(/\/gp\/aw\/d\/([A-Z0-9]{10})/i) ||
    url.match(/\/product\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

/** Extrai final_price de buybox_prices ou outros campos. */
function pickPrice(item: ApifyAmazonItem): number | undefined {
  if (item.buybox_prices?.final_price) return item.buybox_prices.final_price;
  if (typeof item.final_price === 'number') return item.final_price;
  return undefined;
}

/**
 * Cache por ASIN — garante que múltiplos cliques em Buscar/Enviar com a MESMA
 * URL (mesmo com query strings diferentes tipo ?ref=, ?tag=, etc) NÃO disparem
 * runs duplicadas no Apify ($0.01 cada).
 *
 * TTL alinhado com o cache de URL no url_enrich.ts (5 min cobre o fluxo
 * típico preview → revisar → enviar).
 */
const ASIN_CACHE = new Map<string, { product: EnrichedAmazonProduct; expiresAt: number }>();
const ASIN_TTL_MS = 5 * 60 * 1000;

// Negative cache — quando Apify retorna vazio pra um ASIN, marca por 1 min
// pra evitar a esposa pagar $0.01 toda vez que clicar Buscar de novo no mesmo
// link inválido (indisponível / bloqueado / produto fora do ar).
const ASIN_FAIL_CACHE = new Map<string, number>();
const ASIN_FAIL_TTL_MS = 60 * 1000;

/**
 * Enriquece URL Amazon → produto completo via Apify scraper.
 * Adiciona ?tag=PARTNER_TAG (configurado em settings.marketplaces.amazonAffiliateTag).
 *
 * Cache por ASIN garante 1 chamada Apify por produto por 5min, independente
 * de quantos cliques o frontend dispare ou de variações na URL (ref, tag, etc).
 */
export async function enrichAmazonFromUrl(url: string): Promise<EnrichedAmazonProduct> {
  url = await expandShortlink(url);
  const asin = extractAsin(url);
  if (!asin) {
    throw new Error('URL Amazon inválida — não consegui extrair ASIN (esperado /dp/ASIN ou /gp/product/ASIN)');
  }

  const cached = ASIN_CACHE.get(asin);
  if (cached && cached.expiresAt > Date.now()) {
    logger.info({ asin }, 'amazon enrich: cache hit — Apify call skipped');
    return cached.product;
  }

  // Negative cache — se Apify falhou nos últimos 60s pra esse ASIN, não
  // chamar de novo. Evita gastar $0.01 em retries do mesmo URL inválido.
  const failExpiry = ASIN_FAIL_CACHE.get(asin);
  if (failExpiry && failExpiry > Date.now()) {
    throw new Error(
      `Amazon: produto ${asin} acabou de falhar no scraper (Apify retornou vazio). Pode estar indisponível ou bloqueado. Tenta de novo em ~1 min, ou troca de produto.`,
    );
  }

  if (!env.APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN não configurado — configure em /settings → Marketplaces');
  }

  // Lê tag de afiliado das settings (campo amazonAffiliateTag)
  const mkt = await getSettingsSection<{ amazonAffiliateTag?: string }>('marketplaces');
  const partnerTag = mkt.amazonAffiliateTag?.trim();
  if (!partnerTag) {
    logger.warn({ asin }, 'amazon enrich: amazonAffiliateTag vazio — link não será tagueado!');
  }

  const items = await runApifyActor<ApifyAmazonItem>(
    APIFY_AMAZON_ACTOR,
    { url: `https://www.amazon.com.br/dp/${asin}` },
    env.APIFY_TOKEN,
  );

  const item = items.find((i) => i.asin === asin) ?? items[0];
  if (!item) {
    throw new Error(`Amazon: produto ASIN ${asin} não encontrado no scraper`);
  }

  const price = pickPrice(item);

  // Valida resultado — Apify às vezes retorna item vazio quando o produto
  // está indisponível, fora de estoque ou bloqueado por anti-bot. Sem isso
  // a esposa pagava $0.01 e via "Produto Amazon B0XXX" com R$ 0.
  if (!item.title?.trim() || !price || price <= 0) {
    // Marca no negative cache pra retries não pagarem de novo no próximo 1 min
    ASIN_FAIL_CACHE.set(asin, Date.now() + ASIN_FAIL_TTL_MS);
    throw new Error(
      `Amazon: produto ${asin} retornou dados incompletos (sem título ou preço). Pode estar indisponível, fora de estoque ou Apify bloqueou. Abre a URL no navegador pra confirmar e tenta de novo em ~1 min.`,
    );
  }
  // initial_price (preço riscado) vem em buybox_prices ou na raiz. list_price é fallback.
  const originalPrice =
    item.buybox_prices?.initial_price ??
    item.initial_price ??
    (typeof item.list_price === 'number' ? item.list_price : undefined);
  const discountPct =
    originalPrice && price && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;

  // unit_price vem como "R$0,87 / unidade" ou número. Normaliza pra string display.
  const unitPriceRaw = item.buybox_prices?.unit_price;
  const unitPrice =
    typeof unitPriceRaw === 'string'
      ? unitPriceRaw
      : typeof unitPriceRaw === 'number'
        ? `R$${unitPriceRaw.toFixed(2).replace('.', ',')} / unidade`
        : undefined;

  const affiliateUrl = partnerTag
    ? `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(partnerTag)}`
    : `https://www.amazon.com.br/dp/${asin}`;

  logger.info({ asin, hasTag: !!partnerTag, price, unitPrice }, 'amazon enrich: matched via apify scraper');

  const result: EnrichedAmazonProduct = {
    externalId: asin,
    title: item.title ?? `Produto Amazon ${asin}`,
    description: item.description,
    imageUrl: item.image_url ?? item.image ?? item.images?.[0],
    price: price ?? 0,
    originalPrice: originalPrice && originalPrice > (price ?? 0) ? originalPrice : undefined,
    discountPct,
    url: `https://www.amazon.com.br/dp/${asin}`,
    affiliateUrl,
    rating: item.rating,
    ratingCount: item.reviews_count,
    salesCount: item.bought_past_month,
    raw: {
      asin,
      brand: item.brand,
      manufacturer: item.manufacturer,
      unitPrice,
      features: item.features?.slice(0, 5),
      categories: item.categories,
      coupon: item.coupon,
      couponDescription: item.coupon_description,
      importedVia: 'apify-pratikdani-amazon',
    } as Record<string, unknown>,
    source: 'apify',
  };

  // Cap simples no cache: 500 entradas com FIFO. Footprint trivial (~500KB).
  if (ASIN_CACHE.size >= 500) {
    const firstKey = ASIN_CACHE.keys().next().value;
    if (firstKey) ASIN_CACHE.delete(firstKey);
  }
  ASIN_CACHE.set(asin, { product: result, expiresAt: Date.now() + ASIN_TTL_MS });

  return result;
}
