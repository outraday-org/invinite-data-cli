import chalk from 'chalk';
import { isJsonMode } from './json-mode.js';

/**
 * Exit codes (`invd --help` and the README list them): 0 ok, 1 failure, 2 usage, 3 partial (an unsaved download or
 * an interrupted `--all`), 4 authentication required, 5 integrity, 6 credits exhausted / plan required.
 */
export const EXIT = { ok: 0, failure: 1, usage: 2, partial: 3, auth: 4, integrity: 5, credits: 6 } as const;

/** A v2 error answer (RFC 9457 problem+json): `code` is stable, `detail` says what happened. */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    /** The problem's `title` (or the status text). */
    public errorType: string,
    message: string,
    /** The answer's `Retry-After`, in milliseconds (absent when the header was missing or unreadable). */
    public retryAfterMs?: number,
    /** The problem's stable `code` (`invalid_parameter`, `not_covered`, `plan_required` …). */
    public code?: string,
    /** The parsed error body, kept whole (`request_id`, `param`, `errors[]`, `docs_url`) for `--json`. */
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A command line `invd` refuses before any request (wrong value, missing argument, a needed `--yes`). Exit 2. */
export class UsageError extends Error {
  readonly exitCode = EXIT.usage;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** No API key anywhere (`INVD_API_KEY`, `.env`, keychain, config). Exit 4. */
export class AuthRequiredError extends Error {
  readonly exitCode = EXIT.auth;

  constructor(message = 'No API key configured. Run: invd auth login') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/**
 * Part of the answer was written, the rest failed: `--all` stopped on a page after earlier pages were printed
 * (`cursor` resumes it). Exit 3, so a script can resume exactly these.
 */
export class PartialResultError extends Error {
  readonly exitCode = EXIT.partial;

  constructor(public cause: unknown, public written: number, public cursor?: string) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Stopped after ${written} row(s): ${reason}${cursor ? ` — resume with --cursor ${cursor}` : ''}`);
    this.name = 'PartialResultError';
  }
}

/**
 * A download whose bytes stopped short of the length the server announced: nothing was saved (the `.part` file is
 * removed). Exit 3 (partial), so a script can retry exactly these.
 */
export class PartialDownloadError extends Error {
  readonly exitCode = EXIT.partial;

  constructor(public received: number, public expected?: number) {
    const of = expected === undefined ? 'of an unknown length' : `of ${expected}`;
    super(`Partial download: received ${received} bytes ${of}; nothing was saved (run the command again)`);
    this.name = 'PartialDownloadError';
  }
}

/** Saved bytes that do not match the size / SHA-256 / media type the API stated: nothing was saved. Exit 5. */
export class IntegrityError extends Error {
  readonly exitCode = EXIT.integrity;

  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

/** Problem `code`s with their own exit code; any other API error exits 1. */
const CODE_EXIT: Readonly<Record<string, number>> = {
  invalid_parameter: EXIT.usage,
  unknown_parameter: EXIT.usage,
  cursor_mismatch: EXIT.usage,
  unauthorized: EXIT.auth,
  forbidden: EXIT.auth,
  plan_required: EXIT.credits,
  insufficient_credits: EXIT.credits,
};

/** The process exit code of an error (`ApiError` by its problem `code`, else its status). */
export function exitCodeFor(error: unknown): number {
  if (error instanceof ApiError) {
    const byCode = error.code ? CODE_EXIT[error.code] : undefined;
    if (byCode !== undefined) return byCode;
    if (error.statusCode === 401) return EXIT.auth;
    if (error.statusCode === 402) return EXIT.credits;
    return EXIT.failure;
  }
  if (error instanceof Error && 'exitCode' in error && typeof error.exitCode === 'number') return error.exitCode;
  return EXIT.failure;
}

/** Commander's own exits: help and version keep their code (0, or 1 for help shown on a bare group); anything else is usage (2). */
export function exitCodeOfCommanderError(error: { code: string; exitCode: number }): number {
  if (['commander.helpDisplayed', 'commander.version', 'commander.help', 'commander.executeSubCommandAsync'].includes(error.code)) {
    return error.exitCode;
  }
  return EXIT.usage;
}

/** `Retry-After` as delay-seconds or an HTTP date → milliseconds from `now`; `undefined` when unreadable. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

const field = (body: unknown, key: string): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const value: unknown = Reflect.get(body, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** One dim line after an `ApiError` a person can act on. */
export function apiErrorHint(error: ApiError): string | undefined {
  if (error.code === 'unauthorized' || error.statusCode === 401) return 'Run: invd auth login';
  if (error.code === 'plan_required') return `This operation needs a higher plan: ${field(error.body, 'docs_url') ?? 'invd me show'}`;
  if (error.code === 'insufficient_credits') return 'Credits exhausted for this period: invd me show';
  if (error.code === 'not_covered') return 'Find the company: invd companies list --q <name>';
  return field(error.body, 'docs_url');
}

/** Prints an error the way every command does (red line, detail, hint, the problem as JSON under `--json`). */
export function printError(error: unknown): void {
  if (error instanceof ApiError) {
    const code = error.code && error.code !== error.errorType ? ` (${error.code})` : '';
    console.error(chalk.red(`Error ${error.statusCode}: ${error.errorType}${code}`));
    console.error(error.message);
    const requestId = field(error.body, 'request_id');
    if (requestId) console.error(chalk.dim(`request id: ${requestId}`));
    const line = apiErrorHint(error);
    if (line) console.error(chalk.dim(line));
    if (isJsonMode() && error.body !== undefined && error.body !== null) {
      // The problem body (code, param, errors[], request_id) as one JSON line, for scripts.
      console.error(JSON.stringify(typeof error.body === 'object' ? error.body : { status: error.statusCode, body: error.body }));
    }
  } else if (error instanceof Error) {
    console.error(chalk.red('Error:'), error.message);
  } else {
    console.error(chalk.red('An unexpected error occurred'));
  }
}

/** Wraps a command action: a thrown error is printed and becomes the process's exit code. */
export function withErrorHandling<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      printError(error);
      process.exit(exitCodeFor(error));
    }
  };
}
