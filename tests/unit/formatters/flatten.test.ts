import { describe, it, expect } from 'vitest';
import { flattenRows, pick } from '../../../src/formatters/flatten.js';

describe('pick', () => {
  it('reads dotted paths', () => {
    expect(pick({ speaker: { name: 'Jane' } }, 'speaker.name')).toBe('Jane');
    expect(pick({ a: 1 }, 'a')).toBe(1);
  });

  it('returns undefined for a missing step', () => {
    expect(pick({ speaker: null }, 'speaker.name')).toBeUndefined();
    expect(pick({}, 'filing_link.form')).toBeUndefined();
  });
});

describe('flattenRows', () => {
  it('keys each row by the requested columns', () => {
    const rows = flattenRows([{ metric: 'revenue', filing_link: { form: '10-Q' } }], ['metric', 'filing_link.form']);
    expect(rows).toEqual([{ metric: 'revenue', 'filing_link.form': '10-Q' }]);
  });
});
