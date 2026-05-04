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
  amazonCategoryUrls?: string; // CSV de URLs Amazon (sobrescreve keywords se setado)
  amazonMaxPerUrl?: number; // hard cap por URL (controle de custo Apify)
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

/**
 * Defaults: search por categoria ordenado por popularidade (proxy de
 * vendas / bestsellers).
 *
 * IMPORTANTE: o actor `junglee/free-amazon-product-scraper` NÃO aceita
 * URLs `/gp/goldbox` nem `/gp/bestsellers/<cat>` (rejeita com "No start
 * URLs have valid format"). Apenas:
 *   - /dp/<ASIN>           (produto único)
 *   - /s?i=<category>      (search por categoria)
 *   - /s?k=<keyword>       (search por keyword)
 *   - /b?node=<id>         (node search)
 *
 * Usamos `/s?i=<cat>&s=exact-aware-popularity-rank` que ordena por
 * popularidade — efeito similar a bestsellers, sem usar URL bloqueada.
 *
 * Custo a 3 produtos/URL × 4 URLs = 12 produtos × $0,012 = $0,144/fetch.
 * Cron diário (1x/dia) × 30 = ~$4,30/mês.
 */
const DEFAULT_DEAL_URLS_BR = [
  'https://www.amazon.com.br/s?i=electronics&s=exact-aware-popularity-rank',
  'https://www.amazon.com.br/s?i=home&s=exact-aware-popularity-rank',
  'https://www.amazon.com.br/s?i=kitchen&s=exact-aware-popularity-rank',
  'https://www.amazon.com.br/s?i=health-personal-care&s=exact-aware-popularity-rank',
];

const AMAZON_DOMAIN_BY_COUNTRY: Record<string, string> = {
  BR: 'amazon.com.br',
  US: 'amazon.com',
  MX: 'amazon.com.mx',
  CA: 'amazon.ca',
  ES: 'amazon.es',
  DE: 'amazon.de',
  IT: 'amazon.it',
  FR: 'amazon.fr',
  UK: 'amazon.co.uk',
  GB: 'amazon.co.uk',
};

function keywordToSearchUrl(keyword: string, country: string): string {
  const domain = AMAZON_DOMAIN_BY_COUNTRY[country.toUpperCase()] ?? 'amazon.com.br';
  // s=exact-aware-popularity-rank ordena por popularidade (proxy de vendas)
  // — melhora qualidade vs ordenação por relevância default
  return `https://www.${domain}/s?k=${encodeURIComponent(keyword.trim())}&s=exact-aware-popularity-rank`;
}

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
    const actor = cfg.apifyAmazonActor || 'junglee~free-amazon-product-scraper';
    const country = cfg.amazonCountry || 'BR';

    // Constrói URLs de busca/categoria. Prioridade:
    //   1) amazonCategoryUrls (CSV de URLs completas — mais preciso, suporta
    //      /deals, /gp/goldbox, /gp/bestsellers/<cat>, /s?k=...&rh=pct-off, etc.)
    //   2) amazonKeywords (CSV → vira search URL com sort por popularidade)
    //   3) DEFAULT_DEAL_URLS_BR (Amazon Deals + Goldbox — foco em promoções)
    let urls: string[] = [];
    if (cfg.amazonCategoryUrls?.trim()) {
      urls = cfg.amazonCategoryUrls.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (cfg.amazonKeywords?.trim()) {
      urls = cfg.amazonKeywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((k) => keywordToSearchUrl(k, country));
    } else {
      // Default: foco em promoções (não keywords genéricas)
      urls = country.toUpperCase() === 'BR' ? DEFAULT_DEAL_URLS_BR : DEFAULT_KEYWORDS.map((k) => keywordToSearchUrl(k, country));
    }

    // CONTROLE DE CUSTO Apify ($0.012/result):
    // - amazonMaxPerUrl é HARD CAP por URL (default 5). Setting precede limit.
    // - perUrl efetivo = min(amazonMaxPerUrl, ceil(limit/N))
    // Fórmula garante que custo NUNCA passa de amazonMaxPerUrl × N URLs × $0.012
    const hardCap = cfg.amazonMaxPerUrl ?? 3;
    const desired = Math.max(1, Math.ceil(limit / Math.max(1, urls.length)));
    const perUrl = Math.min(hardCap, desired);

    // Schema do actor `junglee/free-amazon-product-scraper`:
    //   { categoryUrls: [{url}], maxItemsPerStartUrl, ... }
    const input = {
      categoryUrls: urls.map((url) => ({ url })),
      maxItemsPerStartUrl: perUrl,
      maxSearchPagesPerStartUrl: 1,
      scrapeProductDetails: true,
      useCaptchaSolver: false,
    };
    type Item = {
      asin?: string;
      title?: string;
      price?: { value?: number };
      listPrice?: { value?: number };
      priceRange?: { minPrice?: number; maxPrice?: number };
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
        // PROTEÇÃO contra preço degenerado do actor:
        // - Se `price.value` <= 5 (impossível na Amazon, frete mínimo é maior),
        //   tenta usar priceRange.minPrice como verdade. Se ainda assim ficar baixo,
        //   o filtro abaixo descarta a oferta.
        // - Caso típico: smartphone com cupom/variante sumida vira R$ 1.94 raw.
        let price = Number(i.price!.value);
        if (price <= 5 && i.priceRange?.minPrice && i.priceRange.minPrice > 5) {
          price = Number(i.priceRange.minPrice);
        }
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
      })
      // Filtro de sanidade pós-correção: ainda assim qualquer preço <=5 é
      // bug do actor — melhor perder a oferta do que mandar pro grupo
      // "Galaxy A56 por R$1,94" e parecer golpe.
      .filter((o) => o.price > 5);
  },
};
