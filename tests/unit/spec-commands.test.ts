import { completionTable } from '../../src/commands/completion.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram, loadManifest } from '../../src/cli.js';
import { coverageNote, parseFiscalPeriod, REASON_LABELS, sourceNote, wireValue } from '../../src/spec-commands.js';
import { UsageError } from '../../src/shared/errors.js';
import { setJsonMode } from '../../src/shared/spinner.js';
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
  setJsonMode(false); // module state: one process runs one command, these tests run many
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

  it.each([
    ['list', '/v1/segments'],
    ['list-detailed', '/v1/segments/detailed'],
  ])('invd segments %s sends category, statement metric and link filters independently', async (action, path) => {
    const categoryIds = 'seg_operating_income_business_segment,seg_total_assets_business_segment';
    const args = ['segments', action, 'AMZN', '-p', 'annual'];
    vi.mocked(fetch).mockImplementation(async () => page([]));
    await run(...args, '--segment-id', categoryIds, '--metric', 'is_operating_income', '--follow-links', '--json');
    await run(...args, '--no-follow-links', '--json');
    await run(...args, '--json');

    const urls = calls().map(call => new URL(call.url));
    expect(urls.map(url => url.pathname)).toEqual([path, path, path]);
    expect(urls.map(url => Object.fromEntries(url.searchParams))).toEqual([
      { company: 'AMZN', period: 'annual', segment_id: categoryIds, metric: 'is_operating_income', follow_links: 'true' },
      { company: 'AMZN', period: 'annual', follow_links: 'false' },
      { company: 'AMZN', period: 'annual' },
    ]);
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
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/filings?symbol=AAPL&form=10-K&filed_at.gte=2025-01-01');
    await run('ipos', '--no-is-spac', '--json');
    expect(calls()[1]?.url).toContain('is_spac=false');
  });

  it('a member id is the positional and goes in the path, encoded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ accession: '0000320193-26-000026' }));
    await run('filings', 'get', '0000320193-26-000026', '--json');
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/filings/0000320193-26-000026');
  });

  it.each(['pause', 'resume'])("invd alert-users %s percent-encodes the end user's id in the action path (/ : space @)", async (verb) => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ external_user_id: 'org/a:b c@x', status: verb === 'pause' ? 'paused' : 'active' }));
    await run('alert-users', verb, 'org/a:b c@x', '--json');
    expect(calls()).toHaveLength(1);
    // encodeURIComponent: a raw `/` or `:` would end the segment or read as the action; the server decodes it.
    expect(calls()[0]?.url).toBe(`https://api.example.com/v1/alert-users/org%2Fa%3Ab%20c%40x:${verb}`);
    expect(calls()[0]?.init?.method).toBe('POST');
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

  it('invd alerts list filters by symbol and destination (Data API 7.1: --symbol / -s, --destination-id / -d)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page([{ id: 'alt_1' }])).mockResolvedValueOnce(page([{ id: 'alt_1' }]));
    await run('alerts', 'list', '--symbol', 'AAPL', '--destination-id', 'dst_1', '--json');
    await run('alerts', 'list', '-s', 'msft', '-d', 'dst_2', '--json');
    expect(calls().map(call => call.url)).toEqual([
      'https://api.example.com/v1/alerts?symbol=AAPL&destination_id=dst_1',
      'https://api.example.com/v1/alerts?symbol=msft&destination_id=dst_2',
    ]);
  });

  it('body flags (one object deep) over --body, the header parameter, POST', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'alt_1' }));
    await run('alerts', 'create', '--body', '{"trigger":{"mode":"once"}}', '--type', 'filing', '--ciks', '0000320193,0000789019', '--idempotency-key', 'k-1', '--json');
    const [call] = calls();
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ trigger: { mode: 'once' }, type: 'filing', condition: { ciks: ['0000320193', '0000789019'] } });
    expect((call?.init?.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1');
  });

  it('a required body without one is a usage error naming its flags', async () => {
    expect(await exitOf('alerts', 'create')).toBe(2);
    expect(err.join('\n')).toContain('Pass --type <type>');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a missing required positional or an unknown flag is a usage error (commander, exit 2 in bin)', async () => {
    const program = createProgram();
    program.commands.forEach(command => command.commands.forEach(child => child.exitOverride()));
    await expect(program.parseAsync(['node', 'invd', 'companies', 'get'])).rejects.toMatchObject({ code: 'commander.missingArgument' });
  });
});

describe('--dry-run, confirmation, delete', () => {
  it.each([
    { args: ['news', 'list'], path: '/v1/news', query: {} },
    { args: ['news', 'list', 'AAPL'], path: '/v1/news', query: { company: 'AAPL' } },
    { args: ['news', 'list', '--published-at-gte', '2026-11-25T05:00:00Z'], path: '/v1/news', query: { 'published_at.gte': '2026-11-25T05:00:00Z' } },
    { args: ['search', 'news', 'buyback'], path: '/v1/search/news', query: { q: 'buyback' } },
    { args: ['search', 'news', 'buyback', '--company', 'AAPL,MSFT'], path: '/v1/search/news', query: { q: 'buyback', company: 'AAPL,MSFT' } },
    { args: ['search', 'transcripts', 'gross margin'], path: '/v1/search/transcripts', query: { q: 'gross margin' } },
    { args: ['search', 'transcripts', 'gross margin', '--company', 'AAPL,MSFT'], path: '/v1/search/transcripts', query: { q: 'gross margin', company: 'AAPL,MSFT' } },
  ])('plans $args with exactly the requested scope', async ({ args, path, query }) => {
    await run(...args, '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    const match = /GET (https?:\/\/[^\s]+)/.exec(out.join('\n'));
    expect(match).not.toBeNull();
    const url = new URL(match![1]!);
    expect(url.pathname).toBe(path);
    expect(Object.fromEntries(url.searchParams)).toEqual(query);
  });

  it('invd holders AAPL --source 13f --all --dry-run prints a credit estimate and makes no request', async () => {
    await run('holders', 'AAPL', '--source', '13f', '--all', '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    const text = out.join('\n');
    expect(text).toContain('GET https://api.example.com/v1/holders?symbol=AAPL&source=13f');
    expect(text).toContain('credits: 1 × pages');
    expect(text).toContain('dry run: no request was sent');
  });

  it.each(['list', 'holdings'])('invd insider-trades %s --owner <cik> needs no company: owner=, no company=', async (action) => {
    const path = action === 'list' ? '/v1/insider-trades' : '/v1/insider-holdings';
    await run('insider-trades', action, '--owner', '0001214156', '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain(`GET https://api.example.com${path}?owner=0001214156`);

    vi.mocked(fetch).mockResolvedValueOnce(page([]));
    await run('insider-trades', action, '--owner', '0001214156', '--json');
    const url = new URL(calls()[0]?.url ?? '');
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('owner')).toBe('0001214156');
    expect(url.searchParams.has('company')).toBe(false);
  });

  it.each([
    ['instruments', 'all', '/v1/instruments?is_active=all'],
    ['funds', 'false', '/v1/funds?is_active=false'],
  ])('invd %s list --is-active %s plans the value; no flag sends nothing (the API default)', async (group, value, request) => {
    await run(group, 'list', '--is-active', value, '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain(`GET https://api.example.com${request}`);

    vi.mocked(fetch).mockResolvedValueOnce(page([]));
    await run(group, 'list', '--json');
    expect(new URL(calls()[0]?.url ?? '').searchParams.has('is_active')).toBe(false);
  });

  it('--is-active takes only true|false|all; --no-is-active is gone (commander, exit 2 in bin)', async () => {
    const program = () => {
      const created = createProgram();
      created.commands.forEach(command => command.commands.forEach(child => child.exitOverride()));
      return created;
    };
    await expect(program().parseAsync(['node', 'invd', 'instruments', 'list', '--is-active', 'yes']))
      .rejects.toMatchObject({ code: 'commander.invalidArgument' });
    await expect(program().parseAsync(['node', 'invd', 'instruments', 'list', '--no-is-active']))
      .rejects.toMatchObject({ code: 'commander.unknownOption' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invd people list AAPL --include-operators sends include_operators=true; without it nothing', async () => {
    await run('people', 'list', 'AAPL', '--include-operators', '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('GET https://api.example.com/v1/people?company=AAPL&include_operators=true');

    vi.mocked(fetch).mockResolvedValueOnce(page([]));
    await run('people', 'list', 'AAPL', '--json');
    const url = new URL(calls()[0]?.url ?? '');
    expect(url.searchParams.get('company')).toBe('AAPL');
    expect(url.searchParams.has('include_operators')).toBe(false);
  });

  it('invd filings list without a symbol plans the market-wide GET /v1/filings (Data API 12.3); AAPL unchanged', async () => {
    expect(loadManifest().operations.find(o => o.operationId === 'listFilings')?.positional)
      .toEqual({ name: 'symbol', required: false, variadic: 'comma' });
    await run('filings', 'list', '--dry-run', '--output', 'table');
    expect(fetch).not.toHaveBeenCalled();
    const planned = out.join('\n');
    expect(planned).toContain('GET https://api.example.com/v1/filings');
    expect(planned).not.toContain('symbol=');

    out = [];
    await run('filings', 'list', 'AAPL', '--dry-run', '--output', 'table');
    expect(out.join('\n')).toContain('GET https://api.example.com/v1/filings?symbol=AAPL');

    const row = { accession: '0001234567-26-000001', symbol: null, company: null, fund: null, filer: { cik: '0001234567', name: 'Newco Inc', role: 'filer' }, form: 'S-1' };
    vi.mocked(fetch).mockResolvedValueOnce(page([row]));
    await run('filings', 'list', '--json');
    expect(new URL(calls()[0]?.url ?? '').searchParams.has('symbol')).toBe(false);
    expect(JSON.parse(out.at(-1) ?? '{}').data[0]).toMatchObject({ symbol: null, filer: { name: 'Newco Inc' } });
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

  it('a delete under --no-input exits 2 naming --yes; --dry-run of a delete sends nothing', async () => {
    expect(await exitOf('destinations', 'delete', 'dst_1', '--no-input')).toBe(2);
    expect(err.join('\n')).toContain('--yes');
    await run('destinations', 'delete', 'dst_1', '--dry-run');
    expect(out.join('\n')).toContain('DELETE https://api.example.com/v1/destinations/dst_1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a delete needs --yes without a terminal', async () => {
    expect(await exitOf('destinations', 'delete', 'dst_1')).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await run('destinations', 'delete', 'dst_1', '--yes');
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

  it('--all that fails after written rows exits 7 with the resume cursor', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'))
      .mockResolvedValueOnce(page([{ day: '2026-01-19' }], 'c3'))
      .mockResolvedValueOnce(json({ title: 'Bad', detail: 'boom', code: 'internal' }, 500));
    expect(await exitOf('market', 'holidays', '--all')).toBe(7);
    expect(out).toHaveLength(2);
    expect(err.join('\n')).toContain('resume with --cursor c3');
  });

  it('--all --jq that fails after printed pages also exits 7 with the resume cursor', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'))
      .mockResolvedValueOnce(json({ title: 'Bad', detail: 'boom', code: 'internal' }, 500));
    expect(await exitOf('market', 'holidays', '--all', '--jq', '.data[].day')).toBe(7);
    expect(out).toEqual(['2026-01-01']);
    expect(err.join('\n')).toContain('resume with --cursor c2');
  });

  it('a walk cut by 503s after the first page (retries spent) exits 7 with the cursor, no HTTP number', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'));
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      vi.mocked(fetch).mockResolvedValueOnce(json({ title: 'Service unavailable', status: 503, detail: 'Try later', code: 'unavailable', remedy: 'Retry after the number of seconds in Retry-After.' }, 503, { 'Retry-After': '0' }));
    }
    expect(await exitOf('market', 'holidays', '--all')).toBe(7);
    expect(calls()).toHaveLength(7);
    const text = err.join('\n');
    expect(text).toContain('✗ Try later  (unavailable)');
    expect(text).toContain('Stopped after 1 row(s) — resume with --cursor c2');
    // --all streams JSONL (machine mode), so the problem body follows as one JSON line; the human lines carry no status.
    expect(err.filter(line => !line.startsWith('{')).join('\n')).not.toContain('503');
  });

  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('%s in a walk prints the resume cursor and exits %i', async (signal, code) => {
    const exits: number[] = [];
    vi.mocked(process.exit).mockImplementation(((value?: number) => { exits.push(value ?? 0); }) as never);
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([{ day: '2026-01-01' }], 'c2'))
      .mockImplementationOnce(async () => {
        process.emit(signal, signal);
        throw new Error('aborted');
      });
    await run('market', 'holidays', '--all');
    expect(exits[0]).toBe(code);
    expect(err.join('\n')).toContain('Stopped after 1 row(s) — resume with --cursor c2');
  });

  it('a coverage that is not complete is a yellow stderr note', async () => {
    expect(coverageNote({ meta: { coverage: { state: 'pending', retry_after_s: 30 } } })).toContain('retry in 30s');
    expect(coverageNote({ meta: { coverage: { state: 'complete' } } })).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(page([], null, { coverage: { state: 'partial', through: '2026-11-09' } }));
    await run('holders', 'AAPL', '--source', '13f', '--json');
    expect(err.join('\n')).toContain('coverage: partial through 2026-11-09');
  });

  it('a known document without an outline explains its complete empty answer on stderr', async () => {
    const coverage = { state: 'complete', reason: 'no_legacy_outline' };
    expect(coverageNote({ meta: { coverage } })).toBe(`coverage: complete — ${REASON_LABELS.no_legacy_outline}`);
    vi.mocked(fetch).mockResolvedValueOnce(page([], null, { coverage }));
    await run('documents', 'sections', '8be0b759-1a9d-5f89-8308-bd86185f5e1f', '--json');
    expect(err.join('\n')).toContain('this known document has no available item outline');
    expect(err.join('\n')).not.toContain('not in the SEC registry');
  });

  it('invd funds holdings SPY: the table header names source + as-of; the held security is a column', async () => {
    expect(sourceNote({ meta: { source: 'nport', as_of: '2026-09-30', reason: null } })).toBe('source: SEC N-PORT report · as of 2026-09-30');
    expect(sourceNote({ meta: { source: 'issuer_daily', as_of: '2026-11-13', reason: 'single_asset_trust' } })).toContain('holds one asset');
    expect(sourceNote({ meta: { coverage: { state: 'complete' } } })).toBeUndefined();
    const meta = { coverage: { state: 'complete' }, source: 'issuer_daily', as_of: '2026-11-13', reason: null };
    vi.mocked(fetch).mockResolvedValueOnce(page([{ fund: { symbol: 'SPY' }, security: { name: 'NVIDIA CORP', symbol: 'NVDA' }, weight_pct: 7.4, source: 'issuer_daily', as_of: '2026-11-13' }], null, meta));
    await run('funds', 'holdings', 'SPY', '--as-of', '2026-11-13', '--output', 'table');
    const url = new URL(calls()[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/funds/SPY/holdings');
    expect(url.searchParams.get('as_of')).toBe('2026-11-13');
    expect(err.join('\n')).toContain('source: issuer file (daily) · as of 2026-11-13');
    expect(out.join('\n')).toContain('NVIDIA CORP');
    expect(out.join('\n')).toContain('NVDA');
  });

  it('invd funds weights SPY --dimension sector sends the dimension; --json keeps the header off stderr', async () => {
    const meta = { coverage: { state: 'complete' }, source: 'issuer_monthly', as_of: '2026-10-31' };
    vi.mocked(fetch).mockResolvedValueOnce(page([{ dimension: 'sector', bucket: 'Information Technology', weight_pct: 31.2, positions: 68, basis: 'issuer_stated' }], null, meta));
    await run('funds', 'weights', 'SPY', '--dimension', 'sector', '--json');
    const url = new URL(calls()[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/funds/SPY/weights');
    expect(url.searchParams.get('dimension')).toBe('sector');
    expect(err.join('\n')).not.toContain('source:');
    expect(out.join('\n')).toContain('Information Technology');
  });

  it('invd instruments get TQQQ prints the type, structure and datasets first', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', type: 'etf', structure: 'registered_fund', exchange: 'XNAS', is_active: true,
      datasets: ['profile', 'filings', 'dividends', 'splits', 'holders', 'fund_holdings', 'fund_weights', 'alerts'],
    }));
    await run('instruments', 'get', 'TQQQ', '--output', 'table');
    expect(calls()[0]?.url).toBe('https://api.example.com/v1/instruments/TQQQ');
    const lines = out.join('\n').split('\n').map(line => line.trim());
    expect(lines[0]).toMatch(/^type\s+etf$/);
    expect(lines[1]).toMatch(/^structure\s+registered_fund$/);
    expect(lines[2]).toMatch(/^datasets\s+profile, filings, dividends, splits, holders, fund_holdings, fund_weights, alerts$/);
  });

  it('invd holders / dividends / funds list send the 7.0 parameters (one held symbol; symbol lists elsewhere)', async () => {
    vi.mocked(fetch).mockImplementation(async () => page([]));
    await run('holders', 'NVDA', '--source', 'nport', '--json');
    await run('holders', 'changes', 'TSLA', '--type', 'sold_out', '--json');
    await run('dividends', 'TQQQ', 'SPY', '--json');
    await run('splits', 'NVDA', '--json');
    await run('funds', 'list', '--type', 'etf', '--json');
    await run('filers', 'holdings', '0001067983', '--json');
    await run('filings', 'holdings', '0001067983-26-000004', '--json');
    expect(calls().map(call => call.url)).toEqual([
      'https://api.example.com/v1/holders?symbol=NVDA&source=nport',
      'https://api.example.com/v1/holder-changes?symbol=TSLA&type=sold_out',
      'https://api.example.com/v1/dividends?symbol=TQQQ%2CSPY',
      'https://api.example.com/v1/splits?symbol=NVDA',
      'https://api.example.com/v1/funds?type=etf',
      'https://api.example.com/v1/filers/0001067983/holdings',
      'https://api.example.com/v1/filings/0001067983-26-000004/holdings',
    ]);
    // ONE held instrument: a second word is a stray argument (usage, exit 2), never a comma list.
    await expect(run('holders', 'NVDA', 'AAPL')).rejects.toThrow("too many arguments for 'list'");
  });

  it('every meta.reason value of the contract has a label (the composition / weights enums of openapi.json)', () => {
    const spec = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as unknown;
    const reasons = new Set<string>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;
      const meta = (record.properties as Record<string, { properties?: Record<string, { enum?: string[] }> }> | undefined)?.meta;
      for (const value of meta?.properties?.reason?.enum ?? []) reasons.add(value);
      Object.values(record).forEach(visit);
    };
    visit((spec as { paths: unknown }).paths);
    expect([...reasons].sort()).toEqual(['issuer_source_unavailable', 'no_composition', 'single_asset_trust', 'source_stale', 'weights_unavailable']);
    for (const reason of reasons) expect(REASON_LABELS[reason], reason).toBeTruthy();
    expect(sourceNote({ meta: { reason: 'fund_cusip_unknown' } })).toContain('own CUSIP is not known');
  });

  it.each([
    ['holdings', 'invd holders <symbol> --source 13f'],
    ['fund-holdings', 'invd funds holdings <fund>'],
    ['etf-holdings', 'invd funds holdings <fund>'],
    ['etf-weights', 'invd funds weights <fund>'],
  ])('invd %s is gone (invd 8.0) and the error names its replacement', async (removed, replacement) => {
    const program = createProgram();
    let text = '';
    program.configureOutput({ writeErr: (chunk) => { text += chunk; } });
    expect(program.commands.map(command => command.name())).not.toContain(removed);
    await expect(program.parseAsync(['node', 'invd', removed, 'SPY'])).rejects.toThrow(`unknown command '${removed}'`);
    expect(text).toContain(`\`invd ${removed}\` was removed in invd 8.0`);
    expect(text).toContain(replacement);
    expect(text).not.toContain('Did you mean');
  });
});

describe('exit codes from problem codes', () => {
  const problem = (status: number, code: string) => json({ type: 't', title: 'T', status, detail: 'd', code, remedy: 'API remedy.', request_id: 'req_1', docs_url: 'https://x' }, status);

  it.each([
    [400, 'invalid_parameter', 2],
    [400, 'cursor_mismatch', 2],
    [401, 'unauthorized', 4],
    [402, 'insufficient_credits', 6],
    [403, 'plan_required', 6],
    [403, 'excluded', 1],
    [404, 'not_covered', 3],
    [404, 'not_found', 3],
    [500, 'internal', 1],
  ])('%s %s → exit %s', async (status, code, exit) => {
    vi.mocked(fetch).mockResolvedValueOnce(problem(status, code));
    expect(await exitOf('companies', 'get', 'AAPL')).toBe(exit);
    expect(err[0]).toBe(`✗ d  (${code})`);
    expect(err.at(-1)).toBe('  req_1  ·  https://x');
    expect(err.join('\n')).not.toContain(String(status));
  });

  it('prints an ambiguous ticker detail and its CIK remedy on the generated filings command', async () => {
    const detail = 'ABC was the ticker of several delisted registrants: CIK 0000012345 (Old Co), CIK 0000067890 (Other Co).';
    const remedy = 'Send the CIK of the one you mean (company=0000012345).';
    vi.mocked(fetch).mockResolvedValueOnce(json({
      title: 'Not covered', status: 404, code: 'not_covered', detail, remedy,
    }, 404));
    expect(await exitOf('filings', 'ABC')).toBe(3);
    expect(err).toEqual([`✗ ${detail}  (not_covered)`, `  ${remedy}`]);
    expect(out).toEqual([]);
  });

  it('a bare 404 (no problem code) is not found: exit 3', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('gone', { status: 404 }));
    expect(await exitOf('companies', 'get', 'NOSUCHCO')).toBe(3);
  });

  it('invd filings AAPL --limit 500: exit 2, three lines (detail + code, the API remedy, request id + docs), no "400"', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      type: 'https://data.invinite.com/docs/errors#invalid_parameter', title: 'Invalid parameter', status: 400,
      detail: 'limit: must be <= 200', code: 'invalid_parameter', param: 'limit',
      errors: [{ param: 'limit', code: 'invalid_parameter', detail: 'limit: must be <= 200' }],
      remedy: 'Pass a limit of at most 200.', request_id: 'req_01JC',
      docs_url: 'https://data.invinite.com/docs/errors#invalid_parameter',
    }, 400));
    expect(await exitOf('filings', 'AAPL', '--limit', '500')).toBe(2);
    expect(err).toEqual([
      '✗ limit: must be <= 200  (invalid_parameter)',
      '  Pass a limit of at most 200.',
      '  req_01JC  ·  https://data.invinite.com/docs/errors#invalid_parameter',
    ]);
  });

  it('several errors[] print one line each, capped at five; uncovered subjects retain API remedies', async () => {
    const errors = Array.from({ length: 7 }, (_, index) => ({ param: `p${index}`, code: 'invalid_parameter', detail: `p${index}: is invalid` }));
    vi.mocked(fetch).mockResolvedValueOnce(json({ title: 'Invalid parameter', status: 400, detail: 'x', code: 'invalid_parameter', errors, remedy: 'Fix p0.' }, 400));
    expect(await exitOf('filings', 'AAPL')).toBe(2);
    expect(err.slice(0, 6)).toEqual([
      ...errors.slice(0, 5).map(issue => `✗ ${issue.detail}  (invalid_parameter)`),
      '  … and 2 more',
    ]);
    expect(err[6]).toBe('  Fix p0.');
    err = [];
    vi.mocked(fetch).mockResolvedValueOnce(problem(404, 'not_covered'));
    await exitOf('companies', 'get', 'ZZZZ');
    expect(err[1]).toBe('  API remedy.');
    err = [];
    vi.mocked(fetch).mockResolvedValueOnce(json({ title: 'Not covered', status: 404, code: 'not_covered', detail: 'Unknown subject.' }, 404));
    await exitOf('companies', 'get', 'ZZZZ');
    expect(err[1]).toBe('  Find the company: invd companies list --q <name>');
  });

  it('under --json the problem body follows as one JSON line on stderr; NO_COLOR prints Error: for ✗', async () => {
    process.env.NO_COLOR = '1';
    try {
      vi.mocked(fetch).mockResolvedValueOnce(problem(404, 'not_found'));
      expect(await exitOf('companies', 'get', 'AAPL', '--json')).toBe(3);
      expect(err[0]).toBe('Error: d  (not_found)');
      expect(JSON.parse(err.at(-1) ?? '')).toMatchObject({ code: 'not_found', remedy: 'API remedy.', request_id: 'req_1' });
    } finally {
      delete process.env.NO_COLOR;
    }
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
      .toEqual(['getAudio', 'getBulkExportDownload', 'getBulkFileDownload', 'getInvestorDocument', 'getNewsItem', 'getTranscript']);
    expect(operations.some(operation => operation.list && operation.download !== undefined)).toBe(false);
  });
});

describe('US macro generated commands', () => {
  it('discovers all nine operations, preserves market holidays and accepts either series spelling', async () => {
    const macro = loadManifest().operations.filter(o => o.group === 'macro');
    expect(macro).toHaveLength(9);
    const group = createProgram().commands.find(c => c.name() === 'macro');
    for (const op of macro) expect(group?.helpInformation()).toContain(op.action);
    expect(createProgram().helpInformation()).toContain('US inflation');
    expect(loadManifest().operations.find(o => o.operationId === 'listMarketHolidays')?.group).toBe('market');
    for (const args of [['cpi_all_sa'], ['--series', 'cpi_all_sa'], ['cpi_all_sa','--series','cpi_all_sa']]) {
      vi.mocked(fetch).mockResolvedValueOnce(page([{ series_id: 'cpi_all_sa', value: 320, change_1m_pct: null }]));
      await run('macro', 'inflation', ...args, '--reference-date-gte', '2025-01-01', '--json');
      const url = new URL(calls().at(-1)!.url);
      expect(url.pathname).toBe('/v1/macro/inflation');
      expect(url.searchParams.get('series')).toBe('cpi_all_sa');
      expect(url.searchParams.get('reference_date.gte')).toBe('2025-01-01');
    }
    expect(await exitOf('macro','inflation','cpi_all_sa','--series','cpi_core_sa','--json')).not.toBe(0);
    expect(await exitOf('macro','inflation','--series','unrecognized','--json')).not.toBe(0);
    expect(calls()).toHaveLength(3);
  });

  it('completes macro commands and flags and sends the documented raw rule in body-file mode', async () => {
    const shell = completionTable(createProgram());
    expect(shell.get('macro')).toContain('yield-curve-snapshot');
    expect(shell.get('macro labor')).toContain('--series');
    const file = join(mkdtempSync(join(tmpdir(), 'invd-rule-')), 'macro-alert.json');
    const body = {type:'macro', condition:{macro_events:['macro.released','macro.revised'],macro_families:['yield_curve'],
      macro_threshold:{series_id:'treasury_par_y10',field:'value',operator:'gt',value:4}},trigger:{mode:'every_time'},destination_ids:['dst_macro_test']};
    writeFileSync(file, JSON.stringify(body));
    for (const flags of [['--validate-only'], []]) {
      vi.mocked(fetch).mockResolvedValueOnce(flags.length ? new Response(null,{status:204}) : json({id:'alt_macro',...body},201));
      await run('alerts','create',...flags,'--body-file',file,'--json');
      expect(JSON.parse(String(calls().at(-1)?.init?.body))).toEqual(body);
    }
    for (const [code, param] of [['invalid_parameter','macro_series_ids'], ['invalid_parameter','macro_threshold.field'], ['plan_required','type']]) {
      vi.mocked(fetch).mockResolvedValueOnce(json({title:'Rule refused',detail:'Invalid macro rule',status:code==='plan_required'?403:400,code,param},code==='plan_required'?403:400));
      expect(await exitOf('alerts','create','--body-file',file,'--json')).not.toBe(0);
    }
  });

  it('executes all nine commands and preserves nullable Treasury maturities and weekly dates', async () => {
    const curve = {date:'2025-02-14', agency:'Treasury',m1:4.32,m1_5:null,m2:4.33,m3:4.31,m4:4.28,m6:4.29,y1:4.22,y2:4.26,y3:4.31,y5:4.38,y7:4.44,y10:4.47,y20:4.74,y30:4.69};
    for (const op of loadManifest().operations.filter(o=>o.group==='macro')) {
      const id = op.action === 'inflation' ? 'cpi_all_sa' : op.action === 'gdp' ? 'real_gdp_growth' : 'initial_claims_sa';
      const record = op.action.startsWith('yield-curve') ? curve : {series_id:id, reference_date:'2026-11-14', value:203000,unit:'claims',change_prior:null};
      vi.mocked(fetch).mockResolvedValueOnce(op.list ? page([record]) : json(record));
      await run('macro',op.action,...(op.positional?['--series',id]:[]),'--json');
      expect(calls().at(-1)?.url).toContain(op.path);
      expect(out.at(-1)).toContain(op.action.startsWith('yield-curve')?'m1_5':'2026-11-14');
    }
    vi.mocked(fetch).mockResolvedValueOnce(page([curve],'next+page/2')).mockResolvedValueOnce(page([curve]));
    await run('macro','yield-curve','--all','--json','--yes');
    expect(new URL(calls().at(-1)!.url).searchParams.get('cursor')).toBe('next+page/2');
    vi.mocked(fetch).mockResolvedValueOnce(json({type:'about:blank',title:'Access denied',status:403,code:'plan_required',detail:'This read requires Lite.'},403));
    expect(await exitOf('macro','yield-curve-snapshot','--json')).not.toBe(0);
  });
});
