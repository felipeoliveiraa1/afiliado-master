import { enrichShopeeFromUrl, type EnrichedShopeeProduct } from './shopee_url_enrich.js';
import { enrichAmazonFromUrl, type EnrichedAmazonProduct } from './amazon_url_enrich.js';
import {
  enrichMercadoLivreFromUrl,
  type EnrichedMercadoLivreProduct,
} from './mercadolivre_url_enrich.js';
import type { SourceKind } from '@prisma/client';

export type EnrichedAnyProduct =
  | (EnrichedShopeeProduct & { platform: 'SHOPEE' })
  | (EnrichedAmazonProduct & { platform: 'AMAZON' })
  | (EnrichedMercadoLivreProduct & { platform: 'MERCADOLIVRE' });

/** Detecta plataforma da URL (Shopee, Amazon ou Mercado Livre). Retorna null se não reconhecida. */
export function detectPlatform(url: string): SourceKind | null {
  const u = url.toLowerCase();
  if (/shopee\.com\.br|s\.shopee\.com\.br|br\.shp\.ee/.test(u)) return 'SHOPEE';
  if (/amazon\.com(\.br)?|amzn\.to|amzn\.la|a\.co/.test(u)) return 'AMAZON';
  if (
    /mercadolivre\.com\.br|mercadolibre\.com|produto\.mercadolivre|meli\.la|mercadol\.ivr\.it/.test(
      u,
    )
  ) {
    return 'MERCADOLIVRE';
  }
  return null;
}

/**
 * Dispatcher unificado — recebe qualquer URL Shopee/Amazon/Mercado Livre
 * e retorna produto enriquecido. Detecta plataforma e roteia pro enricher
 * específico.
 */
export async function enrichFromUrl(url: string): Promise<EnrichedAnyProduct> {
  const platform = detectPlatform(url);
  if (platform === 'SHOPEE') {
    const p = await enrichShopeeFromUrl(url);
    return { ...p, platform: 'SHOPEE' };
  }
  if (platform === 'AMAZON') {
    const p = await enrichAmazonFromUrl(url);
    return { ...p, platform: 'AMAZON' };
  }
  if (platform === 'MERCADOLIVRE') {
    const p = await enrichMercadoLivreFromUrl(url);
    return { ...p, platform: 'MERCADOLIVRE' };
  }
  throw new Error(
    'URL não reconhecida — aceito apenas Shopee (shopee.com.br, s.shopee.com.br, br.shp.ee), Amazon (amazon.com.br, amzn.to) e Mercado Livre (mercadolivre.com.br, meli.la)',
  );
}
