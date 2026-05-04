import { fetch } from 'undici';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import type { RawOffer, SourceAdapter } from './types.js';

/**
 * Promobit é um agregador comunitário de ofertas BR que cobre todas as principais
 * marketplaces. O HTML da home tem __NEXT_DATA__ com 30+ ofertas SSR-renderizadas.
 *
 * Estratégia: extrair offers, filtrar por storeDomain (apenas marketplaces no escopo),
 * normalizar o URL do produto. O affiliateUrl é montado conforme a marketplace:
 *   - amazon.com.br → adiciona ?tag= no link real (resolvido sob demanda no dispatch)
 *   - shopee.com.br → vazio (aguarda Open API ou import manual)
 *   - mercadolivre/produto.mercadolivre → vazio (aguarda link tageado manual)
 *
 * Importante: o link que o Promobit expõe é interno (/oferta/<slug>); o redirect pra
 * marketplace é resolvido na hora do dispatch (1 request a mais), evitando guardar
 * URL stale no DB.
 */

const HOME = 'https://www.promobit.com.br/';

const ALLOWED_DOMAINS = new Set([
  'amazon.com.br',
  'shopee.com.br',
  'mercadolivre.com.br',
  'produto.mercadolivre.com.br',
]);

type PromobitOffer = {
  offerId: number;
  key: string;
  offerTitle: string;
  offerSlug: string;
  offerPrice: number;
  offerOldPrice: number;
  offerDiscontPercentage: number;
  offerPriceType?: string;
  offerPhoto?: string;
  offerCoupon?: string | null;
  offerLikes?: number;
  offerClicks?: number;
  offerComments?: number;
  offerPublished?: string;
  offerStatusName?: string;
  storeDomain?: string;
  storeName?: string;
  categoryName?: string;
  categorySlug?: string;
};

function pickJsonFromHtml(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Promobit: __NEXT_DATA__ não encontrado');
  return JSON.parse(match[1]);
}

function normalizePhoto(p?: string): string | undefined {
  if (!p) return undefined;
  if (p.startsWith('http')) return p;
  return `https://i.promobit.com.br${p}`;
}

export const promobitSource: SourceAdapter = {
  kind: 'PROMOBIT',
  async fetch(opts) {
    const limit = opts?.limit ?? 50;
    const res = await fetch(HOME, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Promobit ${res.status}`);
    const html = await res.text();
    const data = pickJsonFromHtml(html) as {
      props?: {
        pageProps?: {
          serverFeaturedOffers?: PromobitOffer[];
          serverOffers?: { offers?: PromobitOffer[] };
        };
      };
    };
    const featured = data.props?.pageProps?.serverFeaturedOffers ?? [];
    const offers = data.props?.pageProps?.serverOffers?.offers ?? [];
    const all = [...featured, ...offers];
    logger.info({ total: all.length }, 'promobit fetched');

    const out: RawOffer[] = [];
    for (const o of all) {
      if (!o.storeDomain || !ALLOWED_DOMAINS.has(o.storeDomain)) continue;
      if (out.length >= limit) break;
      const price = Number(o.offerPrice) || 0;
      if (!price) continue;
      const orig = o.offerOldPrice && o.offerOldPrice > price ? Number(o.offerOldPrice) : undefined;
      const discount =
        o.offerDiscontPercentage && o.offerDiscontPercentage > 0
          ? Number(o.offerDiscontPercentage)
          : orig
            ? Number((((orig - price) / orig) * 100).toFixed(2))
            : undefined;
      const url = `https://www.promobit.com.br/oferta/${o.offerSlug}`;
      out.push({
        externalId: `promobit-${o.offerId}`,
        title: o.offerTitle,
        imageUrl: normalizePhoto(o.offerPhoto),
        price,
        originalPrice: orig,
        discountPct: discount,
        url,
        category: o.categoryName,
        salesCount: o.offerClicks,
        rating: o.offerLikes,
        raw: o as unknown as Record<string, unknown>,
      });
    }
    return out;
  },
};

/**
 * Resolve a URL real da marketplace a partir de uma página de oferta do Promobit.
 * Usa parsing do HTML — Promobit expõe o destino em meta/og:url ou em link "Ir à loja".
 * Aplica o tag de afiliado conforme a marketplace.
 */
export async function resolvePromobitOffer(promobitUrl: string): Promise<{
  marketplace: 'amazon' | 'shopee' | 'mercadolivre' | 'unknown';
  productUrl: string;
  affiliateUrl?: string;
} | null> {
  const res = await fetch(promobitUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const html = await res.text();
  // Promobit costuma colocar o link de saída em <a class="...goto-store..." href="...">
  // ou via redirect /go/<id>. Tentar ambos.
  const gotoMatch = html.match(/href="(\/go\/[^"]+)"/);
  let target: string | null = null;
  if (gotoMatch) {
    const goRes = await fetch(`https://www.promobit.com.br${gotoMatch[1]}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'manual',
    });
    target = goRes.headers.get('location');
  }
  if (!target) {
    const ogMatch = html.match(/<meta property="(?:og:url|twitter:url)" content="([^"]+)"/);
    if (ogMatch && !ogMatch[1].includes('promobit.com.br')) target = ogMatch[1];
  }
  if (!target) return null;

  if (target.includes('amazon.com.br')) {
    const u = new URL(target);
    if (env.AMAZON_AFFILIATE_TAG) u.searchParams.set('tag', env.AMAZON_AFFILIATE_TAG);
    return { marketplace: 'amazon', productUrl: target, affiliateUrl: u.toString() };
  }
  if (target.includes('shopee.com.br')) {
    return { marketplace: 'shopee', productUrl: target };
  }
  if (target.includes('mercadolivre.com.br') || target.includes('mercadolivre.com')) {
    return { marketplace: 'mercadolivre', productUrl: target };
  }
  return { marketplace: 'unknown', productUrl: target };
}
