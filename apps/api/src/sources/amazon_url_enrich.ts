import { runApifyActor } from './apify-client.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { RawOffer } from './types.js';

// junglee/free-amazon-product-scraper — funciona com ASINs específicos, country BR
const APIFY_AMAZON_ACTOR = 'junglee~free-amazon-product-scraper';

export type EnrichedAmazonProduct = RawOffer & { source: 'apify' };

type ApifyAmazonItem = {
  asin?: string;
  title?: string;
  name?: string;
  productName?: string;
  price?: { value?: number; currency?: string } | number;
  listPrice?: { value?: number } | number;
  thumbnailImage?: string;
  image?: string;
  images?: string[];
  url?: string;
  rating?: number;
  reviewsCount?: number;
  starsCount?: number;
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

/** Normaliza preço — Apify pode retornar number ou { value, currency }. */
function normalizePrice(p: unknown): number | undefined {
  if (typeof p === 'number') return p;
  if (p && typeof p === 'object' && 'value' in p) {
    const v = (p as { value?: number }).value;
    return typeof v === 'number' ? v : undefined;
  }
  return undefined;
}

/**
 * Enriquece URL Amazon → produto completo via Apify scraper.
 * Adiciona ?tag=PARTNER_TAG (configurado em settings.marketplaces.amazonAffiliateTag).
 */
export async function enrichAmazonFromUrl(url: string): Promise<EnrichedAmazonProduct> {
  url = await expandShortlink(url);
  const asin = extractAsin(url);
  if (!asin) {
    throw new Error('URL Amazon inválida — não consegui extrair ASIN (esperado /dp/ASIN ou /gp/product/ASIN)');
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
    {
      asins: [asin],
      country: 'BR',
      maxItems: 1,
      ensureLoadedProductDescription: false,
    },
    env.APIFY_TOKEN,
  );

  const item = items.find((i) => i.asin === asin) ?? items[0];
  if (!item) {
    throw new Error(`Amazon: produto ASIN ${asin} não encontrado no scraper`);
  }

  const price = normalizePrice(item.price);
  const originalPrice = normalizePrice(item.listPrice);
  const discountPct =
    originalPrice && price && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;

  const affiliateUrl = partnerTag
    ? `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(partnerTag)}`
    : `https://www.amazon.com.br/dp/${asin}`;

  logger.info({ asin, hasTag: !!partnerTag }, 'amazon enrich: matched via apify scraper');

  return {
    externalId: asin,
    title: item.title ?? item.name ?? item.productName ?? `Produto Amazon ${asin}`,
    imageUrl: item.thumbnailImage ?? item.image ?? item.images?.[0],
    price: price ?? 0,
    originalPrice: originalPrice && originalPrice > (price ?? 0) ? originalPrice : undefined,
    discountPct,
    url: `https://www.amazon.com.br/dp/${asin}`,
    affiliateUrl,
    rating: item.rating ?? item.starsCount,
    ratingCount: item.reviewsCount,
    raw: { asin, importedVia: 'apify-amazon' } as Record<string, unknown>,
    source: 'apify',
  };
}
