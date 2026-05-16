import { enrichShopeeFromUrl, type EnrichedShopeeProduct } from './shopee_url_enrich.js';
import { enrichAmazonFromUrl, type EnrichedAmazonProduct } from './amazon_url_enrich.js';
import type { SourceKind } from '@prisma/client';

export type EnrichedAnyProduct =
  | (EnrichedShopeeProduct & { platform: 'SHOPEE' })
  | (EnrichedAmazonProduct & { platform: 'AMAZON' });

/** Detecta plataforma da URL (Shopee vs Amazon). Retorna null se não reconhecida. */
export function detectPlatform(url: string): SourceKind | null {
  const u = url.toLowerCase();
  if (/shopee\.com\.br|s\.shopee\.com\.br|br\.shp\.ee/.test(u)) return 'SHOPEE';
  if (/amazon\.com(\.br)?|amzn\.to|amzn\.la|a\.co/.test(u)) return 'AMAZON';
  return null;
}

/**
 * Dispatcher unificado — recebe qualquer URL Shopee/Amazon e retorna produto enriquecido.
 * Detecta plataforma e roteia pro enricher específico.
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
  throw new Error('URL não reconhecida — aceito apenas Shopee (shopee.com.br, s.shopee.com.br, br.shp.ee) e Amazon (amazon.com.br, amzn.to)');
}
