import { fetch } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { RawOffer } from './types.js';

/**
 * Awin API adapter (Riachuelo + outros advertisers).
 *
 * Doc: https://help.awin.com/apidocs/introduction-1
 *
 * Endpoints utilizados:
 *   - GET  https://api.awin.com/accounts  → publisherId
 *   - GET  /publishers/{pubId}/programmes?relationship=joined|pending
 *   - POST /publishers/{pubId}/linkbuilder/generate  → deeplink afiliado
 *   - GET  /publishers/{pubId}/transactions/  → vendas/comissões
 *   - GET  https://ui.awin.com/productdata-darwin-download/publisher/{pubId}/{feedKey}/57/feedList → lista feeds
 *
 * Autenticação:
 *   - Publisher API: `Authorization: Bearer {publisherApiToken}`
 *   - Product Feed: key embutida na URL (separada do publisher token)
 *
 * Rate limit: 20 requests/min/user (Awin docs).
 */

type AwinCfg = {
  publisherApiToken?: string;
  feedApiKey?: string;
  publisherId?: string;
  advertiserId?: string;
  clickRef?: string;
};

const API_BASE = 'https://api.awin.com';
const FEED_BASE = 'https://ui.awin.com/productdata-darwin-download/publisher';

async function getCfg(): Promise<AwinCfg> {
  return getSettingsSection<AwinCfg>('riachuelo_panel');
}

export class AwinError extends Error {
  constructor(
    message: string,
    public readonly kind: 'config' | 'auth' | 'rate' | 'not_joined' | 'unknown',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AwinError';
  }
}

async function awinRequest<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
    body?: unknown;
    cfg?: AwinCfg;
  } = {},
): Promise<T> {
  const cfg = init.cfg ?? (await getCfg());
  if (!cfg.publisherApiToken) {
    throw new AwinError('publisherApiToken vazio (configure em /settings → Riachuelo)', 'config');
  }
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.publisherApiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    throw new AwinError(`Awin auth ${res.status} (token inválido ou expirado)`, 'auth', res.status);
  }
  if (res.status === 429) {
    throw new AwinError('Awin rate limit (20 req/min) — espera 1min', 'rate', 429);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AwinError(`Awin HTTP ${res.status}: ${text.slice(0, 200)}`, 'unknown', res.status);
  }
  return (await res.json()) as T;
}

/** Lista contas (publisher) — usado pra descobrir publisherId. */
export type AwinAccount = {
  accountId: number;
  accountName: string;
  accountType: 'publisher' | 'advertiser';
  userRole: string;
};

export async function listAccounts(cfg?: AwinCfg): Promise<AwinAccount[]> {
  const data = await awinRequest<{ accounts: AwinAccount[] }>('/accounts?type=publisher', { cfg });
  return data.accounts ?? [];
}

/** Lista programmes (advertisers) com filtro de status. */
export type AwinProgramme = {
  id: number;
  name: string;
  relationshipStatus?: 'joined' | 'pending' | 'rejected' | 'suspended' | null;
  region?: string;
  primaryRegion?: { name?: string; countryCode?: string };
  validDomains?: string[];
};

export async function listProgrammes(
  relationship: 'joined' | 'pending' | 'notjoined' | 'suspended' | 'rejected' = 'joined',
): Promise<AwinProgramme[]> {
  const cfg = await getCfg();
  if (!cfg.publisherId) {
    throw new AwinError('publisherId vazio (configure em /settings → Riachuelo)', 'config');
  }
  return awinRequest<AwinProgramme[]>(
    `/publishers/${cfg.publisherId}/programmes?relationship=${relationship}`,
  );
}

/** Gera deeplink afiliado pra uma URL de produto. Único ponto de tracking. */
export type AwinDeeplinkResp = {
  url: string;
  shortUrl?: string;
};

export async function generateDeeplink(
  destinationUrl: string,
  opts: { advertiserId?: number; clickRef?: string; shorten?: boolean } = {},
): Promise<AwinDeeplinkResp> {
  const cfg = await getCfg();
  if (!cfg.publisherId) {
    throw new AwinError('publisherId vazio (configure em /settings → Riachuelo)', 'config');
  }
  const advertiserId = opts.advertiserId ?? Number(cfg.advertiserId);
  if (!advertiserId) {
    throw new AwinError('advertiserId vazio (configure em /settings → Riachuelo)', 'config');
  }
  const body = {
    advertiserId,
    destinationUrl,
    parameters: opts.clickRef ? { clickref: opts.clickRef } : (cfg.clickRef ? { clickref: cfg.clickRef } : {}),
    shorten: opts.shorten ?? true,
  };
  try {
    return await awinRequest<AwinDeeplinkResp>(
      `/publishers/${cfg.publisherId}/linkbuilder/generate`,
      { method: 'POST', body, cfg },
    );
  } catch (err) {
    if (err instanceof AwinError && err.status === 403) {
      throw new AwinError(
        `Awin: advertiser ${advertiserId} ainda não aprovou seu publisher (status ≠ joined). Aguarda aprovação Riachuelo.`,
        'not_joined',
        403,
      );
    }
    throw err;
  }
}

/** Lista de transações (vendas/comissões). Usado pra relatórios. */
export type AwinTransaction = {
  id: number;
  url?: string;
  advertiserId?: number;
  publisherId?: number;
  commissionStatus?: 'pending' | 'approved' | 'declined';
  commissionAmount?: { amount: number; currency: string };
  saleAmount?: { amount: number; currency: string };
  ipHash?: string;
  customerCountry?: string;
  clickRefs?: Record<string, string>;
  clickDate?: string;
  transactionDate?: string;
  validationDate?: string;
  type?: string;
  declineReason?: string;
};

export async function listTransactions(opts: {
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;
  dateType?: 'transaction' | 'validation';
  status?: 'pending' | 'approved' | 'declined';
}): Promise<AwinTransaction[]> {
  const cfg = await getCfg();
  if (!cfg.publisherId) {
    throw new AwinError('publisherId vazio', 'config');
  }
  const params = new URLSearchParams({
    startDate: opts.startDate,
    endDate: opts.endDate,
    timezone: 'America/Sao_Paulo',
    dateType: opts.dateType ?? 'transaction',
  });
  if (opts.status) params.set('status', opts.status);
  return awinRequest<AwinTransaction[]>(
    `/publishers/${cfg.publisherId}/transactions/?${params.toString()}`,
  );
}

/**
 * Lista feeds de produtos disponíveis pro publisher.
 * Retorna URL real de download (CSV) pra cada feed.
 *
 * Endpoint NOVO (Darwin format, 2026+) — substitui productdata.awin.com/datafeed/list/...
 */
export type AwinFeedEntry = {
  feedId: number;
  advertiserId: number;
  advertiserName: string;
  language?: string;
  region?: string;
  productCount?: number;
  lastUpdated?: string;
  downloadUrl: string;
};

export async function listFeeds(): Promise<AwinFeedEntry[]> {
  const cfg = await getCfg();
  if (!cfg.publisherId || !cfg.feedApiKey) {
    throw new AwinError('publisherId/feedApiKey vazios (configure em /settings)', 'config');
  }
  // Endpoint format observado: /publisher/{pubId}/{feedKey}/57/feedList (57=Brasil)
  const url = `${FEED_BASE}/${cfg.publisherId}/${cfg.feedApiKey}/57/feedList`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new AwinError(`feedList HTTP ${res.status}`, 'unknown', res.status);
  }
  const data = (await res.json()) as { feedList?: AwinFeedEntry[] } | AwinFeedEntry[];
  return Array.isArray(data) ? data : data.feedList ?? [];
}

/**
 * Baixa o CSV de um feed específico e parseia.
 * Awin/Google Product Feed format: TSV/CSV com colunas tipo title, link,
 * price, image_link, brand, gtin, mpn, product_type, description, etc.
 */
export async function downloadFeedCsv(
  feedUrl: string,
): Promise<Array<Record<string, string>>> {
  const res = await fetch(feedUrl);
  if (!res.ok) {
    throw new AwinError(`download feed HTTP ${res.status}`, 'unknown', res.status);
  }
  const text = await res.text();
  return parseCsv(text);
}

/** Parser CSV simples — Google Product Feed usa tab ou pipe como delimiter. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  // Detecta delimitador
  const firstLine = lines[0];
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : ',';
  const headers = firstLine.split(delim).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Enriquece URL Riachuelo → RawOffer. Usado no /import-link manual.
 *
 * Estratégia: API Awin gera deeplink (precisa estar joined). Pra título/preço,
 * scrape leve da própria página Riachuelo (Open Graph tags).
 */
export type EnrichedRiachueloProduct = RawOffer & { source: 'awin' };

export async function enrichRiachueloFromUrl(url: string): Promise<EnrichedRiachueloProduct> {
  // Extrai SKU/ID da URL (formato Riachuelo: /p/{slug}/{sku}/ ou ?p={sku})
  const skuMatch = url.match(/\/p\/[^/]+\/(\d+)/) || url.match(/[?&]p=(\d+)/);
  const sku = skuMatch?.[1] ?? url.replace(/[^a-zA-Z0-9]/g, '').slice(-12);

  // Tenta scrape da página pra og:title / og:image / preço
  let title = `Produto Riachuelo ${sku}`;
  let imageUrl: string | undefined;
  let price = 0;
  let originalPrice: number | undefined;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AfiliadoBot/1.0)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
    if (r.ok) {
      const html = await r.text();
      const t = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      const img = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
      // Preço — Riachuelo usa schema.org Product
      const priceMatch =
        html.match(/"price"\s*:\s*"?([\d.,]+)"?/i) ||
        html.match(/R\$\s*([\d.,]+)/);
      const origMatch = html.match(/"highPrice"\s*:\s*"?([\d.,]+)"?/i);
      if (t?.[1]) title = decodeHtmlEntities(t[1]);
      if (img?.[1]) imageUrl = img[1];
      if (priceMatch?.[1]) price = parseBrNumber(priceMatch[1]);
      if (origMatch?.[1]) originalPrice = parseBrNumber(origMatch[1]);
    }
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, 'riachuelo: scrape falhou — usando defaults');
  }

  // Gera deeplink afiliado
  const deeplink = await generateDeeplink(url, { shorten: true });
  const affiliateUrl = deeplink.shortUrl ?? deeplink.url;

  const discountPct =
    originalPrice && price > 0 && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : undefined;

  return {
    externalId: sku,
    title,
    imageUrl,
    price,
    originalPrice,
    discountPct,
    url,
    affiliateUrl,
    raw: { sku, importedVia: 'awin-deeplink-scrape' } as Record<string, unknown>,
    source: 'awin',
  };
}

function parseBrNumber(s: string): number {
  // "1.234,56" → 1234.56 | "1234.56" → 1234.56 | "1234,56" → 1234.56
  const clean = s.replace(/\./g, '').replace(',', '.');
  return Number(clean) || 0;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
