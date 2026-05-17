import { fetch } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import {
  generateMercadoLivreShortlink,
  MercadoLivrePanelError,
} from './mercadolivre_panel.js';
import type { RawOffer } from './types.js';

export type EnrichedMercadoLivreProduct = RawOffer & { source: 'html-scrape' };

type MlPanelConfig = { cookie?: string };

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

/**
 * Expande shortlinks ML (meli.la, mercadolivre.com/sec/) pra URL canônica
 * `mercadolivre.com.br/MLB-...` ou `mercadolivre.com.br/p/MLB...?wid=MLB...`.
 */
async function expandShortlink(url: string): Promise<string> {
  if (
    !/^https?:\/\/(meli\.la|mercadolivre\.com\/sec|mercadolibre\.com\/sec|mercadol\.ivr\.it)/.test(
      url,
    )
  ) {
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

/**
 * Extrai MLB item id de URL ML. Aceita formatos:
 *   - /MLB-12345678-... (produto direto)
 *   - /MLB12345678 (produto direto sem dash)
 *   - /p/MLB47899174?pdp_filters=item_id:MLB4032459479 (catálogo c/ item via "Compartilhar")
 *   - ...&wid=MLB4032459479 (catálogo com winning item)
 *
 * Prioriza query params (item_id, wid, itemId) sobre o path, porque /p/MLBxxx
 * é ID de CATÁLOGO. O item real vem nos params da URL gerada pelo app/site.
 */
function extractItemId(url: string): string | null {
  const m =
    url.match(/[?&]pdp_filters=item_id:(MLB-?\d{6,})/i) ||
    url.match(/[?&]wid=(MLB-?\d{6,})/i) ||
    url.match(/[?&]itemId=(MLB-?\d{6,})/i) ||
    url.match(/\/(MLB-\d{6,})/i) ||
    url.match(/\/(?!p\/)(MLB\d{6,})/i) ||
    url.match(/\bMLB-?(\d{6,})\b/i);
  if (!m) return null;
  return m[1].toUpperCase().replace(/^MLB-?/, 'MLB');
}

/**
 * Headers de navegador que ML aceita (mesmos do painel /afiliados/hub).
 * Sem isso, ML serve skeleton de ~14KB ao invés do HTML completo de ~1MB.
 */
function buildBrowserHeaders(cookie: string): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'User-Agent': DEFAULT_USER_AGENT,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'Upgrade-Insecure-Requests': '1',
    Cookie: cookie,
  };
}

/**
 * Descrição vem com entidades HTML duplas (`&amp;quot;` por ex.) — decodifica
 * em 2 camadas pra exibir limpo no preview.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;amp;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parsePrice(brStr: string): number {
  // "224,87" → 224.87 | "1.234,56" → 1234.56
  return Number(brStr.replace(/\./g, '').replace(',', '.'));
}

type ParsedProduct = {
  title: string;
  price: number;
  imageUrl?: string;
  originalPrice?: number;
  description?: string;
};

/**
 * Extrai dados do produto do HTML completo do ML (renderizado com cookie).
 *
 * Estratégia em 2 camadas:
 *   1. Meta tags `og:`/`twitter:` — sempre presentes, robustas
 *      - og:title traz "Nome do produto - R$ XXX,XX" (parse pelo separador)
 *      - og:image traz CDN URL pronta
 *      - twitter:description traz a descrição completa
 *   2. Raw regex no JSON do `__NAVIGATION_PRELOADED_STATE__` pra puxar
 *      original_price (preço riscado) que NÃO está nas meta tags
 */
export function parseMlProductFromHtml(html: string): ParsedProduct {
  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  if (!titleMatch) {
    throw new Error('Mercado Livre HTML sem og:title — provavelmente bloqueou ou cookie expirou');
  }

  let title = decodeHtmlEntities(titleMatch[1]);
  let price = 0;
  // og:title formato: "Nome do produto - R$ 224,87"
  const tm = title.match(/^(.+?)\s*-\s*R\$\s*([\d.]+,\d{2})\s*$/);
  if (tm) {
    title = tm[1].trim();
    price = parsePrice(tm[2]);
  }

  // Fallback se og:title não tinha preço: procura no JSON preloaded state
  if (price === 0) {
    const jp = html.match(/"price":\s*(\d+(?:\.\d+)?)/);
    if (jp) price = Number(jp[1]);
  }

  const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const imageUrl = imageMatch?.[1];

  const descMatch = html.match(/<meta\s+name="twitter:description"\s+content="([^"]+)"/i);
  const description = descMatch ? decodeHtmlEntities(descMatch[1]) : undefined;

  // original_price (preço riscado) — vem no JSON preloaded state perto do
  // bloco do item. Match defensivo: aceita só se > price atual.
  const origMatch = html.match(/"original_price":\s*(\d+(?:\.\d+)?)/);
  const origPriceRaw = origMatch ? Number(origMatch[1]) : undefined;
  const originalPrice = origPriceRaw && origPriceRaw > price ? origPriceRaw : undefined;

  return { title, price, imageUrl, originalPrice, description };
}

/**
 * Enriquece URL Mercado Livre → produto completo via scrape do HTML logado.
 *
 * Fluxo:
 *   1. Expande shortlink (meli.la → mercadolivre.com.br/...)
 *   2. Extrai MLB item id via regex (prioriza query params: wid, pdp_filters)
 *   3. Fetch HTML com cookie do painel — ML serve 1MB com og: tags completas
 *      (sem cookie ou sem headers de navegador, serve skeleton de ~14KB)
 *   4. Parse título/preço/imagem/originalPrice via meta tags + regex no JSON
 *   5. Gera meli.la affiliateUrl via panel (HARD-FAIL se cookie expirou)
 *
 * Custo: $0. Performance: ~1s (1MB download + parse leve).
 *
 * IMPORTANTE: a API pública `api.mercadolibre.com/items/MLB...` foi bloqueada
 * pelo PolicyAgent do ML em 2026-05 (retorna 403 PA_UNAUTHORIZED) — por isso
 * scrape do HTML é o único caminho gratuito que sobra.
 */
export async function enrichMercadoLivreFromUrl(
  url: string,
): Promise<EnrichedMercadoLivreProduct> {
  const expandedUrl = await expandShortlink(url);
  const itemId = extractItemId(expandedUrl);
  if (!itemId) {
    throw new Error(
      'URL Mercado Livre inválida — não consegui extrair o ID MLB (esperado /MLB-... ou /p/MLB...?wid=MLB...)',
    );
  }

  // Cookie do mesmo painel ML (já configurado em /settings). Sem cookie,
  // ML serve skeleton sem dados.
  const cfg = await getSettingsSection<MlPanelConfig>('mercadolivre_panel');
  if (!cfg.cookie || cfg.cookie.trim().length < 50) {
    throw new Error(
      'Cookie do Mercado Livre não configurado — configure em /settings → Mercado Livre antes de enviar links ML',
    );
  }

  // Fetch HTML completo do produto (com cookie da esposa). ML serve ~1MB.
  const htmlRes = await fetch(expandedUrl, {
    headers: buildBrowserHeaders(cfg.cookie),
    redirect: 'follow',
  });
  if (htmlRes.status === 401 || htmlRes.status === 403) {
    throw new Error(
      `Cookie do Mercado Livre EXPIROU (HTTP ${htmlRes.status} no fetch HTML) — renove em /settings → Mercado Livre antes de enviar`,
    );
  }
  if (!htmlRes.ok) {
    throw new Error(`ML retornou HTTP ${htmlRes.status} pra ${itemId} — tenta de novo daqui pouco`);
  }
  const html = await htmlRes.text();

  // Sanity check: skeleton tem ~14KB, página completa ~1MB. Se < 50KB, cookie
  // não foi aceito e o ML serviu skeleton (sem dados).
  if (html.length < 50_000) {
    throw new Error(
      `ML serviu HTML incompleto (${Math.round(html.length / 1024)}KB) pra ${itemId} — cookie pode estar inválido. Renove em /settings → Mercado Livre`,
    );
  }

  const parsed = parseMlProductFromHtml(html);
  if (!parsed.price || parsed.price <= 0) {
    throw new Error(`Não consegui extrair o preço do produto ${itemId} — pode estar fora de estoque`);
  }

  const discountPct =
    parsed.originalPrice && parsed.price > 0
      ? Number((((parsed.originalPrice - parsed.price) / parsed.originalPrice) * 100).toFixed(2))
      : undefined;

  // Gera meli.la com a tag dela. HARD-FAIL se cookie/produto bloquear —
  // nunca dispatchar URL sem affiliate link (perde comissão silenciosamente).
  let affiliateUrl: string;
  try {
    affiliateUrl = await generateMercadoLivreShortlink(expandedUrl);
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
      throw new Error(
        `Produto ${itemId} não gerou link de afiliado (provavelmente fora do programa ML). Envia manual pelo WhatsApp se quiser — aqui não vai sair sem comissão.`,
      );
    }
    throw err;
  }

  logger.info(
    { itemId, price: parsed.price, hasDiscount: !!discountPct, htmlSize: html.length },
    'ml enrich: matched via html scrape',
  );

  return {
    externalId: itemId,
    title: parsed.title,
    description: parsed.description,
    imageUrl: parsed.imageUrl,
    price: parsed.price,
    originalPrice: parsed.originalPrice,
    discountPct,
    url: expandedUrl,
    affiliateUrl,
    raw: {
      itemId,
      htmlSize: html.length,
      importedVia: 'ml-html-scrape',
    } as Record<string, unknown>,
    source: 'html-scrape',
  };
}
