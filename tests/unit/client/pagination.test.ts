import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkNext, nextCursorOf, nextRequest, pageRetryDelayMs, PAGE_RETRY, walkPages } from '../../../src/client/pagination.js';
import { ApiError } from '../../../src/shared/errors.js';

const page = (body: unknown, headers: Record<string, string> = {}) =>
  ({ status: 200, headers: new Headers(headers), body });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('cursor pagination', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.INVD_API_KEY = 'k';
    process.env.INVD_BASE_URL = 'https://api.example.com';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.INVD_API_KEY;
    delete process.env.INVD_BASE_URL;
  });

  it('reads next_cursor only while has_more, and the Link rel="next" target', () => {
    expect(nextCursorOf({ data: [], has_more: true, next_cursor: 'c2' })).toBe('c2');
    expect(nextCursorOf({ data: [], has_more: false, next_cursor: 'c2' })).toBeUndefined();
    expect(nextCursorOf({ data: [], has_more: true, next_cursor: null })).toBeUndefined();
    expect(linkNext('<https://api.example.com/v2/x?cursor=a>; rel="next", <https://y>; rel="prev"')).toBe('https://api.example.com/v2/x?cursor=a');
    expect(linkNext('<https://y>; rel="prev"')).toBeUndefined();
  });

  it('the next request keeps every filter and adds the cursor; a Link-only page follows the link', () => {
    const request = { path: '/v2/filings', query: { company: 'AAPL', form: '10-K' } };
    expect(nextRequest(request, page({ has_more: true, next_cursor: 'c2' }))?.query).toEqual({ company: 'AAPL', form: '10-K', cursor: 'c2' });
    const linked = nextRequest(request, page({ data: [] }, { Link: '<https://api.example.com/v2/filings?company=AAPL&cursor=z>; rel="next"' }));
    expect(linked).toMatchObject({ path: '/v2/filings', query: { company: ['AAPL'], cursor: ['z'] } });
    expect(nextRequest(request, page({ has_more: false, next_cursor: null }))).toBeUndefined();
  });

  it('walks every page in order', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ data: [2], has_more: true, next_cursor: 'c3' }))
      .mockResolvedValueOnce(json({ data: [3], has_more: false, next_cursor: null }));
    const request = { path: '/v2/filings', query: { company: 'AAPL' } };
    const bodies: unknown[] = [];
    for await (const current of walkPages(request, page({ data: [1], has_more: true, next_cursor: 'c2' }))) bodies.push(current.body);
    expect(bodies.map(body => (body as { data: number[] }).data[0])).toEqual([1, 2, 3]);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe('https://api.example.com/v2/filings?company=AAPL&cursor=c2');
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toBe('https://api.example.com/v2/filings?company=AAPL&cursor=c3');
  });

  it('waits out a 429 by its Retry-After, then continues', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ code: 'rate_limited' }, 429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ data: [2], has_more: false }));
    const pages: unknown[] = [];
    const walk = (async () => {
      for await (const current of walkPages({ path: '/v2/x' }, page({ data: [1], has_more: true, next_cursor: 'c' }))) pages.push(current.body);
    })();
    await vi.advanceTimersByTimeAsync(2_000);
    await walk;
    expect(pages).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds the retry delay', () => {
    expect(pageRetryDelayMs(new ApiError(429, 'x', 'y', 999_999), 0)).toBe(PAGE_RETRY.maxDelayMs);
    expect(pageRetryDelayMs(new ApiError(503, 'x', 'y'), 2)).toBe(PAGE_RETRY.baseDelayMs * 4);
  });

  it('throws a non-retryable page failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ code: 'cursor_mismatch', detail: 'changed' }, 400));
    const walk = async () => {
      for await (const _current of walkPages({ path: '/v2/x' }, page({ data: [1], has_more: true, next_cursor: 'c' }))) { /* drain */ }
    };
    await expect(walk()).rejects.toMatchObject({ statusCode: 400, code: 'cursor_mismatch' });
  });
});
