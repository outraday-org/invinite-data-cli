import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyColorEnv, csvColumns, renderBody, selectFields, shapeBody, type ShapeInfo, tableText } from '../../../src/output/render.js';
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

describe('companies get: a US ETF profile (Data API 6.2, O2)', () => {
  const level = chalk.level;
  afterEach(() => { chalk.level = level; });

  // The generated view of `invd companies get` (the manifest's own columns), on the answer the API gives an ETF since
  // 6.2: `sector` / `industry` / `sic` / `state` / `city` are null.
  const manifest = JSON.parse(readFileSync(new URL('../../../src/generated/cli-manifest.json', import.meta.url), 'utf8'));
  const operations: { operationId: string; list: boolean; view: ShapeInfo['view']; columns?: string[] }[] =
    Array.isArray(manifest.operations) ? manifest.operations : Object.values(manifest.operations ?? manifest);
  const getCompany = operations.find(operation => operation.operationId === 'getCompany');
  const shape: ShapeInfo = { list: false, view: getCompany?.view ?? 'json', columns: getCompany?.columns };
  const spy = { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'ARCX', sector: null, industry: null, sic: null, state: null, city: null };

  it('prints — for the null fields in the key/value view, null in JSON and empty in CSV', () => {
    chalk.level = 0;
    expect(getCompany?.view).toBe('keyValue');
    const text = renderBody(spy, shape, { format: 'table' });
    expect(text).toMatch(/ticker\s+SPY/);
    expect(text).toMatch(/sector\s+—/);
    expect(text).not.toContain('null');
    expect(JSON.parse(renderBody(spy, shape, { format: 'json' })).sector).toBeNull();
    expect(renderBody(spy, shape, { format: 'csv', select: ['ticker', 'sector', 'sic'] })).toBe('ticker,sector,sic\nSPY,,');
  });
});

describe('filings list: the filer.name column (Data API 12.3)', () => {
  const level = chalk.level;
  afterEach(() => { chalk.level = level; });

  const manifest = JSON.parse(readFileSync(new URL('../../../src/generated/cli-manifest.json', import.meta.url), 'utf8'));
  const operations: { operationId: string; list: boolean; view: ShapeInfo['view']; columns?: string[] }[] =
    Array.isArray(manifest.operations) ? manifest.operations : Object.values(manifest.operations ?? manifest);
  const listFilings = operations.find(operation => operation.operationId === 'listFilings');
  const shape: ShapeInfo = { list: true, view: listFilings?.view ?? 'json', columns: listFilings?.columns };
  const filing = { filing_date: '2026-11-26', form: 'S-1', accession: 'a1', report_date: null, primary_document: 'd.htm' };
  const body = {
    data: [{ ...filing, filer: null }, { ...filing, accession: 'a2', filer: { cik: '0001234567', name: null, role: 'filer' } }],
    has_more: false, next_cursor: null, meta: {},
  };

  it('a null filer or filer name prints — in the table and an empty cell in plain, never null / undefined', () => {
    chalk.level = 0;
    expect(listFilings?.columns).toContain('filer.name');
    const table = renderBody(body, shape, { format: 'table' });
    expect(table).toContain('filer.name');
    expect(table).not.toMatch(/null|undefined/);
    expect(table.split('\n').slice(2).every(line => line.split(/\s{2,}/)[3] === '—')).toBe(true);
    const plain = renderBody(body, shape, { format: 'plain' }).split('\n');
    expect(plain[0]?.split('\t')[3]).toBe('filer.name');
    expect(plain.slice(1).map(line => line.split('\t')[3])).toEqual(['', '']);
    expect(plain.join('\n')).not.toMatch(/null|undefined/);
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
