import { describe, it, expect } from 'vitest';
import { formatMs } from '../../../src/formatters/time.js';

describe('formatMs', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatMs(0)).toBe('0:00');
    expect(formatMs(65_400)).toBe('1:05');
    expect(formatMs(3_599_999)).toBe('59:59');
  });

  it('formats from an hour as h:mm:ss', () => {
    expect(formatMs(3_600_000)).toBe('1:00:00');
    expect(formatMs(3_725_000)).toBe('1:02:05');
  });

  it('prints a dash for untimed values', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(undefined)).toBe('—');
  });
});
