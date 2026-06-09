import { logger } from '@/lib/logger.js';
import { listFeeds, downloadFeedCsv } from './awin.js';
import type { FetchOpts, RawOffer, SourceAdapter } from './types.js';

/**
 * Riachuelo adapter — usa Awin Product Feed (CSV) em vez de API por produto.
 *
 * Fluxo:
 *   1. listFeeds() → URL do CSV mais recente do Riachuelo (cf advertiserId 86589)
 *   2. downloadFeedCsv(url) → parseia ~10-50k linhas
 *   3. Filtra: in_stock=1, com desconto (display_price < store_price), preço mínimo
 *   4. Mapeia pra RawOffer usando aw_deep_link como affiliateUrl (já com tracking)
 *
 * Cache em memória do CSV completo (TTL 1h) — o feed atualiza só 1x/dia, não
 * vale re-baixar 50k linhas a cada fetch. Quando o cron pede categorias
 * diferentes, filtra do mesmo cache em vez de re-baixar.
 */

type FeedRow = Record<string, string>;
let csvCache: { rows: FeedRow[]; loadedAt: number; feedId: number } | null = null;
const CSV_TTL_MS = 60 * 60 * 1000;

const DEFAULT_MIN_DISCOUNT = 20;
const DEFAULT_MIN_PRICE = 20;
const DEFAULT_MAX_PRICE = 1500;

export const riachueloSource: SourceAdapter = {
  kind: 'RIACHUELO',
  async fetch(opts: FetchOpts = {}): Promise<RawOffer[]> {
    const rows = await loadFeedCached();
    if (rows.length === 0) {
      logger.warn('riachuelo: feed CSV vazio — feedKey/publisherId corretos?');
      return [];
    }

    const minDiscount = opts.minDiscount ?? DEFAULT_MIN_DISCOUNT;
    const limit = opts.limit ?? 100;

    const offers: RawOffer[] = [];
    for (const row of rows) {
      const offer = mapRowToOffer(row, { minDiscount });
      if (offer) offers.push(offer);
    }
    // Ordena por desconto desc — melhores promoções primeiro
    offers.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));
    const sliced = offers.slice(0, limit);
    logger.info(
      { total: rows.length, withDiscount: offers.length, returned: sliced.length, minDiscount },
      'riachuelo fetch',
    );
    return sliced;
  },
};

async function loadFeedCached(): Promise<FeedRow[]> {
  if (csvCache && Date.now() - csvCache.loadedAt < CSV_TTL_MS) {
    return csvCache.rows;
  }
  const feeds = await listFeeds();
  if (feeds.length === 0) {
    throw new Error('riachuelo: nenhum feed Awin disponível (publisher tem feed permission?)');
  }
  // Pega o primeiro feed (Riachuelo é o único advertiser joined hoje).
  const feed = feeds[0];
  logger.info(
    { feedId: feed.feedId, productCount: feed.productCount, lastUpdated: feed.lastUpdated },
    'riachuelo: baixando feed CSV',
  );
  const rows = await downloadFeedCsv(feed.downloadUrl);
  csvCache = { rows, loadedAt: Date.now(), feedId: feed.feedId };
  return rows;
}

function mapRowToOffer(
  row: FeedRow,
  opts: { minDiscount: number },
): RawOffer | null {
  // Filtro estoque — feed pode usar "yes"/"no" ou "1"/"0"
  const inStock = (row.in_stock ?? '').toLowerCase();
  if (inStock === 'no' || inStock === '0' || inStock === 'false') return null;

  const price = parsePrice(row.search_price ?? row.display_price ?? row.price);
  const original = parsePrice(row.store_price ?? row.rrp_price ?? row.merchant_price);
  if (price <= 0) return null;
  if (price < DEFAULT_MIN_PRICE || price > DEFAULT_MAX_PRICE) return null;

  // Calcula desconto. Se sem original_price, considera 0% — produto sem promo
  // não passa no filtro de minDiscount.
  const discountPct =
    original > price ? Number((((original - price) / original) * 100).toFixed(2)) : 0;
  if (discountPct < opts.minDiscount) return null;

  const url = row.merchant_deep_link || row.product_url || row.url || '';
  const affiliateUrl = row.aw_deep_link || '';
  if (!url || !affiliateUrl) return null;

  const externalId =
    row.merchant_product_id || row.aw_product_id || row.product_id || extractSkuFromUrl(url);
  if (!externalId) return null;

  const title = row.product_name || row.title || '';
  if (!title || title.length < 3) return null;

  return {
    externalId,
    title,
    description: row.description || row.product_short_description || undefined,
    imageUrl: row.aw_image_url || row.merchant_image_url || row.image_url || undefined,
    price,
    originalPrice: original > price ? original : undefined,
    discountPct,
    category: row.merchant_category || row.category_name || undefined,
    url,
    affiliateUrl,
    raw: {
      brand: row.brand_name,
      deliveryCost: row.delivery_cost,
      currency: row.currency,
      source: 'awin-feed',
    },
  };
}

function parsePrice(s: string | undefined): number {
  if (!s) return 0;
  // "1234.56" ou "1234,56" ou "1.234,56" → 1234.56
  const clean = s.replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(?:[,.]\d|$))/g, '').replace(',', '.');
  return Number(clean) || 0;
}

function extractSkuFromUrl(url: string): string {
  const m = url.match(/\/p\/[^/]+\/(\d+)/) || url.match(/[?&]p=(\d+)/);
  return m?.[1] ?? '';
}
