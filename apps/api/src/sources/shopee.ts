import { createHash } from 'node:crypto';
import { request } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { FetchOpts, RawOffer, SourceAdapter } from './types.js';

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

type ShopeeCfg = { shopeeAppId?: string; shopeeAppSecret?: string };

async function getCreds(): Promise<{ appId: string; appSecret: string }> {
  const cfg = await getSettingsSection<ShopeeCfg>('marketplaces');
  const appId = cfg.shopeeAppId ?? '';
  const appSecret = cfg.shopeeAppSecret ?? '';
  if (!appId || !appSecret) {
    throw new Error(
      'Shopee Open API não configurada — preencha shopeeAppId e shopeeAppSecret em /settings → Marketplaces. Cadastre-se em https://affiliate.shopee.com.br',
    );
  }
  return { appId, appSecret };
}

function sign(appId: string, appSecret: string, payload: string, ts: number): string {
  const str = `${appId}${ts}${payload}${appSecret}`;
  return createHash('sha256').update(str).digest('hex');
}

async function gql<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { appId, appSecret } = await getCreds();
  const payload = JSON.stringify({ query, variables });
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(appId, appSecret, payload, ts);
  const res = await request(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}`,
    },
    body: payload,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`Shopee ${res.statusCode}: ${text}`);
  const json = JSON.parse(text) as { data?: T; errors?: unknown };
  if (json.errors) {
    logger.error({ errors: json.errors }, 'shopee gql error');
    throw new Error(`Shopee GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

/**
 * Shopee Affiliate Open API — Get Product Offer List.
 * Doc: https://affiliate.shopee.com.br/open_api/list?type=product_offer
 *
 * Campos importantes:
 *   - commission: valor R$ (não rate)
 *   - productCatIds: array Lv1/Lv2/Lv3 (categorias seller)
 *   - shopType: [1]=Mall, [2]=Preferred, [4]=PreferredPlus
 *   - priceDiscountRate: % off (Int 10 = 10%)
 *   - sales: count vendas
 *
 * sortType:
 *   1 = RELEVANCE_DESC (só com keyword)
 *   2 = ITEM_SOLD_DESC (bestseller — DEFAULT)
 *   5 = COMMISSION_DESC (mais lucrativo)
 *
 * Shopee NÃO tem cupom como ML — offerLink já vem com benefício embutido.
 */
type ShopeeFetchOpts = {
  limit?: number;
  keyword?: string;
  productCatId?: number;
  sortType?: number;
  onlyMall?: boolean;
  onlyKeySellers?: boolean;
};

export const shopeeSource: SourceAdapter = {
  kind: 'SHOPEE',
  async fetch(opts) {
    // Mapeia FetchOpts genérico → params Shopee
    return fetchShopeeProducts({
      limit: opts?.limit,
      keyword: opts?.keyword,
      productCatId: opts?.categoryId ? Number(opts.categoryId) : undefined,
      sortType: 2, // ITEM_SOLD_DESC = bestseller
      onlyMall: opts?.onlyMall,
      onlyKeySellers: opts?.onlyKeySellers,
    });
  },
};

export async function fetchShopeeProducts(opts?: ShopeeFetchOpts): Promise<RawOffer[]> {
  const limit = opts?.limit ?? 30;
  const keyword = opts?.keyword ?? '';
  const sortType = opts?.sortType ?? 2;
  const productCatId = opts?.productCatId;
  const isKeySeller = opts?.onlyKeySellers;

  const query = `
    query ProductOfferV2(
      $keyword: String
      $limit: Int
      $sortType: Int
      $productCatId: Int
      $isKeySeller: Boolean
    ) {
      productOfferV2(
        keyword: $keyword
        limit: $limit
        sortType: $sortType
        productCatId: $productCatId
        isKeySeller: $isKeySeller
      ) {
        nodes {
          itemId
          productName
          commissionRate
          sellerCommissionRate
          shopeeCommissionRate
          commission
          sales
          imageUrl
          priceMin
          priceMax
          priceDiscountRate
          ratingStar
          shopId
          shopName
          shopType
          productCatIds
          offerLink
          productLink
          periodStartTime
          periodEndTime
        }
        pageInfo { page limit hasNextPage }
      }
    }
  `;
  type Node = {
    itemId: number;
    productName: string;
    commissionRate?: string;
    sellerCommissionRate?: string;
    shopeeCommissionRate?: string;
    commission?: string;
    sales?: number;
    imageUrl?: string;
    priceMin?: string;
    priceMax?: string;
    priceDiscountRate?: number;
    ratingStar?: string;
    shopId?: number;
    shopName?: string;
    shopType?: number[];
    productCatIds?: number[];
    offerLink?: string;
    productLink?: string;
    periodStartTime?: number;
    periodEndTime?: number;
  };
  type Resp = { productOfferV2: { nodes: Node[] } };
  const data = await gql<Resp>(query, {
    keyword,
    limit,
    sortType,
    productCatId,
    isKeySeller,
  });
  const nodes = data.productOfferV2?.nodes ?? [];
  let result = nodes.map<RawOffer>((n) => {
    const price = Number(n.priceMin ?? '0');
    const priceMax = n.priceMax ? Number(n.priceMax) : undefined;
    const discountPct = n.priceDiscountRate ? Number(n.priceDiscountRate) : undefined;
    // commissionRate vem como string decimal "0.0123" = 1.23%
    const commissionPct = n.commissionRate ? Number(n.commissionRate) * 100 : undefined;
    // shopType[0]==1 = Shopee Mall (oficial)
    const isOfficialMall = Array.isArray(n.shopType) && n.shopType.includes(1);
    return {
      externalId: String(n.itemId),
      title: n.productName,
      imageUrl: n.imageUrl,
      price,
      originalPrice: priceMax && priceMax > price ? priceMax : undefined,
      discountPct,
      url: n.productLink ?? '',
      // offerLink já vem com tag de afiliado + cashback embutido
      affiliateUrl: n.offerLink,
      commissionPct,
      rating: n.ratingStar ? Number(n.ratingStar) : undefined,
      salesCount: n.sales,
      category: n.productCatIds?.[0] ? String(n.productCatIds[0]) : undefined,
      raw: {
        ...n,
        seller: n.shopName, // pra linha "Achado em Shopee na loja oficial X"
        isOfficialMall,
      },
    };
  });
  if (opts?.onlyMall) {
    result = result.filter(
      (o) => (o.raw as { isOfficialMall?: boolean })?.isOfficialMall === true,
    );
  }
  return result;
}

/**
 * Importa produtos de uma loja via Apify web-scraper (renderiza JS — Shopee é SPA).
 *
 * Como funciona:
 *   1. Apify abre Chrome headless na URL da loja
 *   2. Scrolla a página pra carregar produtos (lazy-loaded)
 *   3. Extrai dados via DOM (productLink, productName, price, image)
 *   4. Devolve lista pra gente processar
 *
 * Pra cada produto retornado, geramos shortlink afiliado via productOffer V2.
 * Cobra ~$0.001 por loja importada (free tier 5USD = ~5000 lojas).
 */
export async function fetchShopeeShopViaApify(
  shopUrl: string,
  apifyToken: string,
  maxItems = 200,
): Promise<RawOffer[]> {
  const { runApifyActor } = await import('./apify-client.js');
  // pageFunction roda dentro do Chrome headless e extrai dados do DOM Shopee.
  // Estratégia: aguarda 15s pra SPA carregar + scroll lento pra trigger lazy
  // load + extrai TODOS os <a> que apontam pra produto Shopee (tanto formato
  // /product/SHOPID/ITEMID quanto -i.SHOPID.ITEMID).
  const pageFunction = `async function pageFunction(context) {
    const { page, log } = context;
    // Espera carga inicial
    await new Promise(r => setTimeout(r, 5000));
    log.info('Page loaded, scrolling to trigger lazy load');
    // Scroll lento (Shopee tem virtualização)
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await new Promise(r => setTimeout(r, 1200));
    }
    // Volta pro topo pra render thumbnails que podem ter sido descartados
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 2000));
    log.info('Extracting products');
    const result = await page.evaluate(() => {
      const items = [];
      const seen = new Set();
      // Pega TODOS os <a> da página, filtra os que parecem produto
      document.querySelectorAll('a').forEach((a) => {
        const href = a.href || '';
        // Match formatos: /product/SHOP/ITEM ou /SLUG-i.SHOP.ITEM ou /...i.SHOP.ITEM
        const m1 = href.match(/\\/product\\/(\\d+)\\/(\\d+)/);
        const m2 = href.match(/[\\.\\-]i\\.(\\d+)\\.(\\d+)/);
        const m = m1 || m2;
        if (!m) return;
        const shopId = m[1];
        const itemId = m[2];
        const key = shopId + '_' + itemId;
        if (seen.has(key)) return;
        seen.add(key);
        // Nome: texto do <a> ou descendente
        const text = (a.textContent || '').replace(/\\s+/g, ' ').trim();
        const img = a.querySelector('img');
        const imgSrc = img?.src || img?.getAttribute('data-src') || '';
        items.push({
          shopId,
          itemId,
          name: text.slice(0, 200),
          img: imgSrc,
          url: href,
          price: ''
        });
      });
      return { items, totalLinks: document.querySelectorAll('a').length };
    });
    log.info(\`Found \${result.totalLinks} links, \${result.items.length} products\`);
    return result.items;
  }`;

  const items = await runApifyActor<{
    shopId: string;
    itemId: string;
    name: string;
    price: string;
    img: string;
    url: string;
  }>(
    'apify~web-scraper',
    {
      startUrls: [{ url: shopUrl }],
      pageFunction,
      maxRequestsPerCrawl: 1,
      proxyConfiguration: { useApifyProxy: true },
      runMode: 'PRODUCTION',
    },
    apifyToken,
  );
  // De-dupe by itemId (same product can appear multiple times)
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (!i.itemId || seen.has(i.itemId)) return false;
    seen.add(i.itemId);
    return true;
  }).slice(0, maxItems);
  // Pra cada produto, gera shortlink afiliado
  const result: RawOffer[] = [];
  for (const i of unique) {
    let affiliateUrl: string | undefined;
    try {
      affiliateUrl = await generateShopeeShortLink(i.url);
    } catch (err) {
      logger.warn({ err, itemId: i.itemId }, 'apify shop: shortlink falhou — pula');
      continue;
    }
    result.push({
      externalId: i.itemId,
      title: i.name,
      imageUrl: i.img,
      price: Number(i.price) || 0,
      url: i.url,
      affiliateUrl,
      raw: {
        shopId: i.shopId,
        importedFrom: 'apify-shop',
        source: shopUrl,
      },
    });
  }
  logger.info({ shopUrl, found: items.length, imported: result.length }, 'apify shop import');
  return result;
}

/**
 * Importa produtos de uma LOJA específica via API V1 (productOffer aceita shopName).
 * V2 não aceita shopName como filtro — só V1.
 *
 * Ex: fetchShopeeProductsByShop("Mundo Kids") → produtos da loja mundo.kidssc
 *
 * Pagina automaticamente até atingir maxPages (default 5 = ~100 produtos).
 * Cada page: 20 produtos. Cuidado com TPS (1 req/sec inicial).
 *
 * @deprecated V1 foi descontinuada pela Shopee em 2025 — use fetchShopeeShopViaApify
 */
export async function fetchShopeeProductsByShop(
  shopName: string,
  opts: { maxPages?: number; perPage?: number } = {},
): Promise<RawOffer[]> {
  const maxPages = opts.maxPages ?? 5;
  const perPage = opts.perPage ?? 20;
  const query = `
    query ProductOfferV1(
      $shopName: String
      $page: Int
      $limit: Int
    ) {
      productOffer(
        shopName: $shopName
        page: $page
        limit: $limit
      ) {
        nodes {
          commissionRate
          commission
          price
          sales
          imageUrl
          productName
          shopName
          shopId
          itemLink
          shopLink
          isBrandProduct
          periodStartTime
          periodEndTime
          offerStatus
        }
        pageInfo { page limit hasNextPage }
      }
    }
  `;
  type Node = {
    commissionRate?: string;
    commission?: string;
    price?: string;
    sales?: number;
    imageUrl?: string;
    productName?: string;
    shopName?: string;
    shopId?: number;
    itemLink?: string;
    shopLink?: string;
    isBrandProduct?: boolean;
    offerStatus?: string;
  };
  type Resp = {
    productOffer: { nodes: Node[]; pageInfo: { hasNextPage: boolean } };
  };
  const all: RawOffer[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await gql<Resp>(query, { shopName, page, limit: perPage });
    const nodes = data.productOffer?.nodes ?? [];
    for (const n of nodes) {
      if (!n.itemLink || !n.productName) continue;
      // Extrai itemId do itemLink (formato shopee.com.br/product/SHOPID/ITEMID)
      const match = n.itemLink.match(/\/product\/(\d+)\/(\d+)/);
      const itemId = match?.[2] ?? '';
      if (!itemId) continue;
      const price = Number(n.price ?? '0');
      const commissionPct = n.commissionRate ? Number(n.commissionRate) * 100 : undefined;
      // V1 não retorna offerLink — gera via generateShortLink
      let affiliateUrl: string | undefined;
      try {
        affiliateUrl = await generateShopeeShortLink(n.itemLink);
      } catch (err) {
        logger.warn({ err, itemId }, 'shop import: shortlink falhou — pula offer');
        continue;
      }
      all.push({
        externalId: itemId,
        title: n.productName,
        imageUrl: n.imageUrl,
        price,
        url: n.itemLink,
        affiliateUrl,
        commissionPct,
        salesCount: n.sales,
        raw: {
          ...n,
          seller: n.shopName,
          importedFromShop: shopName,
        },
      });
    }
    if (!data.productOffer?.pageInfo?.hasNextPage) break;
    // Throttle anti-rate limit
    await new Promise((r) => setTimeout(r, 1100));
  }
  logger.info({ shopName, imported: all.length }, 'shop import done');
  return all;
}

/**
 * Encurta link Shopee com subIDs (UTM tracking). Útil pra:
 *   - Identificar qual grupo WhatsApp clicou (subId = group_id)
 *   - Métricas de conversão por canal via /conversionReport
 *
 * Aceita até 5 subIds — Shopee anexa como utm_content na URL.
 */
export async function generateShopeeShortLink(
  originUrl: string,
  subIds: string[] = [],
): Promise<string> {
  const mutation = `
    mutation GenerateShortLink($input: ShortLinkInput!) {
      generateShortLink(input: $input) {
        shortLink
      }
    }
  `;
  type Resp = { generateShortLink: { shortLink: string } };
  const data = await gql<Resp>(mutation, {
    input: { originUrl, subIds: subIds.slice(0, 5) },
  });
  return data.generateShortLink.shortLink;
}

/**
 * Introspection do schema GraphQL da Shopee Open API.
 * Retorna a lista de queries disponíveis + tipos. Útil pra descobrir
 * couponOffer, shopOfferV2 etc sem precisar da doc oficial.
 */
export async function introspectShopeeSchema(): Promise<{
  queries: { name: string; description?: string | null; type: string }[];
  types: { name: string; fields?: { name: string; type: string }[] }[];
}> {
  const query = `
    {
      __schema {
        queryType {
          fields {
            name
            description
            type {
              name
              kind
              ofType { name kind ofType { name kind } }
            }
          }
        }
        types {
          name
          kind
          fields {
            name
            type { name kind ofType { name kind } }
          }
        }
      }
    }
  `;
  type SchemaResp = {
    __schema: {
      queryType: {
        fields: {
          name: string;
          description?: string;
          type: { name?: string; kind: string; ofType?: { name?: string; kind: string } };
        }[];
      };
      types: {
        name: string;
        kind: string;
        fields?: {
          name: string;
          type: { name?: string; kind: string; ofType?: { name?: string; kind: string } };
        }[];
      }[];
    };
  };
  const flatType = (t: { name?: string; kind: string; ofType?: { name?: string; kind: string } }): string =>
    t.name ?? t.ofType?.name ?? t.kind;
  const data = await gql<SchemaResp>(query);
  return {
    queries: data.__schema.queryType.fields.map((f) => ({
      name: f.name,
      description: f.description ?? null,
      type: flatType(f.type),
    })),
    types: data.__schema.types
      .filter((t) => t.kind === 'OBJECT' && !t.name.startsWith('__'))
      .map((t) => ({
        name: t.name,
        fields: t.fields?.map((f) => ({ name: f.name, type: flatType(f.type) })),
      })),
  };
}
