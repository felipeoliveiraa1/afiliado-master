import { enrichShopeeFromUrl, type EnrichedShopeeProduct } from './shopee_url_enrich.js';
import { enrichAmazonFromUrl, type EnrichedAmazonProduct } from './amazon_url_enrich.js';
import {
  enrichMercadoLivreFromUrl,
  type EnrichedMercadoLivreProduct,
} from './mercadolivre_url_enrich.js';
import { enrichRiachueloFromUrl, type EnrichedRiachueloProduct } from './awin.js';
import type { SourceKind } from '@prisma/client';

export type EnrichedAnyProduct =
  | (EnrichedShopeeProduct & { platform: 'SHOPEE' })
  | (EnrichedAmazonProduct & { platform: 'AMAZON' })
  | (EnrichedMercadoLivreProduct & { platform: 'MERCADOLIVRE' })
  | (EnrichedRiachueloProduct & { platform: 'RIACHUELO' });

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
  if (/riachuelo\.com\.br|tidd\.ly|awin1\.com/.test(u)) {
    return 'RIACHUELO';
  }
  return null;
}

/**
 * Cache em memória do resultado de enrich por URL — evita dupla chamada Apify
 * quando o fluxo manual faz preview + dispatch pra mesma URL.
 *
 * Cada produto Amazon enriquecido custa $0.01 via Apify (pratikdani actor).
 * O fluxo manual no /import-link chama enrich em 2 etapas:
 *   1. POST /preview   → renderiza foto/preço/título pra usuária revisar
 *   2. POST /dispatch  → cria Offer + dispara mensagem
 *
 * Sem cache, o passo 2 paga Apify de novo pelo MESMO dado já buscado. Com TTL
 * de 5 min cobre o tempo típico (preview → revisar → enviar = <1 min).
 *
 * Shopee/ML são grátis (Open API / HTML scrape), mas cachear também economiza
 * latência (preview leva ~1s; dispatch fica instantâneo).
 */
const ENRICH_CACHE = new Map<string, { enriched: EnrichedAnyProduct; expiresAt: number }>();
const ENRICH_TTL_MS = 5 * 60 * 1000;
const ENRICH_CACHE_MAX = 500;

function evictExpired(): void {
  const now = Date.now();
  for (const [url, entry] of ENRICH_CACHE) {
    if (entry.expiresAt <= now) ENRICH_CACHE.delete(url);
  }
}

/**
 * Dispatcher unificado — recebe qualquer URL Shopee/Amazon/Mercado Livre
 * e retorna produto enriquecido. Detecta plataforma e roteia pro enricher
 * específico. Cacheia por 5 min pra evitar dupla chamada paga (Amazon).
 */
export async function enrichFromUrl(url: string): Promise<EnrichedAnyProduct> {
  const cached = ENRICH_CACHE.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enriched;
  }

  const platform = detectPlatform(url);
  let enriched: EnrichedAnyProduct;
  if (platform === 'SHOPEE') {
    const p = await enrichShopeeFromUrl(url);
    enriched = { ...p, platform: 'SHOPEE' };
  } else if (platform === 'AMAZON') {
    const p = await enrichAmazonFromUrl(url);
    enriched = { ...p, platform: 'AMAZON' };
  } else if (platform === 'MERCADOLIVRE') {
    const p = await enrichMercadoLivreFromUrl(url);
    enriched = { ...p, platform: 'MERCADOLIVRE' };
  } else if (platform === 'RIACHUELO') {
    const p = await enrichRiachueloFromUrl(url);
    enriched = { ...p, platform: 'RIACHUELO' };
  } else {
    throw new Error(
      'URL não reconhecida — aceito Shopee, Amazon, Mercado Livre e Riachuelo (riachuelo.com.br)',
    );
  }

  // Cap simples — quando atinge o teto, limpa expirados; se ainda lotado,
  // remove a entrada mais antiga (FIFO via insertion order do Map).
  if (ENRICH_CACHE.size >= ENRICH_CACHE_MAX) {
    evictExpired();
    if (ENRICH_CACHE.size >= ENRICH_CACHE_MAX) {
      const firstKey = ENRICH_CACHE.keys().next().value;
      if (firstKey) ENRICH_CACHE.delete(firstKey);
    }
  }
  ENRICH_CACHE.set(url, { enriched, expiresAt: Date.now() + ENRICH_TTL_MS });
  return enriched;
}
