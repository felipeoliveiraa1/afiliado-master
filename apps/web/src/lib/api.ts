/**
 * Client utilities for talking to the Fastify backend.
 *
 * Two flavors:
 *  - `serverFetch`: server-only (RSC, route handlers); reads `API_BASE_URL`.
 *  - `clientFetch`: browser; reads `NEXT_PUBLIC_API_BASE_URL`.
 */

const SERVER_BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const CLIENT_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

type FetchOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  cache?: RequestCache;
  next?: { revalidate?: number; tags?: string[] };
};

async function request<T>(base: string, path: string, opts: FetchOpts = {}): Promise<T> {
  // Fastify reclama com FST_ERR_CTP_EMPTY_JSON_BODY se mandarmos
  // Content-Type: application/json sem body de verdade. Só define o header
  // quando tem body pra serializar.
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.body != null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body,
    cache: opts.cache,
    next: opts.next,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} ${path}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function serverFetch<T>(path: string, opts?: FetchOpts): Promise<T> {
  return request<T>(SERVER_BASE, path, opts);
}

export function clientFetch<T>(path: string, opts?: FetchOpts): Promise<T> {
  return request<T>(CLIENT_BASE, path, opts);
}
