import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiCall, apiGet, buildUrl, formatCreditUsage, takeCreditUsage } from '../../../src/client/api-client.js';
import { ApiError } from '../../../src/shared/errors.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('api-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.INVD_API_KEY = 'k1';
    process.env.INVD_BASE_URL = 'https://api.example.com/';
    takeCreditUsage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INVD_API_KEY;
    delete process.env.INVD_BASE_URL;
  });

  it('builds the URL: base without its slash, repeated array values, empty values dropped, a query on the path kept', () => {
    expect(buildUrl('/v2/filings?form=10-K', { company: 'AAPL', items: ['2.02', '9.01'], cursor: undefined, q: '' }))
      .toBe('https://api.example.com/v2/filings?form=10-K&company=AAPL&items=2.02&items=9.01');
  });

  it('sends the bearer key, returns status, headers and the parsed body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ data: [] }, 200, { 'X-Request-Id': 'req_1' }));
    const response = await apiCall({ path: '/v2/companies', query: { q: 'apple' }, silent: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe('req_1');
    expect(response.body).toEqual({ data: [] });
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k1');
    expect(init?.method).toBe('GET');
  });

  it('sends no key for a public operation and JSON for a body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await apiCall({ path: '/v2/webhooks', method: 'POST', body: { url: 'https://x' }, auth: false, silent: true });
    expect(response.body).toBeUndefined();
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"url":"https://x"}');
  });

  it('turns a problem+json answer into an ApiError with title, detail, code, Retry-After and the body', async () => {
    const problem = { type: 'https://data.invinite.com/docs/errors#rate_limited', title: 'Too many requests', status: 429, detail: 'Slow down', code: 'rate_limited', request_id: 'req_2', docs_url: 'https://x' };
    vi.mocked(fetch).mockResolvedValueOnce(json(problem, 429, { 'Retry-After': '3' }));
    const error = await apiGet({ path: '/v2/companies', silent: true }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 429, errorType: 'Too many requests', message: 'Slow down', code: 'rate_limited', retryAfterMs: 3000, body: problem });
  });

  it('reads a non-JSON error body without failing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('gateway down', { status: 502, statusText: 'Bad Gateway' }));
    const error = await apiGet({ path: '/v2/me', silent: true }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ statusCode: 502, errorType: 'Bad Gateway', body: 'gateway down' });
  });

  it('sums X-Credits-Charged and keeps the last X-Credits-Remaining', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({}, 200, { 'X-Credits-Charged': '5', 'X-Credits-Remaining': '100' }))
      .mockResolvedValueOnce(json({}, 200, { 'X-Credits-Charged': '1' }));
    await apiGet({ path: '/v2/a', silent: true });
    await apiGet({ path: '/v2/b', silent: true });
    const usage = takeCreditUsage();
    expect(usage).toEqual({ charged: 6, remaining: 100, requests: 2 });
    expect(formatCreditUsage(usage ?? { charged: 0, remaining: null, requests: 0 })).toBe('credits: 6 · remaining: 100');
    expect(takeCreditUsage()).toBeNull();
  });

  it('refuses without a key (exit 4) before any request', async () => {
    delete process.env.INVD_API_KEY;
    const previous = process.env.INVINITE_DATA_API_KEY;
    delete process.env.INVINITE_DATA_API_KEY;
    const cwd = process.cwd();
    process.chdir('/');
    try {
      const error = await apiGet({ path: '/v2/me', silent: true }).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: 'AuthRequiredError', exitCode: 4 });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      process.chdir(cwd);
      if (previous !== undefined) process.env.INVINITE_DATA_API_KEY = previous;
    }
  });
});
