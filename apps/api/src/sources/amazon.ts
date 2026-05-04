import { env } from '@/config/env.js';
import { runApifyActor } from './apify-client.js';
import type { RawOffer, SourceAdapter } from './types.js';

/**
 * Amazon BR é Cloudflare-pesado. Estratégia: delegar scraping ao Apify
 * (actor `junglee/amazon-bestsellers-scraper` ou similar), juntar nossa tag
 * de afiliado no link final.
 *
 * Configurar APIFY_TOKEN e APIFY_AMAZON_ACTOR no .env (default já apontado).
 */

function withAffiliateTag(url: string): string {
  if (!env.AMAZON_AFFILIATE_TAG) return url;
  const u = new URL(url);
  u.searchParams.set('tag', env.AMAZON_AFFILIATE_TAG);
  return u.toString();
}

export const amazonSource: SourceAdapter = {
  kind: 'AMAZON',
  async fetch(opts) {
    const limit = opts?.limit ?? 30;
    // Esquema de input depende do actor escolhido — abaixo é o do junglee/amazon-bestsellers
    const input = {
      domainCode: 'com.br',
      categoryUrls: ['https://www.amazon.com.br/gp/bestsellers/'],
      maxItemsPerStartUrl: limit,
    };
    type Item = {
      asin?: string;
      title?: string;
      price?: { value?: number };
      listPrice?: { value?: number };
      thumbnailImage?: string;
      url?: string;
      stars?: number;
      reviewsCount?: number;
      bestSellersRank?: { category?: string }[];
    };
    const items = await runApifyActor<Item>(env.APIFY_AMAZON_ACTOR, input);
    return items
      .filter((i) => i.asin && i.title && i.url && i.price?.value)
      .map<RawOffer>((i) => {
        const price = Number(i.price!.value);
        const orig = i.listPrice?.value ? Number(i.listPrice.value) : undefined;
        return {
          externalId: i.asin!,
          title: i.title!,
          imageUrl: i.thumbnailImage,
          price,
          originalPrice: orig,
          discountPct: orig && orig > price ? Number((((orig - price) / orig) * 100).toFixed(2)) : undefined,
          url: i.url!,
          affiliateUrl: withAffiliateTag(i.url!),
          rating: i.stars,
          ratingCount: i.reviewsCount,
          category: i.bestSellersRank?.[0]?.category,
          raw: i as Record<string, unknown>,
        };
      });
  },
};
