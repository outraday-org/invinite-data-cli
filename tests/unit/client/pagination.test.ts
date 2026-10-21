import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/client/api-client.js', () => ({
  apiGet: vi.fn(),
}));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { fetchAllPages, PAGE_RETRY, pageRetryDelayMs } from '../../../src/client/pagination.js';
import { apiGet } from '../../../src/client/api-client.js';
import { ApiError } from '../../../src/shared/errors.js';

describe('fetchAllPages', () => {
  it('should return initial data when no next_url', async () => {
    const data = { items: [1, 2], next_url: undefined as string | undefined };
    const result = await fetchAllPages(
      data,
      d => d.next_url,
      (acc, page) => ({ ...page, items: [...acc.items, ...page.items] }),
    );
    expect(result).toEqual(data);
  });

  it('should follow next_url and merge results', async () => {
    const page2 = { items: [3, 4], next_url: undefined as string | undefined };
    (apiGet as any).mockResolvedValueOnce(page2);

    const initial = { items: [1, 2], next_url: 'https://api.example.com/test?offset=2&limit=2' };
    const result = await fetchAllPages(
      initial,
      d => d.next_url,
      (acc, page) => ({ ...page, items: [...acc.items, ...page.items] }),
    );
    expect(result.items).toEqual([1, 2, 3, 4]);
  });
});

describe('fetchAllPages under a rate limit', () => {
  const merge = (acc: { items: number[] }, page: { items: number[] }) => ({ ...page, items: [...acc.items, ...page.items] });
  const initial = { items: [1], next_url: 'https://api.example.com/test?offset=1' as string | undefined };
  const refused = (status: number, retryAfterMs?: number) =>
    new ApiError(status, 'Too Many Requests', 'Request admission limit exceeded. Please retry shortly.', retryAfterMs);

  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits the Retry-After of a 429 and keeps the pages it already holds', async () => {
    vi.useFakeTimers();
    vi.mocked(apiGet)
      .mockRejectedValueOnce(refused(429, 2_000))
      .mockResolvedValueOnce({ items: [2], next_url: undefined });

    const walk = fetchAllPages(initial, d => d.next_url, merge);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(apiGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(walk).resolves.toEqual({ items: [1, 2], next_url: undefined });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 too, backing off exponentially without a Retry-After', async () => {
    vi.useFakeTimers();
    vi.mocked(apiGet)
      .mockRejectedValueOnce(refused(503))
      .mockRejectedValueOnce(refused(503))
      .mockResolvedValueOnce({ items: [2], next_url: undefined });

    const walk = fetchAllPages(initial, d => d.next_url, merge);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    await expect(walk).resolves.toEqual({ items: [1, 2], next_url: undefined });
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  it('gives up after the bounded number of retries with the last refusal', async () => {
    vi.useFakeTimers();
    vi.mocked(apiGet).mockRejectedValue(refused(429, 1_000));

    const walk = fetchAllPages(initial, d => d.next_url, merge);
    const settled = expect(walk).rejects.toMatchObject({ statusCode: 429 });
    await vi.advanceTimersByTimeAsync(PAGE_RETRY.retries * 1_000);
    await settled;
    expect(apiGet).toHaveBeenCalledTimes(PAGE_RETRY.retries + 1);
  });

  it('does not retry any other error', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(400, 'Bad Request', 'offset is invalid'));
    await expect(fetchAllPages(initial, d => d.next_url, merge)).rejects.toMatchObject({ statusCode: 400 });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('caps a long Retry-After and the exponential fallback', () => {
    expect(pageRetryDelayMs(refused(429, 120_000), 0)).toBe(PAGE_RETRY.maxDelayMs);
    expect(pageRetryDelayMs(refused(429), 3)).toBe(8_000);
    expect(pageRetryDelayMs(refused(429), 10)).toBe(PAGE_RETRY.maxDelayMs);
  });
});
