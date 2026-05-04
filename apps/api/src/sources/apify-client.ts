import { request } from 'undici';

const APIFY_BASE = 'https://api.apify.com/v2';

export class ApifyError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ApifyError';
  }
}

/**
 * Roda um Actor do Apify de forma síncrona e devolve o dataset.
 * Usa run-sync-get-dataset-items, que é o endpoint apropriado para inputs
 * pequenos e respostas rápidas (<5min).
 *
 * Token vem como parâmetro pra que o caller (ex: amazon.ts) possa lê-lo
 * dinamicamente do /settings sem este módulo depender de env.
 */
export async function runApifyActor<T = unknown>(
  actorId: string,
  input: unknown,
  token: string,
): Promise<T[]> {
  if (!token) {
    throw new ApifyError(
      0,
      'APIFY_TOKEN não configurado — Acesse /settings → Marketplaces → Apify Token. Pegue em apify.com/account/integrations',
    );
  }
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${token}`;
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new ApifyError(res.statusCode, `Apify ${res.statusCode}: ${body}`);
  }
  return (await res.body.json()) as T[];
}
