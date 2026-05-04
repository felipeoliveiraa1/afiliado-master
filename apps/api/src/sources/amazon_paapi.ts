// @ts-expect-error — SDK é JS callback-based, sem types
import ProductAdvertisingAPIv1 from 'paapi5-nodejs-sdk';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { RawOffer, SourceAdapter } from './types.js';

/**
 * Amazon PA-API 5.0 adapter (oficial). Substitui o adapter Apify removido.
 *
 * Liberação: precisa 10 vendas qualificadas em 180 dias no programa de
 * Associados Amazon BR. Quando libera, gera Access Key + Secret Key em
 * https://webservices.amazon.com/paapi5/documentation/register-for-pa-api.html
 *
 * Vantagens vs Apify:
 *   - Preço ATUAL fiel (com cupom aplicado, sem variantes degeneradas)
 *   - Cupons reais (`Offers.Listings.Promotions[]`)
 *   - 100% legal (sem ToS Amazon contra scraping)
 *   - Sem custo (PA-API é grátis até TPS limit, que cresce com vendas)
 *
 * Limitações:
 *   - TPS começa em 1 req/sec (sobe com volume) → throttle obrigatório
 *   - Requer setup de BrowseNodes (IDs de categoria) pra bestsellers
 *
 * Config (settings.marketplaces):
 *   - amazonProvider: 'paapi' | 'disabled'
 *   - amazonPaapiAccessKey, amazonPaapiSecretKey, amazonPaapiPartnerTag
 *   - amazonPaapiHost (default 'webservices.amazon.com.br')
 *   - amazonPaapiRegion (default 'us-east-1')
 *   - amazonPaapiBrowseNodes (CSV de IDs)
 *   - amazonPaapiMinDiscount (% mínimo, default 20)
 */

type MarketplacesCfg = {
  amazonPaapiAccessKey?: string;
  amazonPaapiSecretKey?: string;
  amazonPaapiPartnerTag?: string;
  amazonPaapiHost?: string;
  amazonPaapiRegion?: string;
  amazonPaapiBrowseNodes?: string;
  amazonPaapiMinDiscount?: number;
};

// Resources mínimos pra encher RawOffer. Cada resource extra adiciona TPS cost
// — manter enxuto. Lista oficial: https://webservices.amazon.com/paapi5/documentation/search-items.html#resources-parameter
const SEARCH_RESOURCES = [
  'Images.Primary.Large',
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'Offers.Listings.Price',
  'Offers.Listings.SavingBasis',
  'Offers.Listings.Promotions',
  'Offers.Summaries.LowestPrice',
  'CustomerReviews.Count',
  'CustomerReviews.StarRating',
  'BrowseNodeInfo.BrowseNodes',
];

type PaapiPrice = { Amount?: number; Currency?: string; DisplayAmount?: string };
type PaapiPromotion = { Type?: string; DiscountPercent?: number; Amount?: number };
type PaapiListing = {
  Price?: PaapiPrice;
  SavingBasis?: PaapiPrice;
  Promotions?: PaapiPromotion[];
};
type PaapiItem = {
  ASIN?: string;
  DetailPageURL?: string;
  Images?: { Primary?: { Large?: { URL?: string } } };
  ItemInfo?: {
    Title?: { DisplayValue?: string };
    ByLineInfo?: { Brand?: { DisplayValue?: string } };
  };
  Offers?: {
    Listings?: PaapiListing[];
    Summaries?: { LowestPrice?: PaapiPrice }[];
  };
  CustomerReviews?: {
    Count?: number;
    StarRating?: { Value?: number };
  };
  BrowseNodeInfo?: {
    BrowseNodes?: { DisplayName?: string }[];
  };
};

async function getCfg(): Promise<MarketplacesCfg> {
  return getSettingsSection<MarketplacesCfg>('marketplaces');
}

/**
 * Configura o cliente singleton da SDK. Chamado a cada fetch porque settings
 * mudam pelo dashboard sem restart.
 */
function configureClient(cfg: MarketplacesCfg): void {
  const client = ProductAdvertisingAPIv1.ApiClient.instance;
  client.accessKey = cfg.amazonPaapiAccessKey;
  client.secretKey = cfg.amazonPaapiSecretKey;
  client.host = cfg.amazonPaapiHost || 'webservices.amazon.com.br';
  client.region = cfg.amazonPaapiRegion || 'us-east-1';
}

/**
 * Wrap callback-based SDK em promise. Preserva o status code de erro pra
 * decidir retry (429 = throttle).
 */
function callSearchItems(
  request: Record<string, unknown>,
): Promise<{ items: PaapiItem[]; errors?: { Code?: string; Message?: string }[] }> {
  return new Promise((resolve, reject) => {
    const api = new ProductAdvertisingAPIv1.DefaultApi();
    api.searchItems(request, (err: { status?: number; response?: { text?: string } } | null, data: unknown) => {
      if (err) {
        const status = err.status ?? 0;
        const text = err.response?.text ?? '';
        const wrapped = new Error(`PA-API SearchItems failed (HTTP ${status}): ${text.slice(0, 200)}`);
        // @ts-expect-error — anexar status pra retry decidir
        wrapped.status = status;
        return reject(wrapped);
      }
      try {
        const resp = ProductAdvertisingAPIv1.SearchItemsResponse.constructFromObject(data);
        const items = (resp?.SearchResult?.Items ?? []) as PaapiItem[];
        const errors = resp?.Errors;
        resolve({ items, errors });
      } catch (e) {
        reject(new Error(`PA-API response parse failed: ${(e as Error).message}`));
      }
    });
  });
}

/**
 * Retry com backoff exponencial pra 429 (throttle). PA-API começa em 1 TPS
 * por conta nova — qualquer chamada paralela vai bater. Backoff: 1s, 2s, 4s.
 */
async function searchItemsWithRetry(
  request: Record<string, unknown>,
  maxAttempts = 3,
): Promise<{ items: PaapiItem[]; errors?: { Code?: string; Message?: string }[] }> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callSearchItems(request);
    } catch (err) {
      lastErr = err as Error;
      const status = (err as { status?: number }).status;
      if (status !== 429 && status !== 503) throw err;
      const waitMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      logger.warn({ status, attempt, waitMs }, 'PA-API throttled — retrying');
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr ?? new Error('PA-API exhausted retries');
}

/**
 * Mapeia 1 produto PA-API → RawOffer. Campos ausentes viram undefined.
 * Calcula discountPct quando há SavingBasis (preço original > atual).
 */
function paapiItemToRawOffer(item: PaapiItem): RawOffer | null {
  if (!item.ASIN || !item.DetailPageURL) return null;
  const title = item.ItemInfo?.Title?.DisplayValue;
  if (!title) return null;
  const listing = item.Offers?.Listings?.[0];
  const price = listing?.Price?.Amount ?? item.Offers?.Summaries?.[0]?.LowestPrice?.Amount;
  if (price == null || price <= 0) return null;
  const originalPrice = listing?.SavingBasis?.Amount;
  const discountPct =
    originalPrice && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;
  // Cupons / promoções: pega o primeiro com Type ou DiscountPercent.
  const promo = listing?.Promotions?.[0];
  const coupon = promo
    ? promo.DiscountPercent
      ? `${promo.DiscountPercent}% off`
      : promo.Type ?? undefined
    : undefined;
  return {
    externalId: item.ASIN,
    title,
    imageUrl: item.Images?.Primary?.Large?.URL,
    price,
    originalPrice,
    discountPct,
    url: item.DetailPageURL,
    affiliateUrl: item.DetailPageURL, // PA-API embeda PartnerTag automaticamente
    rating: item.CustomerReviews?.StarRating?.Value,
    ratingCount: item.CustomerReviews?.Count,
    category: item.BrowseNodeInfo?.BrowseNodes?.[0]?.DisplayName,
    raw: item as unknown as Record<string, unknown>,
  };
}

export const amazonPaapiSource: SourceAdapter = {
  kind: 'AMAZON',
  async fetch(opts) {
    const cfg = await getCfg();
    if (!cfg.amazonPaapiAccessKey || !cfg.amazonPaapiSecretKey || !cfg.amazonPaapiPartnerTag) {
      throw new Error(
        'PA-API não configurada — preencha Access Key, Secret Key e Partner Tag em /settings → Marketplaces.',
      );
    }
    configureClient(cfg);

    // BrowseNodes CSV: pra cada nó, busca top N produtos com desconto mínimo.
    // Sem nodes configurados → busca por keywords default (não recomendado, mas funcional).
    const browseNodeIds = (cfg.amazonPaapiBrowseNodes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const minSavingPercent = cfg.amazonPaapiMinDiscount ?? 20;
    const itemCount = Math.min(10, opts?.limit ?? 10);
    const all: RawOffer[] = [];

    if (browseNodeIds.length === 0) {
      logger.warn('PA-API sem BrowseNodes configurados — busca por keywords default');
      const req = {
        PartnerTag: cfg.amazonPaapiPartnerTag,
        PartnerType: 'Associates',
        Marketplace: `www.${cfg.amazonPaapiHost ?? 'amazon.com.br'}`.replace('webservices.', ''),
        Keywords: opts?.keyword || 'oferta',
        ItemCount: itemCount,
        MinSavingPercent: minSavingPercent,
        Resources: SEARCH_RESOURCES,
      };
      const { items, errors } = await searchItemsWithRetry(req);
      if (errors?.length) logger.warn({ errors }, 'PA-API SearchItems returned errors');
      for (const it of items) {
        const offer = paapiItemToRawOffer(it);
        if (offer) all.push(offer);
      }
      return all;
    }

    // Iterar BrowseNodes sequencial (TPS limit). Throttle 1.2s entre chamadas.
    for (const nodeId of browseNodeIds) {
      const req = {
        PartnerTag: cfg.amazonPaapiPartnerTag,
        PartnerType: 'Associates',
        Marketplace: `www.${(cfg.amazonPaapiHost ?? 'webservices.amazon.com.br').replace('webservices.', '')}`,
        BrowseNodeId: nodeId,
        ItemCount: itemCount,
        MinSavingPercent: minSavingPercent,
        SortBy: 'Featured', // proxy de bestseller dentro da categoria
        Resources: SEARCH_RESOURCES,
      };
      try {
        const { items, errors } = await searchItemsWithRetry(req);
        if (errors?.length) logger.warn({ nodeId, errors }, 'PA-API SearchItems node error');
        for (const it of items) {
          const offer = paapiItemToRawOffer(it);
          if (offer) all.push(offer);
        }
      } catch (err) {
        logger.error({ err, nodeId }, 'PA-API SearchItems failed for node — pulando');
      }
      await new Promise((r) => setTimeout(r, 1200)); // throttle entre chamadas
    }

    logger.info({ nodes: browseNodeIds.length, offers: all.length }, 'PA-API fetch done');
    return all;
  },
};
