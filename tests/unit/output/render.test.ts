import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';
import { applyColorEnv, csvColumns, renderBody, selectFields, shapeBody, tableText } from '../../../src/output/render.js';
import { resolveOutput } from '../../../src/output/options.js';

const list = { list: true, view: 'table' as const, columns: ['ticker', 'name'] };
const body = { data: [{ ticker: 'AAPL', name: 'Apple', company: { cik: '0000320193' }, n: 1234567 }], has_more: true, next_cursor: 'c2', meta: {} };

describe('render', () => {
  const level = chalk.level;
  afterEach(() => { chalk.level = level; });

  it('table (columns, thousands, — for null), plain (TSV), key/value, JSON', () => {
    chalk.level = 0;
    expect(tableText([{ a: 1234, b: null, fiscal_year: 2026 }], ['a', 'b', 'fiscal_year'])).toBe('a      b  fiscal_year\n─────  ─  ───────────\n1,234  —  2026');
    expect(renderBody(body, list, { format: 'plain' })).toBe('ticker\tname\nAAPL\tApple');
    expect(renderBody({ ticker: 'AAPL', name: 'Apple' }, { list: false, view: 'keyValue', columns: ['ticker'] }, { format: 'table' })).toBe('  ticker  AAPL');
    expect(renderBody({ a: 1 }, { list: false, view: 'json' }, { format: 'table' })).toBe('{\n  "a": 1\n}');
  });

  it('field selection keeps the envelope, dotted paths included; CSV quotes and flattens', () => {
    expect(selectFields(body.data[0], ['ticker', 'company.cik'])).toEqual({ ticker: 'AAPL', 'company.cik': '0000320193' });
    expect(shapeBody(body, list, { format: 'json', select: ['ticker'] })).toEqual({ ...body, data: [{ ticker: 'AAPL' }] });
    expect(renderBody(body, list, { format: 'csv' })).toBe('ticker,name,company,n\nAAPL,Apple,"{""cik"":""0000320193""}",1234567');
    expect(csvColumns([{ a: 1 }, { b: 2, a: 3 }])).toEqual(['a', 'b']);
    expect(renderBody(body, list, { format: 'jsonl', select: ['ticker'] })).toBe('{"ticker":"AAPL"}');
  });

  it('NO_COLOR turns colour off unless FORCE_COLOR', () => {
    chalk.level = 2;
    applyColorEnv({ NO_COLOR: '1', FORCE_COLOR: '1' });
    expect(chalk.level).toBe(2);
    applyColorEnv({ NO_COLOR: '1' });
    expect(chalk.level).toBe(0);
  });
});

describe('resolveOutput', () => {
  it('--json alone = json, --json a,b selects (checked), --all streams JSONL, --output wins, contradictions refused', () => {
    expect(resolveOutput({ json: true }).format).toBe('json');
    expect(resolveOutput({ json: 'ticker,name' }, { knownFields: ['ticker', 'name'] }).select).toEqual(['ticker', 'name']);
    expect(() => resolveOutput({ json: 'nope' }, { knownFields: ['ticker'] })).toThrow('unknown field nope');
    expect(resolveOutput({ all: true }).format).toBe('jsonl');
    expect(resolveOutput({ all: true, output: 'csv' }).format).toBe('csv');
    expect(resolveOutput({ output: 'csv' }).format).toBe('csv');
    expect(resolveOutput({ plain: true }).format).toBe('plain');
    expect(() => resolveOutput({ json: true, output: 'csv' })).toThrow('contradict');
    expect(resolveOutput({ fields: 'a,b' }, { fieldsParam: true })).toMatchObject({ order: ['a', 'b'] });
    expect(resolveOutput({ fields: 'ticker' }, { knownFields: ['ticker'] })).toMatchObject({ prune: ['ticker'] });
  });
});
