import { fetchShopeeProducts, fetchShopeeByShopId, generateShopeeShortLink } from './shopee.js';
import { runApifyActor } from './apify-client.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import type { RawOffer } from './types.js';

const APIFY_SHOPEE_ACTOR = 'cZrxaxPbcqHwGwSlm';

export type EnrichedShopeeProduct = RawOffer & { source: 'graphql' | 'shop-graphql' | 'apify' };

type ApifyShopeeItem = {
  itemId?: string | number;
  shopId?: string | number;
  name?: string;
  title?: string;
  productName?: string;
  price?: number | string;
  price_min?: number | string;
  price_max?: number | string;
  image?: string;
  image_url?: string;
  images?: string[];
  rating_star?: number;
  historical_sold?: number;
  sold?: number;
  raw_discount?: string;
  discount?: string;
  url?: string;
};

function extractShopAndItemId(url: string): { shopId: string; itemId: string } | null {
  const m = url.match(/\/product\/(\d+)\/(\d+)/) || url.match(/[.\-]i\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { shopId: m[1], itemId: m[2] };
}

function extractKeywordFromSlug(url: string): string {
  const slugMatch = url.match(/shopee\.com\.br\/([^?]+?)-i\./);
  if (!slugMatch) return '';
  const slug = decodeURIComponent(slugMatch[1]);
  return slug
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 5)
    .join(' ');
}

function normalizePrice(p: number | string | undefined): number {
  const n = Number(p ?? 0);
  return n > 100000 ? n / 100000 : n;
}

export async function enrichShopeeFromUrl(url: string): Promise<EnrichedShopeeProduct> {
  const ids = extractShopAndItemId(url);
  if (!ids) {
    throw new Error('URL Shopee inválida — esperado formato com /product/N/N ou *.i.N.N');
  }
  const { shopId, itemId } = ids;
  const keyword = extractKeywordFromSlug(url);

  if (keyword.length >= 6) {
    try {
      const results = await fetchShopeeProducts({ keyword, limit: 50 });
      const match = results.find((r) => r.externalId === itemId);
      if (match) {
        logger.info({ itemId, keyword, source: 'graphql' }, 'shopee enrich: matched via productOfferV2');
        return { ...match, source: 'graphql' };
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, keyword },
        'shopee enrich: productOfferV2 falhou — tentando shopOfferV2',
      );
    }
  }

  // TENTATIVA 2: shopOfferV2 com shopId — pega TODOS produtos da loja específica.
  // Free, via Open API oficial. Cobre long tail que productOfferV2(keyword) perde.
  try {
    const shopIdNum = Number(shopId);
    if (!Number.isNaN(shopIdNum) && shopIdNum > 0) {
      const shopProducts = await fetchShopeeByShopId(shopIdNum, { limit: 100 });
      const match = shopProducts.find((r) => r.externalId === itemId);
      if (match) {
        logger.info({ itemId, shopId, source: 'shop-graphql' }, 'shopee enrich: matched via shopOfferV2');
        return { ...match, source: 'shop-graphql' };
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, shopId },
      'shopee enrich: shopOfferV2 falhou — caindo no Apify',
    );
  }

  if (!env.APIFY_TOKEN) {
    throw new Error(
      'Produto não encontrado via API Shopee (productOfferV2 + shopOfferV2). ' +
        'Provavelmente loja não participa do programa de afiliados, ou produto sem oferta ativa. ' +
        'Verifique o link ou configure APIFY_TOKEN como último fallback.',
    );
  }
  try {
    const items = await runApifyActor<ApifyShopeeItem>(
      APIFY_SHOPEE_ACTOR,
      { country: 'br', mode: 'url', url, maxProducts: 50, fetchDetail: true, delay: 1.5 },
      env.APIFY_TOKEN,
    );
    const item = items.find((i) => String(i.itemId) === itemId);
    if (!item) {
      throw new Error('Produto não encontrado nem via API Shopee nem via scraper');
    }

    const price = normalizePrice(item.price ?? item.price_min);
    const originalPrice = item.price_max ? normalizePrice(item.price_max) : undefined;
    const discountPct = item.raw_discount
      ? Number(String(item.raw_discount).replace('%', ''))
      : originalPrice && originalPrice > price
        ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
        : undefined;

    const affiliateUrl = await generateShopeeShortLink(url);

    logger.info({ itemId, source: 'apify' }, 'shopee enrich: matched via Apify scraper');
    return {
      externalId: itemId,
      title: item.name ?? item.title ?? item.productName ?? extractKeywordFromSlug(url),
      imageUrl: item.image_url ?? item.image ?? item.images?.[0],
      price,
      originalPrice: originalPrice && originalPrice > price ? originalPrice : undefined,
      discountPct,
      url,
      affiliateUrl,
      rating: item.rating_star,
      salesCount: item.historical_sold ?? item.sold,
      raw: { shopId, importedVia: 'apify-fallback' } as Record<string, unknown>,
      source: 'apify',
    };
  } catch (err) {
    throw new Error(`Não consegui puxar dados do produto: ${(err as Error).message}`);
  }
}
