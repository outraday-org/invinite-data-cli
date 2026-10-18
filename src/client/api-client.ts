import { getApiKey } from '../config/auth.js';
import { getBaseUrl } from '../config/config-manager.js';
import { ApiError } from '../shared/errors.js';
import { createSpinner } from '../shared/spinner.js';

export interface RequestOptions {
  path: string;
  /** An array value is sent as a repeated parameter (`status=a&status=b`). */
  params?: Record<string, string | string[] | undefined>;
  silent?: boolean;
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const base = getBaseUrl().replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== '') {
          url.searchParams.append(key, item);
        }
      }
    }
  }
  return url.toString();
}

async function apiErrorFrom(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null) as any;
  return new ApiError(
    response.status,
    body?.error || response.statusText || 'Unknown Error',
    body?.message || `Request failed with status ${response.status}`,
  );
}

export interface CreditUsage {
  /** `X-Credits-Charged`, summed over every request of this invocation (`--all` pages included). */
  charged: number;
  /**
   * Included credits left AFTER the last metered request: the API's `X-Credits-Included-Remaining` is the allowance
   * BEFORE that request's own charge, so its `X-Credits-Charged` is subtracted (floored at 0). `null` when no
   * response carried the header (routes that skip the quota decision, e.g. `/v1/account/usage`).
   */
  includedRemaining: number | null;
}

let creditUsage: CreditUsage | null = null;

function recordCredits(response: Response): void {
  const charged = response.headers?.get('X-Credits-Charged');
  const remaining = response.headers?.get('X-Credits-Included-Remaining');
  if (charged == null && remaining == null) return;
  const chargedCredits = Number(charged) || 0;
  creditUsage = {
    charged: (creditUsage?.charged ?? 0) + chargedCredits,
    includedRemaining: remaining == null
      ? creditUsage?.includedRemaining ?? null
      : Math.max(0, (Number(remaining) || 0) - chargedCredits),
  };
}

/** What this invocation's requests cost so far, then reset; `null` when no response carried a credit header. */
export function takeCreditUsage(): CreditUsage | null {
  const usage = creditUsage;
  creditUsage = null;
  return usage;
}

export function formatCreditUsage(usage: CreditUsage): string {
  return `credits: ${usage.charged} · included left: ${usage.includedRemaining ?? '—'}`;
}

async function request(
  opts: RequestOptions,
  accept: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const apiKey = await getApiKey();
  const url = buildUrl(opts.path, opts.params);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': accept,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    headers,
    ...(init.method ? { method: init.method } : {}),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  recordCredits(response);
  if (!response.ok) {
    throw await apiErrorFrom(response);
  }
  return response;
}

/** Same auth / URL building as `apiGet`, without the JSON parse; a non-2xx throws `ApiError`. */
export async function apiGetRaw(opts: RequestOptions & { accept?: string }): Promise<Response> {
  return request(opts, opts.accept ?? '*/*');
}

export async function apiGet<T = unknown>(opts: RequestOptions): Promise<T> {
  const spinner = opts.silent ? null : createSpinner('Fetching data...');
  try {
    const response = await request(opts, 'application/json');
    const body = await response.json() as T;
    spinner?.succeed('Done');
    return body;
  } catch (error) {
    spinner?.fail('Failed');
    throw error;
  }
}

export interface ApiRequestOptions extends RequestOptions {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
}

/** A write with a JSON body; same auth / `ApiError` handling as `apiGet`. A 204 / empty body → `undefined`. */
export async function apiRequest<T = unknown>(opts: ApiRequestOptions): Promise<T> {
  const spinner = opts.silent ? null : createSpinner('Sending request...');
  try {
    const response = await request(opts, 'application/json', { method: opts.method, body: opts.body });
    const text = response.status === 204 ? '' : await response.text();
    spinner?.succeed('Done');
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (error) {
    spinner?.fail('Failed');
    throw error;
  }
}
