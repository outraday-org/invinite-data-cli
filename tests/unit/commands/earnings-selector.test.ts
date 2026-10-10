import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { SELECTOR_MESSAGE, selectorOptions, selectorParams, validateSelector } from '../../../src/commands/earnings-selector.js';

describe('selectorOptions', () => {
  it('adds the four selector forms', () => {
    const cmd = selectorOptions(new Command('x'));
    expect(cmd.options.map(o => o.long)).toEqual(['--event', '--identifier', '--year', '--quarter', '--date']);
  });
});

describe('selectorParams', () => {
  it('maps the options to the API query names', () => {
    expect(selectorParams({ event: 'e1' })).toEqual({ event_id: 'e1', identifier: undefined, year: undefined, quarter: undefined, date: undefined });
    expect(selectorParams({ identifier: 'AAPL', year: '2026', quarter: '4' })).toMatchObject({ identifier: 'AAPL', year: '2026', quarter: '4' });
  });
});

describe('validateSelector', () => {
  it('accepts an event id alone', () => {
    expect(() => validateSelector({ event: '0b8c6f1e-0000-4000-8000-000000000000' })).not.toThrow();
  });

  it('accepts identifier + year + quarter', () => {
    expect(() => validateSelector({ identifier: 'AAPL', year: '2026', quarter: '4' })).not.toThrow();
  });

  it('accepts identifier + date', () => {
    expect(() => validateSelector({ identifier: 'AAPL', date: '2026-10-30' })).not.toThrow();
  });

  it('rejects an incomplete selector with the API wording', () => {
    expect(() => validateSelector({})).toThrow(SELECTOR_MESSAGE);
    expect(() => validateSelector({ identifier: 'AAPL' })).toThrow(SELECTOR_MESSAGE);
    expect(() => validateSelector({ identifier: 'AAPL', year: '2026' })).toThrow(SELECTOR_MESSAGE);
    expect(() => validateSelector({ year: '2026', quarter: '4' })).toThrow(SELECTOR_MESSAGE);
  });
});
