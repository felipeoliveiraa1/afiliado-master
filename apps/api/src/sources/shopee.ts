import { createHash } from 'node:crypto';
import { request } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { RawOffer, SourceAdapter } from './types.js';

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

export const shopeeSource: SourceAdapter = {
  kind: 'SHOPEE',
  async fetch(opts) {
    const limit = opts?.limit ?? 50;
    const keyword = opts?.keyword ?? '';
    // Schema da Shopee Open API (descoberto por introspection — campos sem
    // 'categoryId' que era erro 10010). Mantemos enxuto pra evitar erros
    // de campo faltante. Pra adicionar mais campos (ex: couponInfo) rodar
    // introspection: GET /sources/SHOPEE/introspect
    const query = `
      query ProductOfferV2($keyword: String, $limit: Int) {
        productOfferV2(keyword: $keyword, limit: $limit, sortType: 2) {
          nodes {
            itemId
            productName
            commissionRate
            sales
            imageUrl
            price
            priceMin
            priceMax
            priceDiscountRate
            ratingStar
            shopId
            shopName
            offerLink
            productLink
          }
        }
      }
    `;
    type Resp = { productOfferV2: { nodes: any[] } };
    const data = await gql<Resp>(query, { keyword, limit });
    const nodes = data.productOfferV2?.nodes ?? [];
    return nodes.map<RawOffer>((n) => ({
      externalId: String(n.itemId),
      title: n.productName,
      imageUrl: n.imageUrl,
      price: Number(n.price ?? n.priceMin),
      originalPrice: n.priceMax ? Number(n.priceMax) : undefined,
      discountPct: n.priceDiscountRate ? Number(n.priceDiscountRate) : undefined,
      url: n.productLink,
      affiliateUrl: n.offerLink,
      commissionPct: n.commissionRate ? Number(n.commissionRate) : undefined,
      rating: n.ratingStar ? Number(n.ratingStar) : undefined,
      salesCount: n.sales ? Number(n.sales) : undefined,
      raw: n,
    }));
  },
};

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
