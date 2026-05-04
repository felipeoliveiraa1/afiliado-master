import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

const SAMPLE_HUB_HTML = `
<!doctype html><html><head>
<script id="__PRELOADED__">
  ({"page":"hub","framework":"nordic","nonce":"abc==","csrfToken":"TEST_CSRF_TOKEN_123","appProps":{"pageProps":{"affiliate":{"tag":"ofp5162"}}}})
</script>
</head><body>HUB</body></html>
`;

const SAMPLE_CREATE_LINK_RESPONSE_BASE64 = Buffer.from(
  JSON.stringify({
    id: '2M5GRyJ',
    created: true,
    tag: 'ofp5162',
    text: '🔍 Cole este texto: 8MU98V-73WW\n\n🔗 Ou acesse: https://meli.la/2M5GRyJ',
    short_url: 'https://meli.la/2M5GRyJ',
    long_url: 'https://www.mercadolivre.com.br/social/ofp5162?matt_word=ofp5162&matt_tool=52447776',
    type_url: 'SOCIAL_PROFILE_ENCRYPTED',
    generated_date: '2026-05-04T00:42:36Z',
    origin_url: 'https://www.mercadolivre.com.br/p/MLB29036892',
    regex: '8MU98V-73WW',
    list_url:
      'https://myaccount.mercadolivre.com.br/bookmarks/wishlist/hub/detail/a8c4f60b-5eeb-42fd-95c0',
  }),
).toString('base64');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

type PanelModule = typeof import('@/sources/mercadolivre_panel.js');

async function loadPanel(envOverrides: Record<string, string> = {}): Promise<PanelModule> {
  vi.resetModules();
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
  process.env.EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? 'http://localhost:9999';
  process.env.EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? 'test';
  process.env.EVOLUTION_DEFAULT_INSTANCE =
    process.env.EVOLUTION_DEFAULT_INSTANCE ?? 'default';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'sk-test';
  process.env.MERCADOLIVRE_PANEL_AUTO_ENABLED = 'true';
  process.env.MERCADOLIVRE_PANEL_COOKIE = '_d2id=abc; orguseridp=42; ssid=mock';
  process.env.MERCADOLIVRE_PANEL_DEFAULT_TAG = '';
  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = value;
  }
  return import('@/sources/mercadolivre_panel.js');
}

describe('mercadolivre_panel adapter', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(async () => {
    const panel = await loadPanel();
    panel.__resetPanelStateForTests();
  });

  describe('parseCsrfTokenFromHtml', () => {
    it('extracts csrfToken and tag when both are present', async () => {
      const { parseCsrfTokenFromHtml } = await loadPanel();
      const result = parseCsrfTokenFromHtml(SAMPLE_HUB_HTML);
      expect(result.csrfToken).toBe('TEST_CSRF_TOKEN_123');
      expect(result.tag).toBe('ofp5162');
    });

    it('returns null tag when only csrf is present', async () => {
      const { parseCsrfTokenFromHtml } = await loadPanel();
      const html = '<html>...{"csrfToken":"only-csrf-here"}...</html>';
      const result = parseCsrfTokenFromHtml(html);
      expect(result.csrfToken).toBe('only-csrf-here');
      expect(result.tag).toBeNull();
    });

    it('throws config-style error when csrfToken is missing', async () => {
      const { parseCsrfTokenFromHtml, MercadoLivrePanelError } = await loadPanel();
      expect(() => parseCsrfTokenFromHtml('<html>no token here</html>')).toThrow(
        MercadoLivrePanelError,
      );
    });
  });

  describe('decodeCreateLinkResponse', () => {
    it('decodes base64-encoded JSON returned by /stripe/user/links', async () => {
      const { decodeCreateLinkResponse } = await loadPanel();
      const result = decodeCreateLinkResponse(SAMPLE_CREATE_LINK_RESPONSE_BASE64);
      expect(result.short_url).toBe('https://meli.la/2M5GRyJ');
      expect(result.tag).toBe('ofp5162');
      expect(result.regex).toBe('8MU98V-73WW');
    });

    it('falls back to direct JSON parsing when body is plain JSON', async () => {
      const { decodeCreateLinkResponse } = await loadPanel();
      const raw = JSON.stringify({ short_url: 'https://meli.la/x', tag: 'ofp5162' });
      const result = decodeCreateLinkResponse(raw);
      expect(result.short_url).toBe('https://meli.la/x');
    });

    it('throws when the body is neither base64 JSON nor JSON', async () => {
      const { decodeCreateLinkResponse, MercadoLivrePanelError } = await loadPanel();
      expect(() => decodeCreateLinkResponse('not-a-link')).toThrow(MercadoLivrePanelError);
    });
  });

  describe('generateMercadoLivreShortlink', () => {
    it('fetches the hub HTML for the CSRF token, then POSTs to /stripe/user/links', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(SAMPLE_HUB_HTML))
        .mockResolvedValueOnce(
          textResponse(SAMPLE_CREATE_LINK_RESPONSE_BASE64, 200, 'application/json'),
        );
      const { generateMercadoLivreShortlink } = await loadPanel();
      const link = await generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB123');
      expect(link).toBe('https://meli.la/2M5GRyJ');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [, postArgs] = fetchMock.mock.calls[1] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(postArgs.method).toBe('POST');
      expect(postArgs.headers['X-CSRF-Token']).toBe('TEST_CSRF_TOKEN_123');
      expect(postArgs.headers.Cookie).toContain('ssid=mock');
      expect(JSON.parse(postArgs.body as string)).toEqual({
        url: 'https://www.mercadolivre.com.br/p/MLB123',
        tag: 'ofp5162',
      });
    });

    it('uses MERCADOLIVRE_PANEL_DEFAULT_TAG when provided over the discovered tag', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(SAMPLE_HUB_HTML))
        .mockResolvedValueOnce(textResponse(SAMPLE_CREATE_LINK_RESPONSE_BASE64));
      const { generateMercadoLivreShortlink } = await loadPanel({
        MERCADOLIVRE_PANEL_DEFAULT_TAG: 'ofp9999',
      });
      await generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB123');
      const body = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(body.tag).toBe('ofp9999');
    });

    it('honors explicit tag arg over env and discovered tag', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(SAMPLE_HUB_HTML))
        .mockResolvedValueOnce(textResponse(SAMPLE_CREATE_LINK_RESPONSE_BASE64));
      const { generateMercadoLivreShortlink } = await loadPanel({
        MERCADOLIVRE_PANEL_DEFAULT_TAG: 'ofp9999',
      });
      await generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB123', {
        tag: 'wpp-cozinha',
      });
      const body = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(body.tag).toBe('wpp-cozinha');
    });

    it('throws auth error and triggers cooldown on 401 from /stripe/user/links', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(SAMPLE_HUB_HTML))
        .mockResolvedValueOnce(jsonResponse({ error: 'unauth' }, 401));
      const { generateMercadoLivreShortlink, MercadoLivrePanelError } = await loadPanel();
      await expect(
        generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB1'),
      ).rejects.toMatchObject({ kind: 'auth' });
      const callsBefore = fetchMock.mock.calls.length;
      await expect(
        generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB2'),
      ).rejects.toBeInstanceOf(MercadoLivrePanelError);
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    it('throws rate error on 429', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(SAMPLE_HUB_HTML))
        .mockResolvedValueOnce(jsonResponse({ error: 'too many' }, 429));
      const { generateMercadoLivreShortlink } = await loadPanel();
      await expect(
        generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB1'),
      ).rejects.toMatchObject({ kind: 'rate' });
    });

    it('refuses to run when MERCADOLIVRE_PANEL_AUTO_ENABLED is false', async () => {
      const { generateMercadoLivreShortlink } = await loadPanel({
        MERCADOLIVRE_PANEL_AUTO_ENABLED: 'false',
      });
      await expect(
        generateMercadoLivreShortlink('https://www.mercadolivre.com.br/p/MLB1'),
      ).rejects.toMatchObject({ kind: 'config' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('validateMercadoLivreCookie', () => {
    it('returns valid+tag when /afiliados/hub renders csrfToken and ofp tag', async () => {
      fetchMock.mockResolvedValueOnce(textResponse(SAMPLE_HUB_HTML));
      const { validateMercadoLivreCookie } = await loadPanel();
      const health = await validateMercadoLivreCookie();
      expect(health.valid).toBe(true);
      expect(health.tag).toBe('ofp5162');
    });

    it('returns invalid with errorMessage when hub returns 401', async () => {
      fetchMock.mockResolvedValueOnce(textResponse('forbidden', 401, 'text/html'));
      const { validateMercadoLivreCookie } = await loadPanel();
      const health = await validateMercadoLivreCookie();
      expect(health.valid).toBe(false);
      expect(health.errorMessage).toMatch(/auth failed|401/);
    });

    it('returns invalid when cookie is empty without firing fetch', async () => {
      const { validateMercadoLivreCookie } = await loadPanel({
        MERCADOLIVRE_PANEL_COOKIE: '',
      });
      const health = await validateMercadoLivreCookie();
      expect(health.valid).toBe(false);
      expect(health.errorMessage).toBe('cookie vazio');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('getMercadoLivreCommission', () => {
    it('calls /meliconnect/commissions and maps the response', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ label: 'GANHOS', percentage: 12, extra_commission: false }),
      );
      const { getMercadoLivreCommission } = await loadPanel();
      const result = await getMercadoLivreCommission('MLB123');
      expect(result).toEqual({
        itemId: 'MLB123',
        label: 'GANHOS',
        percentage: 12,
        extraCommission: false,
      });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('itemId=MLB123');
    });
  });

  describe('getMercadoLivreTags', () => {
    it('returns the tags array from /stripe/user/tags', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          tags: [{ tag: 'ofp5162', in_use: true, generated_date: '2026-05-03 13:35:55' }],
        }),
      );
      const { getMercadoLivreTags } = await loadPanel();
      const tags = await getMercadoLivreTags();
      expect(tags).toHaveLength(1);
      expect(tags[0]?.tag).toBe('ofp5162');
    });
  });
});
