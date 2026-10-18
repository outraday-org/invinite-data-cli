import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config/auth modules before importing api-client
vi.mock('../../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
}));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { apiGet, apiGetRaw, apiRequest, takeCreditUsage } from '../../../src/client/api-client.js';
import { ApiError } from '../../../src/shared/errors.js';

describe('apiGet', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should make GET request with auth header', async () => {
    const mockResponse = { status: 'ok' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await apiGet({ path: '/health' });
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
        }),
      }),
    );
  });

  it('should build URL with query params', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiGet({ path: '/v1/company/search', params: { query: 'AAPL', limit: '10' } });
    const calledUrl = (fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('query=AAPL');
    expect(calledUrl).toContain('limit=10');
  });

  it('should exclude undefined params', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiGet({ path: '/v1/test', params: { a: 'val', b: undefined, c: '' } });
    const calledUrl = (fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('a=val');
    expect(calledUrl).not.toContain('b=');
    expect(calledUrl).not.toContain('c=');
  });

  it('should repeat an array param once per value', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiGet({ path: '/v1/test', params: { status: ['confirmed', 'estimated'], none: [] } });
    const calledUrl = (fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe('https://api.example.com/v1/test?status=confirmed&status=estimated');
  });

  it('should throw ApiError on non-200 response', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized', message: 'Invalid API key' }),
    });

    await expect(apiGet({ path: '/health' })).rejects.toThrow(ApiError);
    await expect(apiGet({ path: '/health' })).rejects.toMatchObject({
      statusCode: 401,
      errorType: 'Unauthorized',
    });
  });
});

describe('apiGetRaw', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response unparsed and keeps the auth header', async () => {
    const response = { ok: true, status: 200, json: vi.fn() };
    (fetch as any).mockResolvedValue(response);

    const result = await apiGetRaw({ path: '/v1/earnings-calls/audio', params: { event_id: 'e1' }, accept: 'audio/mpeg' });
    expect(result).toBe(response);
    expect(response.json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/earnings-calls/audio?event_id=e1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Accept': 'audio/mpeg',
        }),
      }),
    );
  });

  it('throws ApiError from a JSON error body', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'audio_disabled', message: 'Audio delivery is not enabled' }),
    });

    await expect(apiGetRaw({ path: '/v1/earnings-calls/audio' })).rejects.toMatchObject({
      statusCode: 503,
      errorType: 'audio_disabled',
      message: 'Audio delivery is not enabled',
    });
  });

  it('throws ApiError with the status text when the error body is not JSON', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    await expect(apiGetRaw({ path: '/v1/earnings-calls/audio' })).rejects.toBeInstanceOf(ApiError);
    await expect(apiGetRaw({ path: '/v1/earnings-calls/audio' })).rejects.toMatchObject({ statusCode: 502, errorType: 'Bad Gateway' });
  });
});

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the method and a JSON body with the auth header', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve('{"id":"w1","secret":"whsec_x"}'),
    });

    const result = await apiRequest({ method: 'POST', path: '/v1/earnings-calls/webhooks', body: { url: 'https://h.example.com', events: ['ping'] } });
    expect(result).toEqual({ id: 'w1', secret: 'whsec_x' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/earnings-calls/webhooks',
      expect.objectContaining({
        method: 'POST',
        body: '{"url":"https://h.example.com","events":["ping"]}',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('returns undefined for a 204 without reading the body', async () => {
    const text = vi.fn();
    (fetch as any).mockResolvedValue({ ok: true, status: 204, text });

    await expect(apiRequest({ method: 'DELETE', path: '/v1/earnings-calls/webhooks/w1' })).resolves.toBeUndefined();
    expect(text).not.toHaveBeenCalled();
    const init = (fetch as any).mock.calls[0][1];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('throws ApiError on a non-2xx answer', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_webhook_url', message: 'Invalid webhook URL: not https' }),
    });

    await expect(apiRequest({ method: 'POST', path: '/v1/earnings-calls/webhooks', body: {} })).rejects.toMatchObject({
      statusCode: 400,
      errorType: 'invalid_webhook_url',
    });
  });

  it('keeps GET requests free of method / body keys', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await apiGet({ path: '/health' });
    const init = (fetch as any).mock.calls[0][1];
    expect(Object.keys(init)).toEqual(['headers']);
  });
});

describe('takeCreditUsage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    takeCreditUsage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const page = (headers: Record<string, string>) => ({
    ok: true,
    headers: new Headers(headers),
    json: () => Promise.resolve({}),
  });

  it('sums X-Credits-Charged across requests, keeps the last remaining net of its own charge, then resets', async () => {
    (fetch as any)
      .mockResolvedValueOnce(page({ 'X-Credits-Charged': '5', 'X-Credits-Included-Remaining': '100' }))
      .mockResolvedValueOnce(page({ 'X-Credits-Charged': '5', 'X-Credits-Included-Remaining': '95' }));
    await apiGet({ path: '/v1/a' });
    await apiGet({ path: '/v1/a', params: { offset: '10' } });
    expect(takeCreditUsage()).toEqual({ charged: 10, includedRemaining: 90 });
    expect(takeCreditUsage()).toBeNull();
  });

  it('records nothing for a response without credit headers', async () => {
    (fetch as any).mockResolvedValueOnce(page({}));
    await apiGet({ path: '/health' });
    expect(takeCreditUsage()).toBeNull();
  });
});
