import { fetchShopeeProducts, fetchShopeeByItemId, generateShopeeShortLink } from './shopee.js';
import { runApifyActor } from './apify-client.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import type { RawOffer } from './types.js';

const APIFY_SHOPEE_ACTOR = 'cZrxaxPbcqHwGwSlm';

export type EnrichedShopeeProduct = RawOffer & { source: 'graphql' | 'apify' };

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

/** Expande shortlink s.shopee.com.br ou shopee.com.br/affiliate-go pra URL canônica. */
async function expandShortlink(url: string): Promise<string> {
  if (!/^https?:\/\/(s\.shopee\.com\.br|shopee\.com\.br\/affiliate-go)/.test(url)) {
    return url;
  }
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    return res.url || url;
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, 'shopee shortlink expand failed');
    return url;
  }
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
  // Apify xtracto retorna preço em centavos × 1000 (×100000 de reais) pra produtos antigos,
  // ou em centavos (×100) pra produtos novos. Detecta pelo magnitude:
  if (n > 100000) return n / 100000;
  if (n > 1000) return n / 100;
  return n;
}

export type ShopProductPreview = {
  externalId: string;
  shopId: string;
  title: string;
  imageUrl?: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  rating?: number;
  salesCount?: number;
  url: string;
};

function extractShopFromUrl(input: string): string {
  // Aceita "https://shopee.com.br/mundo.kidssc", "https://shopee.com.br/shop/12345",
  // ou só "mundo.kidssc" / "12345"
  const m = input.match(/shopee\.com\.br\/(?:shop\/)?([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  return input.trim();
}

/**
 * Preview de loja Shopee — pega N produtos da página inicial SEM gerar shortlinks.
 * Shortlinks são gerados depois, só pros selecionados (otimização: 1 chamada Apify
 * lista até 50 produtos, esposa marca 5-10, geramos shortlinks só desses).
 */
export async function previewShopeeShop(
  shopInput: string,
  maxItems = 50,
): Promise<ShopProductPreview[]> {
  if (!env.APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN não configurado — configure em /settings → Marketplaces');
  }
  const shop = extractShopFromUrl(shopInput);
  const pageUrl = `https://shopee.com.br/${shop}`;
  const items = await runApifyActor<ApifyShopeeItem & { shop_id?: number | string; item_id?: number | string; price_min?: number | string; productUrl?: string }>(
    APIFY_SHOPEE_ACTOR,
    { country: 'br', mode: 'url', url: pageUrl, maxProducts: maxItems, fetchDetail: false, delay: 1.5 },
    env.APIFY_TOKEN,
  );
  const out: ShopProductPreview[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    const itemId = String((i as Record<string, unknown>).item_id ?? i.itemId ?? '');
    const shopId = String((i as Record<string, unknown>).shop_id ?? i.shopId ?? '');
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    const title = i.name ?? i.title ?? '';
    if (!title) continue;
    const price = normalizePrice(i.price ?? (i as Record<string, unknown>).price_min as number | string | undefined);
    const originalPrice = i.price_max ? normalizePrice(i.price_max) : undefined;
    out.push({
      externalId: itemId,
      shopId,
      title,
      imageUrl: i.image_url ?? i.image ?? i.images?.[0],
      price,
      originalPrice: originalPrice && originalPrice > price ? originalPrice : undefined,
      discountPct: i.raw_discount
        ? Number(String(i.raw_discount).replace('%', ''))
        : originalPrice && originalPrice > price
          ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
          : undefined,
      rating: i.rating_star,
      salesCount: i.historical_sold ?? i.sold,
      // URL canônica baseada em shopId+itemId — evita usar slug do scraper que às vezes
      // vem do produto adjacente na listagem (bug do actor).
      url: `https://shopee.com.br/product/${shopId}/${itemId}`,
    });
  }
  logger.info({ shop, requested: maxItems, returned: out.length }, 'preview-shop ready');
  return out;
}

export async function enrichShopeeFromUrl(url: string): Promise<EnrichedShopeeProduct> {
  // Expande shortlink s.shopee.com.br pra URL canônica antes de extrair shopId/itemId
  url = await expandShortlink(url);
  const ids = extractShopAndItemId(url);
  if (!ids) {
    throw new Error('URL Shopee inválida — esperado formato com /product/N/N ou *.i.N.N');
  }
  const { shopId, itemId } = ids;
  const keyword = extractKeywordFromSlug(url);

  // TENTATIVA 1 (DESCOBERTA HAR DivulgaNinja): productOfferV2 ACEITA itemId direto!
  // Cobre 100% dos produtos afiliados Shopee, sem depender do slug ter keyword
  // descritiva (ex: /opaanlp/...  onde "opaanlp" é nome da loja, não do produto).
  try {
    const match = await fetchShopeeByItemId(itemId);
    if (match) {
      logger.info({ itemId, source: 'graphql' }, 'shopee enrich: matched via productOfferV2(itemId)');
      return { ...match, source: 'graphql' };
    }
    logger.warn({ itemId }, 'shopee enrich: itemId não encontrado via productOfferV2 — tentando keyword');
  } catch (err) {
    logger.warn({ err: (err as Error).message, itemId }, 'shopee enrich: itemId query falhou — tentando keyword');
  }

  // TENTATIVA 2: productOfferV2 com keyword extraída do slug (fallback se itemId falhar).
  if (keyword.length >= 6) {
    try {
      const results = await fetchShopeeProducts({ keyword, limit: 50 });
      const match = results.find((r) => r.externalId === itemId);
      if (match) {
        logger.info({ itemId, keyword, source: 'graphql' }, 'shopee enrich: matched via productOfferV2');
        return { ...match, source: 'graphql' };
      }
      logger.warn(
        { itemId, keyword, found: results.length },
        'shopee enrich: keyword retornou produtos mas nenhum bateu itemId — caindo no Apify',
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, keyword },
        'shopee enrich: productOfferV2 falhou — caindo no Apify',
      );
    }
  }

  if (!env.APIFY_TOKEN) {
    throw new Error(
      'Produto não encontrado via API Shopee. ' +
        'Shopee Open API só permite busca por keyword, não por itemId/shopId direto — ' +
        'se o produto não está no top 100 da keyword extraída do link, precisamos do Apify pra puxar. ' +
        'Configure APIFY_TOKEN em /settings → Marketplaces.',
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
      logger.warn(
        {
          itemId,
          apifyCount: items.length,
          sampleIds: items.slice(0, 5).map((i) => String(i.itemId)),
          sampleKeys: items[0] ? Object.keys(items[0]).slice(0, 20) : [],
        },
        'shopee enrich: Apify retornou produtos mas itemId não bateu',
      );
      throw new Error(
        `Apify retornou ${items.length} produtos da página, mas nenhum com itemId=${itemId}. ` +
          'Pode ser que o produto não esteja na página inicial da loja (scrape Apify só pega 1ª página).',
      );
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
