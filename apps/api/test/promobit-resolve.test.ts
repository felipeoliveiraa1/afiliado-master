import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();
vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
  request: vi.fn(),
}));

describe('resolvePromobitOffer', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.AMAZON_AFFILIATE_TAG = 'felipe-20';
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('appends the affiliate tag for Amazon redirects', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => '<a class="goto-store" href="/go/abc123">Ir à loja</a>',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Map([['location', 'https://www.amazon.com.br/dp/B00FOO']]) as unknown as Headers,
    });
    const { resolvePromobitOffer } = await import('@/sources/promobit.js');
    const actual = await resolvePromobitOffer('https://www.promobit.com.br/oferta/foo');
    expect(actual?.marketplace).toBe('amazon');
    expect(actual?.affiliateUrl).toContain('tag=felipe-20');
  });

  it('returns shopee marketplace without affiliate tag for direct link', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => '<a class="goto-store" href="/go/xyz">Ir à loja</a>',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Map([['location', 'https://shopee.com.br/product/123/456']]) as unknown as Headers,
    });
    const { resolvePromobitOffer } = await import('@/sources/promobit.js');
    const actual = await resolvePromobitOffer('https://www.promobit.com.br/oferta/bar');
    expect(actual?.marketplace).toBe('shopee');
    expect(actual?.affiliateUrl).toBeUndefined();
  });

  it('falls back to og:url when goto-store link is missing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<meta property="og:url" content="https://www.mercadolivre.com.br/p/MLB123" />',
    });
    const { resolvePromobitOffer } = await import('@/sources/promobit.js');
    const actual = await resolvePromobitOffer('https://www.promobit.com.br/oferta/baz');
    expect(actual?.marketplace).toBe('mercadolivre');
  });
});
