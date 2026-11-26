import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, loadManifest } from '../../../src/cli.js';
import { PENDING_STATUSES, waitClock } from '../../../src/job-wait.js';
import { setJsonMode } from '../../../src/shared/spinner.js';
import { hiddenUrl, jobCoverageNote, REASON_LABELS, SCOPE_LABELS } from '../../../src/spec-commands.js';

/** The bulk data commands of Data API 12.2 (`invd bulk …`): signed downloads, `--out`, `--print-url`, `export --wait`. */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const BYTES = Buffer.from('PAR1 parquet bytes PAR1');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const SIGNED = 'https://bucket.r2.cloudflarestorage.com/bulk/f13.parquet?X-Amz-Signature=abc123';
const ticket = (url = SIGNED, extra: Record<string, unknown> = {}) => ({
  url,
  expires_at: '2026-11-26T16:15:00Z',
  filename: 'sec-f13-2026q3.parquet',
  bytes: BYTES.length,
  sha256: SHA,
  content_type: 'application/vnd.apache.parquet',
  ...extra,
});
const file = (status = 200) => (status === 200
  ? new Response(BYTES, { status, headers: { 'Content-Type': 'application/vnd.apache.parquet' } })
  : new Response('<Error><Code>AccessDenied</Code></Error>', { status }));
const job = (status: string, extra: Record<string, unknown> = {}) => ({
  export_id: 'bx_01JDXR2A4B6C8D0E2F4G6H8J0K', status, dataset: 'f13', format: 'parquet', from: '2025-01-01',
  to: '2026-09-30', created_at: '2026-11-26T16:00:00Z', row_count: null, bytes: null, expires_at: null, error_code: null,
  coverage: null, ...extra,
});

let out: string[];
let err: string[];
let dir: string;

const run = async (...args: string[]) => {
  await createProgram().parseAsync(['node', 'invd', ...args]);
};
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
const calls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

beforeEach(() => {
  setJsonMode(false);
  vi.stubGlobal('fetch', vi.fn());
  process.env.INVD_API_KEY = 'k';
  process.env.INVD_BASE_URL = 'https://api.example.com';
  out = [];
  err = [];
  dir = mkdtempSync(join(tmpdir(), 'invd-bulk-'));
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { err.push(parts.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.INVD_API_KEY;
  delete process.env.INVD_BASE_URL;
});

describe('manifest', () => {
  it('both bulk downloads are signed downloads at the answer root; the four public-URL downloads are not', () => {
    const operations = loadManifest().operations;
    const signed = operations.filter(operation => operation.signedDownload).map(operation => [operation.operationId, operation.download]);
    expect(signed.sort()).toEqual([['getBulkExportDownload', ''], ['getBulkFileDownload', '']]);
    expect(loadManifest().groups.find(group => group.name === 'bulk')?.description).toContain('SEC data sets as files');
  });
});

describe('invd bulk download', () => {
  it('--out DIR saves under the answer\'s filename, size and SHA-256 verified, keyless; the rendered answer hides the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ticket())).mockResolvedValueOnce(file());
    await run('bulk', 'download', 'bf_01JDXQ8M6V3S2T4N5P7R9K0W1Y', '--out', dir, '--json');
    expect(calls()).toEqual(['https://api.example.com/v1/bulk/files/bf_01JDXQ8M6V3S2T4N5P7R9K0W1Y/download', SIGNED]);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).not.toHaveProperty('headers');
    expect(readFileSync(join(dir, 'sec-f13-2026q3.parquet'))).toEqual(BYTES);
    const printed = out.join('\n');
    expect(printed).not.toContain('X-Amz-Signature');
    expect(JSON.parse(printed).url).toBe(hiddenUrl('2026-11-26T16:15:00Z'));
    expect(err.join('\n')).toContain('Saved ');
  });

  it('without a save flag the answer (every format) shows <hidden: valid until …> instead of the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ticket())).mockResolvedValueOnce(json(ticket()));
    await run('bulk', 'download', 'bf_1', '--json');
    await run('bulk', 'download', 'bf_1', '--plain');
    expect(out.join('\n')).not.toContain('X-Amz');
    expect(out.join('\n')).toContain('<hidden: valid until 2026-11-26T16:15:00Z; use --save, --out or --print-url>');
    expect(calls()).toHaveLength(2);
  });

  it('--print-url prints the URL alone and downloads nothing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ticket()));
    await run('bulk', 'download', 'bf_1', '--print-url');
    expect(out).toEqual([SIGNED]);
    expect(calls()).toHaveLength(1);
  });

  it.each([
    [['--out', '.', '--save', 'x.parquet']],
    [['--print-url', '--out', '.']],
    [['--print-url', '--save', 'x.parquet']],
  ])('%j is refused before any request (exit 2)', async (flags) => {
    expect(await exitOf('bulk', 'download', 'bf_1', ...flags)).toBe(2);
    expect(calls()).toHaveLength(0);
  });

  it('an expired URL (403 from the file host) asks the API once more and saves from the new URL', async () => {
    const fresh = `${SIGNED}&fresh=1`;
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(ticket()))
      .mockResolvedValueOnce(file(403))
      .mockResolvedValueOnce(json(ticket(fresh)))
      .mockResolvedValueOnce(file());
    await run('bulk', 'download', 'bf_1', '--out', dir);
    expect(calls()).toEqual([
      'https://api.example.com/v1/bulk/files/bf_1/download', SIGNED,
      'https://api.example.com/v1/bulk/files/bf_1/download', fresh,
    ]);
    expect(readFileSync(join(dir, 'sec-f13-2026q3.parquet'))).toEqual(BYTES);
    expect(err.join('\n')).toContain('counts as another download');
  });

  it('a second 403 fails with a sentence after exactly one refetch, nothing saved (exit 1)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(ticket()))
      .mockResolvedValueOnce(file(403))
      .mockResolvedValueOnce(json(ticket()))
      .mockResolvedValueOnce(file(403));
    expect(await exitOf('bulk', 'download', 'bf_1', '--out', dir)).toBe(1);
    expect(calls()).toHaveLength(4);
    expect(err.join('\n')).toContain('refused the new download URL as well');
    expect(existsSync(join(dir, 'sec-f13-2026q3.parquet'))).toBe(false);
  });

  it('a public-URL download never refetches on 403 and keeps printing its URL', async () => {
    const pdf = { url: 'https://storage.invinite.com/n1.pdf', sha256: SHA, bytes: BYTES.length };
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'n1', pdf })).mockResolvedValueOnce(file(403));
    expect(await exitOf('news', 'get', 'n1', '--save', join(dir, 'n1.pdf'))).toBe(1);
    expect(calls()).toHaveLength(2);
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'n1', pdf }));
    await run('news', 'get', 'n1', '--json');
    expect(out.join('\n')).toContain('https://storage.invinite.com/n1.pdf');
  });

  it('--out exists only where the answer states a filename (the bulk downloads); a public-URL download has --save only', async () => {
    const named = loadManifest().operations.filter(operation => operation.downloadNamed).map(operation => operation.operationId);
    expect(named.sort()).toEqual(['getBulkExportDownload', 'getBulkFileDownload']);
    await expect(run('news', 'get', 'n1', '--out', dir)).rejects.toThrow("unknown option '--out'");
    expect(calls()).toHaveLength(0);
  });

  it('an answer whose filename is missing or reduces to nothing is refused for --out, nothing saved', async () => {
    for (const filename of [undefined, '..']) {
      vi.mocked(fetch).mockResolvedValueOnce(json(ticket(SIGNED, { filename })));
      expect(await exitOf('bulk', 'download', 'bf_1', '--out', dir)).toBe(1);
    }
    expect(err.join('\n')).toContain('names no file name for --out');
    expect(calls()).toHaveLength(2);
  });

  it('a filename with a path is reduced to its base name inside --out', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ticket(SIGNED, { filename: '../../etc/f13.parquet' }))).mockResolvedValueOnce(file());
    await run('bulk', 'export-download', 'bx_1', '--out', dir);
    expect(readFileSync(join(dir, 'f13.parquet'))).toEqual(BYTES);
  });

  it.each([['--jq', '.url'], ['--output', 'csv'], ['--output', 'jsonl']])('%s %s never shows the signed URL', async (...flags) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ticket()));
    await run('bulk', 'download', 'bf_1', ...flags);
    expect(out.join('\n')).not.toContain('X-Amz');
    expect(out.join('\n')).toContain('hidden: valid until');
  });
});

describe('invd bulk export --wait', () => {
  const create = ['bulk', 'export', '--dataset', 'f13', '--company', 'AAPL,MSFT', '--date-field', 'period_of_report',
    '--from', '2025-01-01', '--to', '2026-09-30', '--format', 'parquet'];
  let sleeps: number[];

  beforeEach(() => {
    sleeps = [];
    vi.spyOn(waitClock, 'sleep').mockImplementation(async (ms: number) => { sleeps.push(ms); });
  });

  it('sends the body, polls every 10 s until ready, then downloads with --out', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(job('queued'), 202))
      .mockResolvedValueOnce(json(job('running')))
      .mockResolvedValueOnce(json(job('ready', { row_count: 12, bytes: BYTES.length })))
      .mockResolvedValueOnce(json(ticket()))
      .mockResolvedValueOnce(file());
    await run(...create, '--wait', '--out', dir);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ dataset: 'f13', company: ['AAPL', 'MSFT'], date_field: 'period_of_report', from: '2025-01-01', to: '2026-09-30', format: 'parquet' });
    expect(calls()).toEqual([
      'https://api.example.com/v1/bulk/exports',
      'https://api.example.com/v1/bulk/exports/bx_01JDXR2A4B6C8D0E2F4G6H8J0K',
      'https://api.example.com/v1/bulk/exports/bx_01JDXR2A4B6C8D0E2F4G6H8J0K',
      'https://api.example.com/v1/bulk/exports/bx_01JDXR2A4B6C8D0E2F4G6H8J0K/download',
      SIGNED,
    ]);
    expect(sleeps).toEqual([10_000, 10_000]);
    expect(readFileSync(join(dir, 'sec-f13-2026q3.parquet'))).toEqual(BYTES);
    expect(out.join('\n')).toContain('ready');
  });

  it.each([['failed', 1], ['expired', 3]])('stops on %s: prints the job, downloads nothing, exit %s', async (status, exit) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(job('queued'), 202))
      .mockResolvedValueOnce(json(job(status, status === 'failed' ? { error_code: 'build_failed' } : {})));
    expect(await exitOf(...create, '--wait', '--out', dir)).toBe(exit);
    expect(calls()).toHaveLength(2);
    expect(out.join('\n')).toContain(status);
    expect(err.join('\n')).toContain(status === 'failed' ? 'failed (build_failed)' : 'expired');
  });

  it('names the export id on stderr before polling, also under --json (the spinner is silent there)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(job('queued'), 202)).mockResolvedValueOnce(json(job('ready')));
    await run(...create, '--wait', '--json');
    expect(err.join('\n')).toContain('bx_01JDXR2A4B6C8D0E2F4G6H8J0K created');
    expect(JSON.parse(out.join('\n')).status).toBe('ready');
  });

  it('an expired URL during --wait is asked for once more', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(job('queued'), 202))
      .mockResolvedValueOnce(json(job('ready')))
      .mockResolvedValueOnce(json(ticket()))
      .mockResolvedValueOnce(file(403))
      .mockResolvedValueOnce(json(ticket()))
      .mockResolvedValueOnce(file());
    await run(...create, '--wait', '--out', dir);
    expect(calls().filter(url => url.endsWith('/download'))).toHaveLength(2);
    expect(readFileSync(join(dir, 'sec-f13-2026q3.parquet'))).toEqual(BYTES);
  });

  it('a failed download after the job is ready prints the job first and how to download it again', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(job('queued'), 202))
      .mockResolvedValueOnce(json(job('ready')))
      .mockResolvedValueOnce(json(ticket(SIGNED, { sha256: '0'.repeat(64) })))
      .mockResolvedValueOnce(file());
    expect(await exitOf(...create, '--wait', '--out', dir)).toBe(5);
    expect(out.join('\n')).toContain('ready');
    expect(err.join('\n')).toContain('invd bulk export-download bx_01JDXR2A4B6C8D0E2F4G6H8J0K --out <dir>');
  });

  it('a wait that gives up names the export id and how to follow it', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(job('queued'), 202))
      .mockResolvedValueOnce(json({ title: 'Not found', status: 404, code: 'not_found', detail: 'gone' }, 404));
    expect(await exitOf(...create, '--wait')).toBe(3);
    expect(err.join('\n')).toContain('follow it with invd bulk export-status bx_01JDXR2A4B6C8D0E2F4G6H8J0K');
  });

  it('an existing --save target is refused before the export is created', async () => {
    const target = join(dir, 'f13.parquet');
    writeFileSync(target, 'old');
    expect(await exitOf(...create, '--wait', '--save', target)).toBe(2);
    expect(calls()).toHaveLength(0);
  });

  it('a status the CLI does not know ends the wait with exit 1 instead of polling forever', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(job('queued'), 202)).mockResolvedValueOnce(json(job('cancelled')));
    expect(await exitOf(...create, '--wait')).toBe(1);
    expect(calls()).toHaveLength(2);
    expect(err.join('\n')).toContain('unknown status cancelled');
  });

  it('every BulkExport.status of the spec is pending or one of the three handled terminal statuses', () => {
    const spec = JSON.parse(readFileSync(new URL('../../../openapi.json', import.meta.url), 'utf8'));
    const statuses: string[] = spec.components.schemas.BulkExport.properties.status.enum;
    expect(statuses.filter(status => !PENDING_STATUSES.includes(status)).sort()).toEqual(['expired', 'failed', 'ready']);
  });

  it('an export already ready (an idempotent replay) is not polled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(job('ready')));
    await run(...create, '--wait');
    expect(calls()).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('--out without --wait is refused before the export is created (exit 2)', async () => {
    expect(await exitOf(...create, '--out', dir)).toBe(2);
    expect(calls()).toHaveLength(0);
    expect(err.join('\n')).toContain('add --wait');
  });

  it('prints the coverage reason and the N-PORT scope of a finished export on stderr', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(job('ready', {
      coverage: { from: '2025-07-01', through: '2026-09-30', releases: ['2026q3'], reason: 'before_postgres_window', scope: 'listed_funds_full_unlisted_funds_holders_only' },
    })));
    await run(...create, '--wait');
    expect(err.join('\n')).toContain(REASON_LABELS.before_postgres_window);
    expect(err.join('\n')).toContain(SCOPE_LABELS.listed_funds_full_unlisted_funds_holders_only);
  });
});

describe('jobCoverageNote', () => {
  it('labels both coverage reasons and the scope; nothing for a complete export', () => {
    expect(jobCoverageNote({ coverage: { reason: 'capped_window', scope: null } })).toBe(`coverage: ${REASON_LABELS.capped_window}`);
    expect(jobCoverageNote({ coverage: { reason: null, scope: null } })).toBeUndefined();
    expect(jobCoverageNote({ coverage: null })).toBeUndefined();
  });
});
