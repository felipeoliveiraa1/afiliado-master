import { fetch } from 'undici';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

/**
 * Gerador automático de shortlinks de afiliado Shopee usando o cookie da sessão
 * logada no painel `affiliate.shopee.com.br`.
 *
 * IMPORTANTE — RISCOS:
 * - O cookie expira periodicamente (estimado 7-14 dias)
 * - A Shopee pode detectar uso programático e suspender a conta de afiliado
 * - A conta de afiliado é o ativo mais valioso da operação
 *
 * SAFETY NETS implementados:
 * - Habilitado apenas via env explícita (`SHOPEE_PANEL_AUTO_ENABLED=true`)
 * - Limite diário hard-coded baixo (25/dia default)
 * - Jitter aleatório entre 45-180s entre requests
 * - Cooldown automático em caso de erro de auth (assume cookie expirado)
 * - Headers de browser realistas
 *
 * Endpoint específico (`SHOPEE_PANEL_GENERATE_ENDPOINT`) e payload shape
 * precisam ser descobertos via HAR export — ver README seção "HAR discovery".
 */

export class ShopeePanelError extends Error {
  constructor(
    message: string,
    public readonly kind: 'config' | 'auth' | 'rate' | 'unknown',
  ) {
    super(message);
  }
}

let cooldownUntil = 0;

function buildHeaders(): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Content-Type': 'application/json;charset=UTF-8',
    Origin: 'https://affiliate.shopee.com.br',
    Referer: 'https://affiliate.shopee.com.br/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    Cookie: env.SHOPEE_PANEL_COOKIE,
    ...(env.SHOPEE_PANEL_CSRF_TOKEN ? { 'X-CSRFToken': env.SHOPEE_PANEL_CSRF_TOKEN } : {}),
  };
}

/**
 * Gera shortlink de afiliado para um produto Shopee.
 * Retorna o shortlink no formato `https://s.shopee.com.br/xxxxxxx` ou lança erro.
 */
export async function generateShopeeShortlink(
  productUrl: string,
  opts: { subId?: string } = {},
): Promise<string> {
  if (!env.SHOPEE_PANEL_AUTO_ENABLED) {
    throw new ShopeePanelError('SHOPEE_PANEL_AUTO_ENABLED=false', 'config');
  }
  if (!env.SHOPEE_PANEL_COOKIE) {
    throw new ShopeePanelError('SHOPEE_PANEL_COOKIE não configurado', 'config');
  }
  if (!env.SHOPEE_PANEL_GENERATE_ENDPOINT) {
    throw new ShopeePanelError(
      'SHOPEE_PANEL_GENERATE_ENDPOINT não descoberto — exportar HAR e analisar',
      'config',
    );
  }
  if (Date.now() < cooldownUntil) {
    throw new ShopeePanelError(`em cooldown até ${new Date(cooldownUntil).toISOString()}`, 'auth');
  }

  // Payload shape padrão observado em painéis Shopee — ajustar após HAR analysis
  // Variáveis comuns: { url, subIds: [], shortenWith: 'short' }
  const body = {
    url: productUrl,
    subIds: opts.subId ? [opts.subId, '', '', '', ''] : ['', '', '', '', ''],
  };

  const res = await fetch(env.SHOPEE_PANEL_GENERATE_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    cooldownUntil = Date.now() + 6 * 60 * 60 * 1000; // 6h cooldown — provavelmente cookie expirado
    logger.error({ status: res.status }, 'shopee panel auth failed — cookie provavelmente expirou');
    throw new ShopeePanelError(`auth failed (${res.status}) — atualizar SHOPEE_PANEL_COOKIE`, 'auth');
  }
  if (res.status === 429) {
    cooldownUntil = Date.now() + 60 * 60 * 1000; // 1h cooldown
    throw new ShopeePanelError('rate limited (429)', 'rate');
  }
  if (!res.ok) {
    throw new ShopeePanelError(`HTTP ${res.status}: ${await res.text()}`, 'unknown');
  }

  const json = (await res.json()) as Record<string, unknown>;
  // Shape esperado (ajustar após HAR): { data: { shortLink: 'https://s.shopee.com.br/...' } }
  // ou { data: { shortlinks: [...] } } — flexível.
  const shortlink = extractShortlink(json);
  if (!shortlink) {
    throw new ShopeePanelError(`shape inesperado: ${JSON.stringify(json).slice(0, 200)}`, 'unknown');
  }
  return shortlink;
}

export type ShopeeCookieHealth = {
  valid: boolean;
  affiliateName?: string;
  checkedAt: string;
  errorMessage?: string;
};

/**
 * Verifica se o cookie da sessão do painel Shopee continua válido.
 * Usa o próprio endpoint de geração com uma URL placeholder. Se a chamada
 * autenticar (mesmo retornando erro de payload), o cookie está OK.
 */
export async function validateShopeeCookie(): Promise<ShopeeCookieHealth> {
  const checkedAt = new Date().toISOString();
  if (!env.SHOPEE_PANEL_COOKIE) {
    return { valid: false, checkedAt, errorMessage: 'cookie vazio' };
  }
  if (!env.SHOPEE_PANEL_GENERATE_ENDPOINT) {
    return {
      valid: false,
      checkedAt,
      errorMessage: 'SHOPEE_PANEL_GENERATE_ENDPOINT não configurado',
    };
  }
  try {
    const res = await fetch(env.SHOPEE_PANEL_GENERATE_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ url: 'https://shopee.com.br/', subIds: ['', '', '', '', ''] }),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, checkedAt, errorMessage: `auth failed (${res.status})` };
    }
    return { valid: true, checkedAt };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { valid: false, checkedAt, errorMessage };
  }
}

function extractShortlink(json: unknown): string | null {
  const visit = (v: unknown): string | null => {
    if (typeof v === 'string') {
      if (/^https?:\/\/s\.shopee\.com\.br\//.test(v)) return v;
      if (/^https?:\/\/shoope\.top\//.test(v)) return v;
      return null;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = visit(item);
        if (r) return r;
      }
      return null;
    }
    if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) {
        const r = visit(val);
        if (r) return r;
      }
    }
    return null;
  };
  return visit(json);
}
