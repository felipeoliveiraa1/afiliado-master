import { fetch } from 'undici';
import { logger } from '@/lib/logger.js';
import {
  generateMercadoLivreShortlink,
  MercadoLivrePanelError,
} from './mercadolivre_panel.js';
import type { RawOffer } from './types.js';

export type EnrichedMercadoLivreProduct = RawOffer & { source: 'public-api' };

const ITEM_API = 'https://api.mercadolibre.com/items';

type MlPicture = { id?: string; url?: string; secure_url?: string };
type MlItem = {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  available_quantity?: number;
  sold_quantity?: number;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  pictures?: MlPicture[];
  condition?: string;
  seller_id?: number;
  category_id?: string;
};

/**
 * Expande shortlinks ML (meli.la, mercadolivre.com/sec/) pra URL canônica
 * `mercadolivre.com.br/MLB-...`. Segue o redirect que o app/painel gera.
 *
 * IMPORTANTE: o meli.la original é mantido pelo caller como affiliateUrl —
 * essa função só serve pra extrair o MLB id do produto destino.
 */
async function expandShortlink(url: string): Promise<string> {
  if (!/^https?:\/\/(meli\.la|mercadolivre\.com\/sec|mercadolibre\.com\/sec|mercadol\.ivr\.it)/.test(url)) {
    return url;
  }
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    return res.url || url;
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, 'ml shortlink expand failed');
    return url;
  }
}

/** Extrai MLB id de URL ML. Aceita `MLB-12345678` ou `MLB12345678`. */
function extractItemId(url: string): string | null {
  const m =
    url.match(/\/(MLB-?\d{6,})/i) ||
    url.match(/\bMLB-?(\d{6,})\b/i) ||
    url.match(/itemId=(MLB-?\d{6,})/i);
  if (!m) return null;
  // Normaliza removendo o `-` (a API pública aceita `MLB12345678` sem dash)
  return m[1].toUpperCase().replace(/^MLB-?/, 'MLB');
}

function pickImage(item: MlItem): string | undefined {
  const first = item.pictures?.[0];
  return first?.secure_url || first?.url || item.secure_thumbnail || item.thumbnail || undefined;
}

/**
 * Enriquece URL Mercado Livre → produto completo via API pública
 * (`api.mercadolibre.com/items/MLB...`) e gera affiliate URL via painel cookie.
 *
 * Fluxo:
 *   1. Expande shortlink (meli.la → mercadolivre.com.br/MLB-...)
 *   2. Extrai MLB id via regex
 *   3. GET /items/{MLB_ID} — title, price, original_price, pictures, permalink
 *   4. Tenta generateMercadoLivreShortlink(permalink) — gera meli.la com sua tag
 *   5. Se falhar (cookie expirou ou produto fora do programa), affiliateUrl = URL original
 *
 * Custo: $0 (API pública é gratuita, painel ML também).
 */
export async function enrichMercadoLivreFromUrl(
  url: string,
): Promise<EnrichedMercadoLivreProduct> {
  const expandedUrl = await expandShortlink(url);
  const itemId = extractItemId(expandedUrl);
  if (!itemId) {
    throw new Error(
      'URL Mercado Livre inválida — não consegui extrair o ID MLB (esperado /MLB-12345678 ou /MLB12345678)',
    );
  }

  const apiUrl = `${ITEM_API}/${itemId}`;
  const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`ML: produto ${itemId} não encontrado (404 na API pública)`);
    }
    throw new Error(`ML public API HTTP ${res.status} pra ${itemId}`);
  }
  const item = (await res.json()) as MlItem;
  if (!item.id) {
    throw new Error(`ML: resposta inválida pra ${itemId}`);
  }

  const permalink = item.permalink ?? expandedUrl;
  const price = typeof item.price === 'number' ? item.price : 0;
  const originalPrice =
    typeof item.original_price === 'number' && item.original_price > price
      ? item.original_price
      : undefined;
  const discountPct =
    originalPrice && price > 0
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;

  // Gera shortlink meli.la com a tag dela. HARD-FAIL se não conseguir —
  // nunca despachar URL sem affiliate link (perde comissão silenciosamente).
  // Erros traduzidos pra mensagens acionáveis na UI.
  let affiliateUrl: string;
  try {
    affiliateUrl = await generateMercadoLivreShortlink(permalink);
  } catch (err) {
    if (err instanceof MercadoLivrePanelError) {
      logger.warn(
        { itemId, kind: err.kind, msg: err.message },
        'ml enrich: shortlink falhou — bloqueando dispatch',
      );
      if (err.kind === 'auth') {
        throw new Error(
          'Cookie do Mercado Livre EXPIROU — renove em /settings → Mercado Livre antes de enviar (senão a comissão não cai)',
        );
      }
      if (err.kind === 'config') {
        throw new Error(
          'Mercado Livre não configurado — configure cookie em /settings → Mercado Livre antes de enviar',
        );
      }
      if (err.kind === 'rate') {
        throw new Error(
          'Mercado Livre bloqueou o painel temporariamente (rate limit) — tenta de novo daqui 1h',
        );
      }
      // unknown/parse — geralmente produto fora do programa de afiliados
      throw new Error(
        `Produto ${itemId} não gerou link de afiliado (provavelmente fora do programa ML). Envia manual pelo WhatsApp se quiser — aqui não vai sair sem comissão.`,
      );
    }
    throw err;
  }

  logger.info(
    { itemId, hasAffiliate: affiliateUrl !== permalink, price },
    'ml enrich: matched via public api',
  );

  return {
    externalId: itemId,
    title: item.title ?? `Produto ML ${itemId}`,
    imageUrl: pickImage(item),
    price,
    originalPrice,
    discountPct,
    salesCount: item.sold_quantity,
    url: permalink,
    affiliateUrl,
    raw: {
      itemId,
      sellerId: item.seller_id,
      categoryId: item.category_id,
      condition: item.condition,
      importedVia: 'ml-public-api',
    } as Record<string, unknown>,
    source: 'public-api',
  };
}
