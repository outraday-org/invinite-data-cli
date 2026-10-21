import chalk from 'chalk';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorType: string,
    message: string,
    /** The answer's `Retry-After`, in milliseconds (absent when the header was missing or unreadable). */
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
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
        console.error(chalk.red(`Error ${error.statusCode}: ${error.errorType}`));
        console.error(error.message);
        const line = hint?.(error);
        if (line) console.error(chalk.dim(line));
      } else if (error instanceof Error) {
        console.error(chalk.red('Error:'), error.message);
      } else {
        console.error(chalk.red('An unexpected error occurred'));
      }
      process.exit(1);
    }
  };
}
