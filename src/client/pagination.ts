import { apiGet } from './api-client.js';
import { createSpinner } from '../shared/spinner.js';

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
