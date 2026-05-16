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
  buybox_prices?: { final_price?: number; unit_price?: number | null };
  final_price?: number;
  list_price?: number;
  image_url?: string;
  image?: string;
  images?: string[];
  rating?: number;
  reviews_count?: number;
  currency?: string;
  coupon?: string;
  description?: string;
  availability?: string;
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
    { url: `https://www.amazon.com.br/dp/${asin}` },
    env.APIFY_TOKEN,
  );

  const item = items.find((i) => i.asin === asin) ?? items[0];
  if (!item) {
    throw new Error(`Amazon: produto ASIN ${asin} não encontrado no scraper`);
  }

  const price = pickPrice(item);
  const originalPrice = typeof item.list_price === 'number' ? item.list_price : undefined;
  const discountPct =
    originalPrice && price && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;

  const affiliateUrl = partnerTag
    ? `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(partnerTag)}`
    : `https://www.amazon.com.br/dp/${asin}`;

  logger.info({ asin, hasTag: !!partnerTag, price }, 'amazon enrich: matched via apify scraper');

  return {
    externalId: asin,
    title: item.title ?? `Produto Amazon ${asin}`,
    imageUrl: item.image_url ?? item.image ?? item.images?.[0],
    price: price ?? 0,
    originalPrice: originalPrice && originalPrice > (price ?? 0) ? originalPrice : undefined,
    discountPct,
    url: `https://www.amazon.com.br/dp/${asin}`,
    affiliateUrl,
    rating: item.rating,
    ratingCount: item.reviews_count,
    raw: {
      asin,
      brand: item.brand,
      coupon: item.coupon,
      importedVia: 'apify-pratikdani-amazon',
    } as Record<string, unknown>,
    source: 'apify',
  };
}
