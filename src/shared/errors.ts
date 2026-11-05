import chalk from 'chalk';
import { isJsonMode } from './json-mode.js';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorType: string,
    message: string,
    /** The answer's `Retry-After`, in milliseconds (absent when the header was missing or unreadable). */
    public retryAfterMs?: number,
    /** The body's stable `code` (e.g. `/v1/sec/*`: `search_provider_not_registered`), when it carried one. */
    public code?: string,
    /** The parsed JSON error body, kept whole (`readiness`, the subject's fields) for `--json`. */
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A download whose bytes stopped short of the length the server announced: nothing was saved (the `.part` file is
 * removed). Exit code 4, apart from an ordinary failure (1), so a script can retry exactly these.
 */
export class PartialDownloadError extends Error {
  readonly exitCode = 4;

  constructor(public received: number, public expected?: number) {
    const of = expected === undefined ? 'of an unknown length' : `of ${expected}`;
    super(`Partial download: received ${received} bytes ${of}; nothing was saved (run the command again)`);
    this.name = 'PartialDownloadError';
  }
}

/** Saved bytes that do not match the size / SHA-256 / media type the API stated: nothing was saved. Exit code 5. */
export class IntegrityError extends Error {
  readonly exitCode = 5;

  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

/** `Retry-After` as delay-seconds or an HTTP date → milliseconds from `now`; `undefined` when unreadable. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * One dim line after an `ApiError` a person can act on: a 401 points at `invd login`, a 403 whose message names the
 * plan a route needs ("requires the PRO plan") names that plan.
 */
export function apiErrorHint(error: ApiError): string | undefined {
  if (error.statusCode === 401) return 'Run: invd login';
  if (error.statusCode !== 403) return undefined;
  const tier = /requires (?:the )?(\w+) plan/i.exec(error.message)?.[1];
  return tier ? `This route needs the ${tier} plan` : undefined;
}

/** `hint` may add one dim line after an `ApiError` (e.g. which plan a route needs). */
export function withErrorHandling(
  fn: (...args: any[]) => Promise<void>,
  hint?: (error: ApiError) => string | undefined,
) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        const code = error.code && error.code !== error.errorType ? ` (${error.code})` : '';
        console.error(chalk.red(`Error ${error.statusCode}: ${error.errorType}${code}`));
        console.error(error.message);
        const line = hint?.(error);
        if (line) console.error(chalk.dim(line));
        if (isJsonMode() && error.body !== undefined && error.body !== null) {
          // The structured answer (state, code, readiness, the subject's fields) as one JSON line, for scripts.
          console.error(JSON.stringify({ status: error.statusCode, ...(typeof error.body === 'object' ? error.body : { body: error.body }) }));
        }
      } else if (error instanceof Error) {
        console.error(chalk.red('Error:'), error.message);
      } else {
        console.error(chalk.red('An unexpected error occurred'));
      }
      process.exit(error instanceof PartialDownloadError || error instanceof IntegrityError ? error.exitCode : 1);
    }
  };
}
