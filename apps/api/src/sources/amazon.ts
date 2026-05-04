import { runApifyActor } from './apify-client.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { RawOffer, SourceAdapter } from './types.js';

/**
 * Amazon BR — captação via Apify (sem precisar PA-API oficial enquanto o
 * volume de vendas não destrava). Configuração via /settings → Marketplaces:
 *   - amazonAffiliateTag: SEU-TAG-20 (gera ?tag= no link)
 *   - apifyToken: token Apify (apify.com/account/integrations)
 *   - apifyAmazonActor: default `junglee~amazon-bestsellers-scraper`
 */

type MarketplacesCfg = {
  amazonAffiliateTag?: string;
  apifyToken?: string;
  apifyAmazonActor?: string;
  amazonKeywords?: string; // CSV: "fone bluetooth, smartwatch, mochila"
  amazonCountry?: string; // default 'BR'
};

const DEFAULT_KEYWORDS = [
  'fone bluetooth',
  'smartwatch',
  'echo dot',
  'mochila',
  'kindle',
  'air fryer',
  'cafeteira',
  'caixa de som bluetooth',
];

async function getCfg(): Promise<MarketplacesCfg> {
  return getSettingsSection<MarketplacesCfg>('marketplaces');
}

function withAffiliateTag(url: string, tag?: string): string {
  if (!tag) return url;
  const u = new URL(url);
  u.searchParams.set('tag', tag);
  return u.toString();
}

export const amazonSource: SourceAdapter = {
  kind: 'AMAZON',
  async fetch(opts) {
    const cfg = await getCfg();
    if (!cfg.apifyToken) {
      throw new Error(
        'apifyToken não configurado — Acesse /settings → Marketplaces e cole seu token Apify (apify.com/account/integrations).',
      );
    }
    const limit = opts?.limit ?? 30;
    const actor = cfg.apifyAmazonActor || 'junglee~Amazon-crawler';
    const country = cfg.amazonCountry || 'BR';
    // Keywords: CSV no /settings ou defaults de bestsellers
    const keywords = cfg.amazonKeywords?.trim()
      ? cfg.amazonKeywords.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_KEYWORDS;
    // Schema do actor `junglee/Amazon-crawler`:
    //   { country, keywords, maxItems, ... }
    // (refs: exampleRunInput retornado pela API do Apify)
    const input = {
      country,
      keywords,
      maxItems: limit,
      liveView: false,
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
    const items = await runApifyActor<Item>(actor, input, cfg.apifyToken);
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
          affiliateUrl: withAffiliateTag(i.url!, cfg.amazonAffiliateTag),
          rating: i.stars,
          ratingCount: i.reviewsCount,
          category: i.bestSellersRank?.[0]?.category,
          raw: i as Record<string, unknown>,
        };
      });
  },
};
