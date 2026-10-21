import { apiGet } from './api-client.js';
import { ApiError } from '../shared/errors.js';
import { createSpinner } from '../shared/spinner.js';
import { pick } from '../formatters/flatten.js';

type NextUrlExtractor<T> = (data: T) => string | undefined;

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

async function fetchPage<T>(nextUrl: string, onWait: (seconds: number, retry: number) => void): Promise<T> {
  // nextUrl is absolute: re-issue its path + query against the configured base URL. Repeated keys
  // (`status=a&status=b`) stay repeated.
  const url = new URL(nextUrl);
  const params: Record<string, string[]> = {};
  url.searchParams.forEach((v, k) => { (params[k] ??= []).push(v); });
  for (let retry = 0; ; retry += 1) {
    try {
      return await apiGet<T>({ path: url.pathname, params, silent: true });
    } catch (error) {
      if (!isRetryable(error) || retry >= PAGE_RETRY.retries) throw error;
      const delay = pageRetryDelayMs(error, retry);
      onWait(Math.ceil(delay / 1000), retry + 1);
      await sleep(delay);
    }
  }
}

export async function fetchAllPages<T>(
  initialData: T,
  extractNextUrl: NextUrlExtractor<T>,
  mergeResults: (accumulated: T, page: T) => T,
): Promise<T> {
  let result = initialData;
  let nextUrl = extractNextUrl(result);
  let page = 1;

  while (nextUrl) {
    page += 1;
    const spinner = createSpinner(`Fetching page ${page}...`);
    try {
      const pageData = await fetchPage<T>(nextUrl, (seconds, retry) => {
        spinner.text = `Page ${page} refused (rate limit) — retry ${retry}/${PAGE_RETRY.retries} in ${seconds}s...`;
      });
      result = mergeResults(result, pageData);
      nextUrl = extractNextUrl(pageData);
      spinner.succeed(`Page ${page} fetched`);
    } catch (error) {
      spinner.fail(`Page ${page} failed`);
      throw error;
    }
  }

  return result;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const arrayAt = (value: unknown, path: string): unknown[] => {
  const found = pick(value, path);
  return Array.isArray(found) ? found : [];
};

/** A copy of `target` with `value` at the dotted `path` (missing objects on the way are created). */
function withValueAt(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...target, [head]: value };
  const child = target[head];
  return { ...target, [head]: withValueAt(isRecord(child) ? child : {}, rest.join('.'), value) };
}

const nextUrlAt = (value: unknown, path: string): string | undefined => {
  const found = pick(value, path);
  return typeof found === 'string' && found !== '' ? found : undefined;
};

/**
 * `--all` over a response that pages with a top-level `next_url`: every `itemsPaths` array is concatenated across
 * pages (a path a page does not carry adds nothing); the other fields come from the last page.
 */
export async function fetchAllTopPages(initialData: unknown, itemsPaths: readonly string[]): Promise<unknown> {
  return fetchAllPages<unknown>(
    initialData,
    data => nextUrlAt(data, 'next_url'),
    (accumulated, page) => itemsPaths.reduce<Record<string, unknown>>(
      (merged, path) => withValueAt(merged, path, [...arrayAt(accumulated, path), ...arrayAt(page, path)]),
      isRecord(page) ? page : {},
    ),
  );
}

/**
 * `--all` over a multi-company response (`companies[].next_url`): follows `companies[0].next_url` and concatenates
 * each company's `itemsPaths` arrays by index, carrying each company's own `next_url` forward.
 */
export async function fetchAllCompanyPages(initialData: unknown, itemsPaths: readonly string[]): Promise<unknown> {
  return fetchAllPages<unknown>(
    initialData,
    data => nextUrlAt(data, 'companies.0.next_url'),
    (accumulated, page) => {
      const base = isRecord(accumulated) ? accumulated : {};
      const companies = arrayAt(accumulated, 'companies').map((company, index) => {
        const pageCompany = pick(page, `companies.${index}`);
        const merged = itemsPaths.reduce<Record<string, unknown>>(
          (acc, path) => withValueAt(acc, path, [...arrayAt(company, path), ...arrayAt(pageCompany, path)]),
          isRecord(company) ? company : {},
        );
        return { ...merged, next_url: pick(pageCompany, 'next_url') };
      });
      return { ...base, companies };
    },
  );
}
