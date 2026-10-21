import { apiGet } from './api-client.js';
import { createSpinner } from '../shared/spinner.js';
import { pick } from '../formatters/flatten.js';

type NextUrlExtractor<T> = (data: T) => string | undefined;

export async function fetchAllPages<T>(
  initialData: T,
  extractNextUrl: NextUrlExtractor<T>,
  mergeResults: (accumulated: T, page: T) => T,
): Promise<T> {
  let result = initialData;
  let nextUrl = extractNextUrl(result);
  let page = 1;

  while (nextUrl) {
    page++;
    const spinner = createSpinner(`Fetching page ${page}...`);
    try {
      // nextUrl is absolute, extract path+query
      const url = new URL(nextUrl);
      // Repeated keys (`status=a&status=b`) stay repeated.
      const params: Record<string, string[]> = {};
      url.searchParams.forEach((v, k) => { (params[k] ??= []).push(v); });
      const pageData = await apiGet<T>({ path: url.pathname, params, silent: true });
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
