import { describe, expect, it, vi, beforeEach } from 'vitest';

const runApifyActorMock = vi.fn();
vi.mock('@/sources/apify-client.js', () => ({
  runApifyActor: (...args: unknown[]) => runApifyActorMock(...args),
  ApifyError: class ApifyError extends Error {},
}));

describe('mercadoLivreApifySource', () => {
  beforeEach(() => {
    runApifyActorMock.mockReset();
    process.env.APIFY_TOKEN = 'token-mock';
    process.env.APIFY_MERCADOLIVRE_ACTOR = 'apify~mercadolibre-scraper';
    process.env.MERCADOLIVRE_APIFY_START_URLS = 'https://www.mercadolivre.com.br/ofertas';
  });

  it('maps apify items to RawOffer keeping discount and rating', async () => {
    runApifyActorMock.mockResolvedValueOnce([
      {
        id: 'MLB123',
        title: 'Sofá Leona Plus',
        url: 'https://produto.mercadolivre.com.br/MLB-123',
        price: 1410,
        originalPrice: 1599,
        imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_123.jpg',
        rating: 4.7,
        reviewsCount: 218,
        soldQuantity: 540,
      },
    ]);
    const { mercadoLivreApifySource } = await import('@/sources/mercadolivre-apify.js');
    const actual = await mercadoLivreApifySource.fetch({ limit: 10 });
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({
      externalId: 'MLB123',
      title: 'Sofá Leona Plus',
      price: 1410,
      originalPrice: 1599,
      discountPct: 11.82,
      rating: 4.7,
      ratingCount: 218,
      salesCount: 540,
    });
  });

  it('drops items without id, title, url or with zero price', async () => {
    runApifyActorMock.mockResolvedValueOnce([
      { title: 'Sem id', url: 'https://x', price: 10 },
      { id: 'A', url: 'https://x', price: 10 },
      { id: 'B', title: 'Sem url', price: 10 },
      { id: 'C', title: 'OK', url: 'https://x', price: 0 },
      { id: 'D', title: 'OK', url: 'https://x', price: 9.9 },
    ]);
    const { mercadoLivreApifySource } = await import('@/sources/mercadolivre-apify.js');
    const actual = await mercadoLivreApifySource.fetch();
    expect(actual.map((o) => o.externalId)).toEqual(['D']);
  });

  it('forwards configured start URLs to the actor input', async () => {
    runApifyActorMock.mockResolvedValueOnce([]);
    const { makeMercadoLivreApifySource } = await import('@/sources/mercadolivre-apify.js');
    const adapter = makeMercadoLivreApifySource({
      startUrls: [
        'https://www.mercadolivre.com.br/ofertas',
        'https://www.mercadolivre.com.br/mais-vendidos',
      ],
    });
    await adapter.fetch({ limit: 5 });
    const [actorId, input] = runApifyActorMock.mock.calls[0] ?? [];
    expect(actorId).toBe('apify~mercadolibre-scraper');
    expect((input as { startUrls: { url: string }[] }).startUrls).toEqual([
      { url: 'https://www.mercadolivre.com.br/ofertas' },
      { url: 'https://www.mercadolivre.com.br/mais-vendidos' },
    ]);
    expect((input as { maxItems: number }).maxItems).toBe(5);
  });
});
