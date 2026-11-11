import { mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram, loadManifest } from '../../src/cli.js';
import { coverageNote, parseFiscalPeriod, wireValue } from '../../src/spec-commands.js';
import { UsageError } from '../../src/shared/errors.js';
import type { ManifestParam } from '../../src/spec-manifest.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const page = (data: unknown[], next: string | null = null, meta: Record<string, unknown> = {}) =>
  json({ data, has_more: next !== null, next_cursor: next, meta });

let out: string[];
let err: string[];

const run = async (...args: string[]) => {
  await createProgram().parseAsync(['node', 'invd', ...args]);
};
/** Runs and returns the exit code `withErrorHandling` asked for (0 when the command returned). */
const exitOf = async (...args: string[]): Promise<number> => {
  try {
    await run(...args);
    return 0;
  } catch (error) {
    const match = /^exit (\d+)$/.exec(error instanceof Error ? error.message : '');
    if (match) return Number(match[1]);
    throw error;
  }
};
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), init }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  process.env.INVD_API_KEY = 'k';
  process.env.INVD_BASE_URL = 'https://api.example.com';
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { err.push(parts.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.INVD_API_KEY;
  delete process.env.INVD_BASE_URL;
  delete process.env.INVD_CONFIRM_CREDITS;
});

describe('flag values', () => {
  const param = (overrides: Partial<ManifestParam>): ManifestParam => ({ name: 'x', in: 'query', required: false, type: 'string', flag: 'x', ...overrides });

  it('validates by type, enum and pattern; refuses with exit 2 by flag name', () => {
    expect(wireValue(param({ type: 'integer' }), '007')).toBe('7');
    expect(() => wireValue(param({ type: 'integer', flag: 'limit' }), '1.5')).toThrow('--limit expects an integer');
    expect(wireValue(param({ enum: ['annual', 'quarterly'] }), 'annual')).toBe('annual');
    expect(() => wireValue(param({ enum: ['annual'] }), 'weekly')).toThrow(UsageError);
    expect(wireValue(param({ pattern: '^(a|b)(,(a|b))*$' }), 'a,b')).toBe('a,b');
    expect(() => wireValue(param({ pattern: '^(a|b)(,(a|b))*$' }), 'a,c')).toThrow('matching');
    expect(wireValue(param({ type: 'boolean' }), false)).toBe('false');
    expect(wireValue(param({ type: 'array', items: 'string', enum: ['x', 'y'] }), 'x, y')).toEqual(['x', 'y']);
  });

  it('reads a fiscal period', () => {
    expect(parseFiscalPeriod('2026Q3')).toEqual({ fiscalYear: '2026', fiscalQuarter: '3' });
    expect(parseFiscalPeriod('FY2025 q4')).toEqual({ fiscalYear: '2025', fiscalQuarter: '4' });
    expect(parseFiscalPeriod('2026H1')).toBeUndefined();
  });
});

describe('requests', () => {
  it('invd financials AAPL --statement … --view detailed --limit 4 --json hits getStandardizedFinancialsDetailed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page([{ fiscal_year: 2026 }]));
    await run('financials', 'AAPL', '--statement', 'income-statement', '--period', 'quarterly', '--view', 'detailed', '--limit', '4', '--json');
    expect(calls()).toHaveLength(1);
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/financials/standardized/detailed?company=AAPL&statement=income-statement&period=quarterly&limit=4');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ data: [{ fiscal_year: 2026 }] });
  });

  it('several companies + one fiscal year and quarter is one call (period implied, said on stderr)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page([]));
    await run('financials', 'AAPL', 'MSFT', '--fiscal-year', '2026', '--fiscal-quarter', '3', '--json');
    expect(calls()).toHaveLength(1);
    const url = new URL(calls()[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/financials/standardized');
    expect(Object.fromEntries(url.searchParams)).toEqual({ company: 'AAPL,MSFT', fiscal_year: '2026', fiscal_quarter: '3', period: 'quarterly' });
    expect(err.join('\n')).toContain('--period quarterly assumed');
  });

  it('--basis as-reported picks the as-reported operation; an as-reported flag elsewhere is refused (exit 2)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page([]));
    await run('financials', 'AAPL', '--basis', 'as-reported', '--reported-only', '--period', 'annual', '--json');
    expect(calls()[0]?.url).toContain('/v1/financials/as-reported?company=AAPL&period=annual&reported_only=true');
    expect(await exitOf('financials', 'AAPL', '--reported-only', '--period', 'annual')).toBe(2);
    expect(err.join('\n')).toContain('--reported-only applies to --basis as-reported only');
  });

  it("a group's list is its default: invd filings AAPL --form 10-K; --no-<flag> sends false; dotted filters", async () => {
    vi.mocked(fetch).mockImplementation(async () => page([]));
    await run('filings', 'AAPL', '--form', '10-K', '--filed-at-gte', '2025-01-01', '--json');
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/filings?company=AAPL&form=10-K&filed_at.gte=2025-01-01');
    await run('ipos', '--no-is-spac', '--json');
    expect(calls()[1]?.url).toContain('is_spac=false');
  });

  it('a member id is the positional and goes in the path, encoded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ accession: '0000320193-26-000026' }));
    await run('filings', 'get', '0000320193-26-000026', '--json');
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/filings/0000320193-26-000026');
  });

  it('invd events transcript NVDA 2026Q3 resolves the event through GET /v1/events and says so', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ event_id: 'ev-1' }]))
      .mockResolvedValueOnce(json({ event: { event_id: 'ev-1' }, turns: [] }));
    await run('events', 'transcript', 'NVDA', '2026Q3', '--json');
    expect(calls().map(call => call.url)).toEqual([
      'https://api.example.com/v1/events?company=NVDA&fiscal_year=2026&fiscal_quarter=3&limit=1',
      'https://api.example.com/v1/events/ev-1/transcript',
    ]);
    expect(err.join('\n')).toContain('resolved NVDA 2026Q3 → event ev-1');
  });

  it('body flags (one object deep) over --body, the header parameter, POST', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'wh_1' }));
    await run('webhooks', 'create', '--body', '{"events":["x"]}', '--url', 'https://hooks.example.com', '--ciks', '0000320193,0000789019', '--idempotency-key', 'k-1', '--json');
    const [call] = calls();
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ events: ['x'], url: 'https://hooks.example.com', filters: { ciks: ['0000320193', '0000789019'] } });
    expect((call?.init?.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1');
  });

  it('a required body without one is a usage error naming its flags', async () => {
    expect(await exitOf('webhooks', 'create')).toBe(2);
    expect(err.join('\n')).toContain('--url, --events');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a missing required positional or an unknown flag is a usage error (commander, exit 2 in bin)', async () => {
    const program = createProgram();
    program.commands.forEach(command => command.commands.forEach(child => child.exitOverride()));
    await expect(program.parseAsync(['node', 'invd', 'companies', 'get'])).rejects.toMatchObject({ code: 'commander.missingArgument' });
  });
});

describe('--dry-run, confirmation, delete', () => {
  it('invd holdings AAPL --all --dry-run prints a credit estimate and makes no request', async () => {
    await run('holdings', 'AAPL', '--all', '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    const text = out.join('\n');
    expect(text).toContain('GET https://api.example.com/v1/holdings?company=AAPL');
    expect(text).toContain('credits: 1 × pages');
    expect(text).toContain('dry run: no request was sent');
  });

  it('a dry run of a resolved event shows the lookup and the sum', async () => {
    await run('events', 'transcript', 'NVDA', '2026Q3', '--dry-run', '--json');
    const plan = JSON.parse(out.join('\n'));
    expect(plan.steps.map((step: { step: string }) => step.step)).toEqual(['resolve', 'request']);
    expect(plan.steps[1].request).toContain('/v1/events/<event_id>/transcript');
    expect(plan.credits_estimate).toBe('6');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('--all over the confirm_credits threshold needs --yes when nobody can answer', async () => {
    expect(await exitOf('search', 'filings', 'supply', 'chain', '--all')).toBe(2);
    expect(err.join('\n')).toContain('costs 100 credits per page');
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(page([{ accession: 'a' }]));
    await run('search', 'filings', 'supply', 'chain', '--all', '--yes');
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/search/filings?q=supply+chain');
  });

  it('a delete needs --yes without a terminal', async () => {
    expect(await exitOf('webhooks', 'delete', 'wh_1')).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await run('webhooks', 'delete', 'wh_1', '--yes');
    expect(calls()[0]?.init?.method).toBe('DELETE');
    expect(err.join('\n')).toContain('Done.');
  });
});

describe('output', () => {
  const rows = [{ ticker: 'AAPL', name: 'Apple Inc.', exchange: 'XNAS', sector: 'Technology', cik: '0000320193', extra: 1 }];

  it('piped: tab-separated rows of the operation columns; the next cursor on stderr', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page(rows, 'c2'));
    await run('companies', '--q', 'apple');
    expect(out).toEqual(['ticker\tname\texchange\tsector\tcik\nAAPL\tApple Inc.\tXNAS\tTechnology\t0000320193']);
    expect(err.join('\n')).toContain('--cursor c2');
  });

  it('--json a,b keeps those fields of each row and the envelope; an unknown field is exit 2 listing the fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page(rows, 'c2'));
    await run('companies', '--json', 'ticker,cik');
    expect(JSON.parse(out.join('\n'))).toEqual({ data: [{ ticker: 'AAPL', cik: '0000320193' }], has_more: true, next_cursor: 'c2', meta: {} });
    expect(await exitOf('companies', '--json', 'nope')).toBe(2);
    expect(err.join('\n')).toContain('Fields: cik, ticker');
  });

  it('--output csv / jsonl, --jq', async () => {
    vi.mocked(fetch).mockImplementation(async () => page([{ a: 1, b: 'x,y' }, { a: 2, b: null }]));
    await run('market', 'holidays', '--output', 'csv');
    expect(out.pop()).toBe('a,b\n1,"x,y"\n2,');
    await run('market', 'holidays', '--output', 'jsonl');
    expect(out.pop()).toBe('{"a":1,"b":"x,y"}\n{"a":2,"b":null}');
    await run('market', 'holidays', '--jq', '.data[].a');
    expect(out.pop()).toBe('1\n2');
  });

  it('--all streams every page as JSONL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'))
      .mockResolvedValueOnce(page([{ day: '2026-01-19' }]));
    await run('market', 'holidays', '--all');
    expect(out).toEqual(['{"day":"2026-01-01"}', '{"day":"2026-01-19"}']);
    expect(calls()[1]?.url).toBe('https://api.example.com/v1/market-holidays?cursor=c2');
  });

  it('--all that fails after written rows exits 3 with the resume cursor', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'))
      .mockResolvedValueOnce(page([{ day: '2026-01-19' }], 'c3'))
      .mockResolvedValueOnce(json({ title: 'Bad', detail: 'boom', code: 'internal' }, 500));
    expect(await exitOf('market', 'holidays', '--all')).toBe(3);
    expect(out).toHaveLength(2);
    expect(err.join('\n')).toContain('resume with --cursor c3');
  });

  it('--all --jq that fails after printed pages also exits 3 with the resume cursor', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'))
      .mockResolvedValueOnce(json({ title: 'Bad', detail: 'boom', code: 'internal' }, 500));
    expect(await exitOf('market', 'holidays', '--all', '--jq', '.data[].day')).toBe(3);
    expect(out).toEqual(['2026-01-01']);
    expect(err.join('\n')).toContain('resume with --cursor c2');
  });

  it('a coverage that is not complete is a yellow stderr note', async () => {
    expect(coverageNote({ meta: { coverage: { state: 'pending', retry_after_s: 30 } } })).toContain('retry in 30s');
    expect(coverageNote({ meta: { coverage: { state: 'complete' } } })).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(page([], null, { coverage: { state: 'partial', through: '2026-11-09' } }));
    await run('holdings', 'AAPL', '--json');
    expect(err.join('\n')).toContain('coverage: partial through 2026-11-09');
  });
});

describe('exit codes from problem codes', () => {
  const problem = (status: number, code: string) => json({ type: 't', title: 'T', status, detail: 'd', code, request_id: 'req_1', docs_url: 'https://x' }, status);

  it.each([
    [400, 'invalid_parameter', 2],
    [400, 'cursor_mismatch', 2],
    [401, 'unauthorized', 4],
    [402, 'insufficient_credits', 6],
    [403, 'plan_required', 6],
    [404, 'not_covered', 1],
  ])('%s %s → exit %s', async (status, code, exit) => {
    vi.mocked(fetch).mockResolvedValueOnce(problem(status, code));
    expect(await exitOf('companies', 'get', 'AAPL')).toBe(exit);
    expect(err.join('\n')).toContain('request id: req_1');
  });
});

describe('--save', () => {
  it('saves the file a response points to, size and SHA-256 verified', async () => {
    const bytes = Buffer.from('%PDF-1.7 test');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ id: 'n1', title: 'T', pdf: { url: 'https://storage.example.com/n1.pdf', sha256, bytes: bytes.length } }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const file = join(mkdtempSync(join(tmpdir(), 'invd-save-')), 'n1.pdf');
    await run('news', 'get', 'n1', '--save', file, '--json', 'title');
    expect(readFileSync(file)).toEqual(bytes);
    expect((calls()[1]?.init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
    expect(err.join('\n')).toContain(`Saved ${file}`);
  });

  it('a checksum mismatch saves nothing and exits 5', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ id: 'n1', pdf: { url: 'https://storage.example.com/n1.pdf', sha256: '0'.repeat(64), bytes: 3 } }))
      .mockResolvedValueOnce(new Response(Buffer.from('abc'), { status: 200 }));
    const file = join(mkdtempSync(join(tmpdir(), 'invd-save-')), 'n1.pdf');
    expect(await exitOf('news', 'get', 'n1', '--save', file)).toBe(5);
  });
});

describe('manifest coverage', () => {
  it('every operation with a download object takes --save; no list does', () => {
    const operations = loadManifest().operations;
    expect(operations.filter(operation => operation.download !== undefined).map(operation => operation.operationId).sort())
      .toEqual(['getAudio', 'getInvestorDocument', 'getNewsItem', 'getTranscript']);
    expect(operations.some(operation => operation.list && operation.download !== undefined)).toBe(false);
  });
});
