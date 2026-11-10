import { apiCall, type ApiResponse, type RequestOptions } from './api-client.js';
import { ApiError } from '../shared/errors.js';
import { createSpinner } from '../shared/spinner.js';

/**
 * How `--all` waits out a refused page instead of dropping the pages it already holds: a 429 (the API's admission
 * limit) or 503 is retried up to `retries` times, each after the answer's `Retry-After`, else `baseDelayMs * 2^n`,
 * never longer than `maxDelayMs`. Any other error, or the last refusal, ends the walk.
 */
export const PAGE_RETRY = { retries: 5, baseDelayMs: 1_000, maxDelayMs: 30_000 } as const;

const isRetryable = (error: unknown): error is ApiError =>
  error instanceof ApiError && (error.statusCode === 429 || error.statusCode === 503);

/** The wait before retry number `retry` (0-based) of a refused page. */
export function pageRetryDelayMs(error: ApiError, retry: number): number {
  return Math.min(PAGE_RETRY.maxDelayMs, error.retryAfterMs ?? PAGE_RETRY.baseDelayMs * 2 ** retry);
}

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `rel="next"` target of a `Link` header, if any. */
export function linkNext(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;(.*)$/.exec(part.trim());
    if (match?.[1] && /\brel\s*=\s*"?next"?/i.test(match[2] ?? '')) return match[1];
  }
  return undefined;
}

/** A v2 list page's `next_cursor` (only while `has_more` is not false). */
export function nextCursorOf(body: unknown): string | undefined {
  if (!isRecord(body) || body.has_more === false) return undefined;
  return typeof body.next_cursor === 'string' && body.next_cursor !== '' ? body.next_cursor : undefined;
}

/** The rows of a v2 list page (`data[]`). */
export const rowsOf = (body: unknown): unknown[] => (isRecord(body) && Array.isArray(body.data) ? body.data : []);

/** The request of the page after `page`: `next_cursor` on the same request, else the `Link rel="next"` URL. */
export function nextRequest(request: RequestOptions, page: ApiResponse): RequestOptions | undefined {
  const cursor = nextCursorOf(page.body);
  if (cursor) return { ...request, query: { ...request.query, cursor } };
  const link = linkNext(page.headers.get('Link'));
  if (!link || (isRecord(page.body) && page.body.has_more === false)) return undefined;
  const url = new URL(link, 'http://placeholder');
  const query: Record<string, string[]> = {};
  url.searchParams.forEach((value, key) => { (query[key] ??= []).push(value); });
  return { ...request, path: url.pathname, query };
}

async function fetchPage(request: RequestOptions, onWait: (seconds: number, retry: number) => void): Promise<ApiResponse> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await apiCall({ ...request, silent: true });
    } catch (error) {
      if (!isRetryable(error) || retry >= PAGE_RETRY.retries) throw error;
      const delay = pageRetryDelayMs(error, retry);
      onWait(Math.ceil(delay / 1000), retry + 1);
      await sleep(delay);
    }
  }
}

/**
 * Every page from `first` on, following `next_cursor` (or `Link rel="next"`) until `has_more` is false. A failure
 * after the first page is thrown as is; the caller knows what it already wrote (`PartialResultError`).
 */
export async function* walkPages(request: RequestOptions, first: ApiResponse): AsyncGenerator<ApiResponse> {
  yield first;
  let next = nextRequest(request, first);
  let page = 1;
  while (next) {
    page += 1;
    const spinner = createSpinner(`Fetching page ${page}...`);
    try {
      const current = await fetchPage(next, (seconds, retry) => {
        spinner.text = `Page ${page} refused (rate limit) — retry ${retry}/${PAGE_RETRY.retries} in ${seconds}s...`;
      });
      spinner.succeed(`Page ${page} fetched`);
      yield current;
      next = nextRequest(next, current);
    } catch (error) {
      spinner.fail(`Page ${page} failed`);
      throw error;
    }
  }
}
