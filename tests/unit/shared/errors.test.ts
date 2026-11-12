import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from '../../../src/shared/errors.js';

describe('parseRetryAfter', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfter('3')).toBe(3_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP date relative to now, never negative', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(parseRetryAfter('Wed, 21 Oct 2026 12:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter('Wed, 21 Oct 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('is undefined when absent or unreadable', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('exit codes', () => {
  it('maps errors to the shared table: 1 / 2 / 3 not found / 4 / 5 / 6 / 7 partial', async () => {
    const { ApiError, AuthRequiredError, EXIT, IntegrityError, PartialDownloadError, PartialResultError, UsageError, exitCodeFor, exitCodeOfCommanderError } = await import('../../../src/shared/errors.js');
    expect(exitCodeFor(new UsageError('x'))).toBe(EXIT.usage);
    expect(exitCodeFor(new PartialResultError(new Error('x'), 3, 'c'))).toBe(EXIT.partial);
    expect(exitCodeFor(new PartialDownloadError(1, 2))).toBe(EXIT.partial);
    expect(exitCodeFor(new AuthRequiredError())).toBe(EXIT.auth);
    expect(exitCodeFor(new IntegrityError('x'))).toBe(EXIT.integrity);
    expect(exitCodeFor(new ApiError(402, 'Payment', 'x'))).toBe(EXIT.credits);
    expect(exitCodeFor(new ApiError(403, 'Forbidden', 'x', undefined, 'plan_required'))).toBe(EXIT.credits);
    expect(exitCodeFor(new ApiError(401, 'Unauthorized', 'x'))).toBe(EXIT.auth);
    expect(exitCodeFor(new ApiError(400, 'Bad', 'x', undefined, 'unknown_parameter'))).toBe(EXIT.usage);
    expect(exitCodeFor(new ApiError(500, 'Internal', 'x', undefined, 'internal'))).toBe(EXIT.failure);
    expect(exitCodeFor(new ApiError(404, 'Not found', 'x', undefined, 'not_found'))).toBe(3);
    expect(exitCodeFor(new ApiError(404, 'Not covered', 'x', undefined, 'not_covered'))).toBe(3);
    expect(exitCodeFor(new ApiError(404, 'Not Found', 'x'))).toBe(3);
    expect(exitCodeFor(new ApiError(403, 'Excluded', 'x', undefined, 'excluded'))).toBe(EXIT.failure);
    expect(EXIT).toEqual({ ok: 0, failure: 1, usage: 2, notFound: 3, auth: 4, integrity: 5, credits: 6, partial: 7 });
    expect(EXIT.partial).toBe(7);
    expect(exitCodeFor(new Error('x'))).toBe(EXIT.failure);
    expect(exitCodeOfCommanderError({ code: 'commander.unknownOption', exitCode: 1 })).toBe(2);
    expect(exitCodeOfCommanderError({ code: 'commander.helpDisplayed', exitCode: 0 })).toBe(0);
    expect(exitCodeOfCommanderError({ code: 'commander.version', exitCode: 0 })).toBe(0);
  });

  it('a partial result names the resume cursor', async () => {
    const { PartialResultError } = await import('../../../src/shared/errors.js');
    expect(new PartialResultError(new Error('boom'), 50, 'c9').message).toBe('Stopped after 50 row(s): boom — resume with --cursor c9');
  });
});
