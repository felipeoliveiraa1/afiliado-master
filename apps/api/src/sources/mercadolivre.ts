import { request } from 'undici';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { searchAndAffiliateByCategory } from './mercadolivre_panel.js';
import type { RawOffer, SourceAdapter } from './types.js';

/**
 * Mercado Livre não tem API de afiliados. Usamos a API pública para descobrir
 * produtos e o usuário precisa cadastrar SKUs prioritários no Club de Afiliados
 * (mercadolivre.com.br/l/afiliados-home) para gerar o link tageado manual.
 *
 * Quando tiver o link manual, salve em Source.config.affiliateLinkBySku
 * para que o adapter retorne affiliateUrl populado.
 */

type Config = {
  affiliateLinkBySku?: Record<string, string>;
  searches?: { q: string; categoryId?: string; sort?: string }[];
};

export function makeMercadoLivreSource(config: Config = {}): SourceAdapter {
  const searches = config.searches ?? [{ q: '', sort: 'price_asc' }];
  return {
    kind: 'MERCADOLIVRE',
    async fetch(opts) {
      const limit = opts?.limit ?? 50;
      // CAMINHO PRIMÁRIO: cookie panel quando há categoria + cookie configurado.
      // Gera shortlinks meli.la oficiais (afiliação real). Public API só serve
      // como fallback porque NÃO retorna products quando a busca é só por
      // category (sem keyword `q`).
      if (opts?.categoryId && env.MERCADOLIVRE_PANEL_AUTO_ENABLED) {
        try {
          const products = await searchAndAffiliateByCategory(
            { categoryId: opts.categoryId, limit, bestSellersOnly: false },
            { maxAffiliated: limit },
          );
          return products
            .filter((p) => p.affiliateUrl)
            .map<RawOffer>((p) => ({
              externalId: p.externalId,
              title: p.title,
              imageUrl: p.imageUrl,
              price: p.price,
              originalPrice: p.originalPrice,
              discountPct: p.discountPct,
              url: p.url,
              affiliateUrl: p.affiliateUrl,
              category: opts.categoryId,
              salesCount: p.isBestSeller ? 1000 : undefined,
              raw: { panelSearch: true, isBestSeller: p.isBestSeller, seller: p.seller } as Record<string, unknown>,
            }));
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, categoryId: opts.categoryId },
            'ml panel falhou — tentando public API fallback',
          );
          // continua pro fallback abaixo
        }
      }

      // Fallback: public API (precisa keyword `q`, não funciona só com categoria)
      const dynamicSearch =
        opts?.categoryId || opts?.keyword
          ? [{ q: opts.keyword ?? '', categoryId: opts.categoryId, sort: 'sold_quantity_desc' }]
          : searches;
      const all: RawOffer[] = [];
      for (const s of dynamicSearch) {
        const params = new URLSearchParams({ limit: String(limit), sort: s.sort ?? 'sold_quantity_desc' });
        if (s.q) params.set('q', s.q);
        if (s.categoryId) params.set('category', s.categoryId);
        const url = `https://api.mercadolibre.com/sites/MLB/search?${params}`;
        const res = await request(url);
        if (res.statusCode >= 400) continue;
        type Item = {
          id: string;
          title: string;
          price: number;
          original_price?: number;
          thumbnail?: string;
          permalink: string;
          condition?: string;
          sold_quantity?: number;
          category_id?: string;
        };
        const json = (await res.body.json()) as { results?: Item[] };
        for (const i of json.results ?? []) {
          const orig = i.original_price ?? undefined;
          all.push({
            externalId: i.id,
            title: i.title,
            imageUrl: i.thumbnail?.replace('-I.jpg', '-O.jpg'),
            price: i.price,
            originalPrice: orig,
            discountPct: orig && orig > i.price ? Number((((orig - i.price) / orig) * 100).toFixed(2)) : undefined,
            url: i.permalink,
            affiliateUrl: config.affiliateLinkBySku?.[i.id],
            salesCount: i.sold_quantity,
            category: i.category_id,
            raw: i as Record<string, unknown>,
          });
        }
      }
      return all;
    },
  };
}

export const mercadoLivreSource = makeMercadoLivreSource({
  searches: [
    { q: '', sort: 'sold_quantity_desc' },
  ],
});
