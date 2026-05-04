import { env } from '@/config/env.js';
import { runApifyActor } from './apify-client.js';
import type { RawOffer, SourceAdapter } from './types.js';

/**
 * Mercado Livre via Apify. Diferente da API pública (api.mercadolibre.com)
 * que tem cobertura limitada de promoções e bestsellers, o Apify roda browser
 * real com proxies residenciais — sem usar nossa conta, sem risco de ban.
 *
 * Cobre cenários que a API pública não retorna direito:
 *  - Vitrine de Ofertas (mercadolivre.com.br/ofertas)
 *  - Ofertas relâmpago / Clube ML
 *  - Bestsellers por categoria com filtros visuais
 *
 * IMPORTANTE: Apify só capta OS DADOS do produto. O shortlink de afiliado
 * continua manual (painel ML) ou via cookie hijacking (se ativado).
 *
 * Schema de input depende do actor escolhido. Default `apify/mercadolibre-scraper`.
 * Override via APIFY_MERCADOLIVRE_ACTOR.
 */

type ApifyItem = {
  id?: string;
  itemId?: string;
  url?: string;
  title?: string;
  name?: string;
  price?: number | { value?: number };
  originalPrice?: number;
  listPrice?: { value?: number };
  imageUrl?: string;
  thumbnail?: string;
  rating?: number;
  reviewsCount?: number;
  soldQuantity?: number;
  category?: string;
  installments?: { quantity?: number };
};

type Config = {
  startUrls?: string[];
  affiliateLinkBySku?: Record<string, string>;
  maxItems?: number;
};

function resolveStartUrls(config: Config): string[] {
  if (config.startUrls?.length) return config.startUrls;
  if (env.MERCADOLIVRE_APIFY_START_URLS) {
    return env.MERCADOLIVRE_APIFY_START_URLS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ['https://www.mercadolivre.com.br/ofertas'];
}

function pickPrice(value: ApifyItem['price']): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof value.value === 'number') return value.value;
  return undefined;
}

function pickOriginalPrice(item: ApifyItem): number | undefined {
  if (typeof item.originalPrice === 'number') return item.originalPrice;
  if (typeof item.listPrice?.value === 'number') return item.listPrice.value;
  return undefined;
}

function calcDiscountPct(price: number, original: number | undefined): number | undefined {
  if (!original || original <= price) return undefined;
  return Number((((original - price) / original) * 100).toFixed(2));
}

export function makeMercadoLivreApifySource(config: Config = {}): SourceAdapter {
  return {
    kind: 'MERCADOLIVRE',
    async fetch(opts) {
      const startUrls = resolveStartUrls(config);
      const maxItems = opts?.limit ?? config.maxItems ?? 50;
      const input = {
        startUrls: startUrls.map((url) => ({ url })),
        maxItems,
        endPage: 1,
        proxyConfiguration: { useApifyProxy: true },
      };
      const items = await runApifyActor<ApifyItem>(env.APIFY_MERCADOLIVRE_ACTOR, input);
      return items
        .filter((i) => (i.id || i.itemId) && (i.title || i.name) && i.url)
        .map<RawOffer>((i) => {
          const externalId = (i.id ?? i.itemId)!;
          const title = (i.title ?? i.name)!;
          const price = pickPrice(i.price) ?? 0;
          const originalPrice = pickOriginalPrice(i);
          return {
            externalId,
            title,
            imageUrl: i.imageUrl ?? i.thumbnail,
            price,
            originalPrice,
            discountPct: calcDiscountPct(price, originalPrice),
            url: i.url!,
            affiliateUrl: config.affiliateLinkBySku?.[externalId],
            rating: i.rating,
            ratingCount: i.reviewsCount,
            salesCount: i.soldQuantity,
            category: i.category,
            raw: i as Record<string, unknown>,
          };
        })
        .filter((o) => o.price > 0);
    },
  };
}

export const mercadoLivreApifySource = makeMercadoLivreApifySource();
