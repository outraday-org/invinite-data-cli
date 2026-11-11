import { getApiKey } from '../config/auth.js';
import { getBaseUrl } from '../config/config-manager.js';
import { ApiError, parseRetryAfter } from '../shared/errors.js';
import { createSpinner } from '../shared/spinner.js';

export type QueryValue = string | string[] | undefined;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  /** A path under the base URL (`/v1/filings`); a query string on it is kept. */
  path: string;
  method?: HttpMethod;
  /** An array value is sent as a repeated parameter (`a=1&a=2`); `undefined` / `''` are dropped. */
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Sent as JSON. */
  body?: unknown;
  silent?: boolean;
  /** `false` for a public operation: no API key is resolved or sent (default `true`). */
  auth?: boolean;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  /** The parsed JSON body; `undefined` on a 204 / empty body. */
  body: T;
}

/** The request URL: base URL + path (+ its own query) + `query`. */
export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = getBaseUrl().replace(/\/+$/, '');
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== '') url.searchParams.append(key, item);
    }
  }
  return url.toString();
}

const text = (body: unknown, key: string): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const value: unknown = Reflect.get(body, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** A refused answer → `ApiError`: problem+json (`title`, `detail`, `code`), else the 3.x `{error, message}`. */
async function apiErrorFrom(response: Response): Promise<ApiError> {
  const raw = await response.text().catch(() => '');
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw || null;
  }
  return new ApiError(
    response.status,
    text(body, 'title') ?? text(body, 'error') ?? (response.statusText || 'Unknown Error'),
    text(body, 'detail') ?? text(body, 'message') ?? `Request failed with status ${response.status}`,
    parseRetryAfter(response.headers?.get('Retry-After')),
    text(body, 'code'),
    body ?? undefined,
  );
}

export interface CreditUsage {
  /** `X-Credits-Charged`, summed over every request of this invocation (`--all` pages included). */
  charged: number;
  /** The last `X-Credits-Remaining` (included credits left in the period); `null` when no response carried it. */
  remaining: number | null;
  requests: number;
}

let creditUsage: CreditUsage | null = null;

function recordCredits(response: Response): void {
  const charged = response.headers?.get('X-Credits-Charged') ?? null;
  const remaining = response.headers?.get('X-Credits-Remaining') ?? null;
  if (charged === null && remaining === null) return;
  creditUsage = {
    charged: (creditUsage?.charged ?? 0) + (Number(charged) || 0),
    remaining: remaining === null ? creditUsage?.remaining ?? null : Number(remaining) || 0,
    requests: (creditUsage?.requests ?? 0) + 1,
  };
}

/** What this invocation's requests cost so far, then reset; `null` when no response carried a credit header. */
export function takeCreditUsage(): CreditUsage | null {
  const usage = creditUsage;
  creditUsage = null;
  return usage;
}

export function formatCreditUsage(usage: CreditUsage): string {
  return `credits: ${usage.charged} · remaining: ${usage.remaining ?? '—'}`;
}

/** One request. A non-2xx answer throws `ApiError`; the body is parsed as JSON when there is one. */
export async function apiCall<T = unknown>(opts: RequestOptions): Promise<ApiResponse<T>> {
  const spinner = opts.silent ? null : createSpinner(opts.method && opts.method !== 'GET' ? 'Sending request...' : 'Fetching data...');
  try {
    const url = buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.auth !== false) headers.Authorization = `Bearer ${await getApiKey()}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    recordCredits(response);
    if (!response.ok) throw await apiErrorFrom(response);
    const raw = response.status === 204 ? '' : await response.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    spinner?.succeed('Done');
    return { status: response.status, headers: response.headers ?? new Headers(), body: body as T };
  } catch (error) {
    spinner?.fail('Failed');
    throw error;
  }
}

/** A GET's body. */
export async function apiGet<T = unknown>(opts: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
  return (await apiCall<T>({ ...opts, method: 'GET' })).body;
}
