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
