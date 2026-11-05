import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/auth.js', () => ({ getApiKey: vi.fn().mockResolvedValue('test-api-key') }));

vi.mock('../../../src/config/config-manager.js', () => ({ getBaseUrl: vi.fn().mockReturnValue('https://api.example.com') }));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { Command } from 'commander';
import { INCOMPLETE_EXIT_CODE, registerSecCommands } from '../../../src/commands/sec.js';
import { loadManifest } from '../../../src/cli.js';
import { setJsonOutput } from '../../../src/shared/json-mode.js';
import { readinessNotes } from '../../../src/shared/readiness.js';
import { registerSpecCommands } from '../../../src/spec-commands.js';

/**
 * The hand-written `sec` downloads and the generated `sec` family's contract: verified downloads (public originals
 * keyless, exports key-authorized), honest readiness, and one parity check per legacy `filings *` command against
 * its `sec …` replacement (task 7 deletes the legacy four in 1.0.0).
 */

const API = 'https://api.example.com';
const PUBLIC = 'https://storage-prod.invinite.com/sec/0123456789abcdef0123456789abcdef';
const ACCESSION = '0000320193-26-000024';
const EXPORT_ID = '6a7350b9-df18-517b-b553-96601b1e0508';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

type Route = (url: string, init?: RequestInit) => Response | undefined;

let dir: string;
let out: string[];
let err: string[];
let calls: { url: string; init?: RequestInit }[];

function stub(route: Route) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = route(String(url), init);
    if (!answer) throw new Error(`unexpected request ${String(url)}`);
    return answer;
  }));
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const bytes = (text: string, headers: Record<string, string>) => new Response(text, { status: 200, headers });

async function run(...args: string[]) {
  const program = new Command();
  program.option('--json').option('--all').exitOverride();
  registerSecCommands(program);
  registerSpecCommands(program, loadManifest());
  await program.parseAsync(['node', 'invd', ...args]);
}

const authOf = (call: { init?: RequestInit }) => (call.init?.headers as Record<string, string> | undefined)?.Authorization;

const document = (filename: string, text: string | null, overrides: Record<string, unknown> = {}) => ({
  filename,
  role: 'primary',
  mime_type: 'text/html',
  availability: 'stored',
  quarantine_reason: null,
  too_large: false,
  sha256: text === null ? 'f'.repeat(64) : sha(text),
  size_bytes: text === null ? 10 : Buffer.byteLength(text),
  canonical: { status: 'published', version_id: '428dc874-2351-5789-a479-209a5533bd82', text_ready: true, visual_ready: true },
  source: text === null ? null : { url: `${PUBLIC}/${filename}` },
  ...overrides,
});

const manifest = (documents: unknown[], readiness = { status: 'ready', reason: null, recoverable: false }) => ({
  api_schema: 'secdoors.v1',
  readiness,
  filing: { accession: ACCESSION, form: '8-K' },
  documents,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'invd-sec-'));
  out = [];
  err = [];
  calls = [];
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { err.push(parts.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(console.log).mockRestore();
  vi.mocked(console.error).mockRestore();
  vi.mocked(process.exit).mockRestore();
  setJsonOutput(false);
  process.exitCode = undefined;
  await rm(dir, { recursive: true, force: true });
});

const plain = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

describe('invd sec export-file', () => {
  const CSV = 'gzip-bytes-of-the-export';
  const exportAnswer = (headers: Record<string, string> = {}) => bytes(CSV, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': 'attachment; filename="is_total_revenue-2025-annual.csv.gz"',
    'X-Content-SHA256': sha(CSV),
    'Content-Length': String(CSV.length),
    'X-Credits-Charged': '1',
    ...headers,
  });

  it('streams the key-authorized file under its server name, verified against X-Content-SHA256', async () => {
    stub(url => (url === `${API}/v1/sec/exports/${EXPORT_ID}/file` ? exportAnswer() : undefined));
    await run('sec', 'export-file', '--export-id', EXPORT_ID, '-o', `${dir}/`);
    expect(await readFile(join(dir, 'is_total_revenue-2025-annual.csv.gz'), 'utf8')).toBe(CSV);
    expect(authOf(calls[0])).toBe('Bearer test-api-key');
    expect(plain(out)).toContain(`sha256 ${sha(CSV)}`);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('a hash mismatch saves nothing and exits 5', async () => {
    stub(() => exportAnswer({ 'X-Content-SHA256': 'a'.repeat(64) }));
    await run('sec', 'export-file', '--export-id', EXPORT_ID, '-o', join(dir, 'x.csv.gz'));
    expect(await readdir(dir)).toEqual([]);
    expect(plain(err)).toMatch(/SHA-256 .* differs/);
    expect(process.exit).toHaveBeenCalledWith(5);
  });

  it('a short body is a partial download: nothing saved, exit 4', async () => {
    stub(() => exportAnswer({ 'Content-Length': String(CSV.length + 10) }));
    await run('sec', 'export-file', '--export-id', EXPORT_ID, '-o', join(dir, 'x.csv.gz'));
    expect(await readdir(dir)).toEqual([]);
    expect(plain(err)).toContain(`Partial download: received ${CSV.length} bytes of ${CSV.length + 10}`);
    expect(process.exit).toHaveBeenCalledWith(4);
  });

  it('a wrong media type is refused (exit 5)', async () => {
    stub(() => exportAnswer({ 'Content-Type': 'text/html' }));
    await run('sec', 'export-file', '--export-id', EXPORT_ID, '-o', join(dir, 'x.csv.gz'));
    expect(await readdir(dir)).toEqual([]);
    expect(process.exit).toHaveBeenCalledWith(5);
  });

  it('resume: an identical existing file with --sha256 is complete without a request; a different one needs --force', async () => {
    const file = join(dir, 'x.csv.gz');
    await writeFile(file, CSV);
    stub(() => undefined);
    await run('sec', 'export-file', '--export-id', EXPORT_ID, '-o', file, '--sha256', sha(CSV));
    expect(calls).toEqual([]);
    expect(plain(out)).toContain('Already complete');

    await writeFile(file, 'other');
    await run('sec', 'export-file', '--export-id', EXPORT_ID, '-o', file, '--sha256', sha(CSV));
    expect(calls).toEqual([]);
    expect(plain(err)).toContain('--force');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('a typed refusal names its code; --json adds the structured body on stderr', async () => {
    const body = {
      error: 'not_ready',
      message: 'Metric exports are not switched on',
      code: 'metric_exports_provider_not_registered',
      readiness: { status: 'not_ready', reason: 'metric_exports_provider_not_registered', recoverable: false },
    };
    stub(() => json(body, 503));
    setJsonOutput(true);
    await run('--json', 'sec', 'export-file', '--export-id', EXPORT_ID, '-o', join(dir, 'x.csv.gz'));
    expect(plain(err)).toContain('Error 503: not_ready (metric_exports_provider_not_registered)');
    expect(JSON.parse(err[err.length - 1])).toEqual({ status: 503, ...body });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('invd sec save', () => {
  it('saves public originals without the key, lists the one without a public copy and exits 3', async () => {
    const TEXT = '<html>8-K</html>';
    stub((url) => {
      if (url === `${API}/v1/sec/filings/${ACCESSION}`) {
        return json(manifest([document('aapl-20261102.htm', TEXT), document('aapl-20261102.xsd', null, { role: 'xbrl' })]));
      }
      if (url === `${PUBLIC}/aapl-20261102.htm`) return bytes(TEXT, { 'Content-Type': 'text/html' });
      return undefined;
    });
    await run('--json', 'sec', 'save', '--accession', ACCESSION, '-o', dir);
    expect(await readFile(join(dir, 'aapl-20261102.htm'), 'utf8')).toBe(TEXT);
    const report = JSON.parse(out.join('\n'));
    expect(report.complete).toBe(false);
    expect(report.documents.map((d: { filename: string; status: string; reason: string | null }) => [d.filename, d.status, d.reason])).toEqual([
      ['aapl-20261102.htm', 'saved', null],
      ['aapl-20261102.xsd', 'not_saved', 'no permanent public copy yet'],
    ]);
    expect(authOf(calls[0])).toBe('Bearer test-api-key');
    expect(authOf(calls[1])).toBeUndefined();
    expect(process.exitCode).toBe(INCOMPLETE_EXIT_CODE);
  });

  it('verifies the manifest size + SHA-256 of a public original', async () => {
    stub(url => (url.startsWith(API)
      ? json(manifest([document('a.htm', 'expected bytes')]))
      : bytes('tampered bytes', { 'Content-Type': 'text/html' })));
    await run('sec', 'save', '--accession', ACCESSION, '-o', dir);
    expect(await readdir(dir)).toEqual([]);
    expect(process.exit).toHaveBeenCalledWith(5);
  });

  it('a pending manifest is incomplete, never "nothing to save"', async () => {
    stub(() => json(manifest([], { status: 'pending', reason: 'mirror_queued', recoverable: true }), 202));
    await run('sec', 'save', '--accession', ACCESSION, '-o', dir);
    expect(plain(err)).toContain('readiness: pending (mirror_queued)');
    expect(process.exitCode).toBe(INCOMPLETE_EXIT_CODE);
  });
});

describe('invd sec save-figure', () => {
  it('saves the public image and prints the immutable citation', async () => {
    stub(url => (url.startsWith(API)
      ? json({ api_schema: 'secdoors.v1', readiness: { status: 'ready', reason: null, recoverable: false }, image: { url: `${PUBLIC}/fig-12.png` } })
      : bytes('png', { 'Content-Type': 'image/png' })));
    await run('--json', 'sec', 'save-figure', '--version-id', 'v1', '--block-id', 'b00012', '-o', `${dir}/`);
    expect(await readFile(join(dir, 'fig-12.png'), 'utf8')).toBe('png');
    expect(JSON.parse(out.join('\n')).citation).toEqual({ version_id: 'v1', block_id: 'b00012' });
  });

  it('no public image is an error with the reason', async () => {
    stub(() => json({ api_schema: 'secdoors.v1', readiness: { status: 'not_ready', reason: 'image_not_public', recoverable: true }, image: null }));
    await run('sec', 'save-figure', '--version-id', 'v1', '--block-id', 'b00012', '-o', dir);
    expect(plain(err)).toContain('image_not_public');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('generated sec commands', () => {
  it('search sends --mode and follows next_cursor pages with --all', async () => {
    const page = (n: number, next: string | null) => json({
      api_schema: 'secdoors.v1',
      readiness: { status: 'ready', reason: null, recoverable: false },
      mode: 'literal',
      coverage: { completeness: 'complete', lexical: null, reasons: [] },
      hits: [{ version_id: `v${n}`, citation: { version_id: `v${n}`, block_id: 'b00001' } }],
      next_cursor: next,
      next_url: next ? `${API}/v1/sec/search?q=x&mode=literal&cursor=${next}` : null,
    });
    stub(url => (url.includes('cursor=c2') ? page(2, null) : page(1, 'c2')));
    await run('--json', '--all', 'sec', 'search', '-q', 'x', '--mode', 'literal');
    expect(new URL(calls[0].url).searchParams.get('mode')).toBe('literal');
    expect(JSON.parse(out.join('\n')).hits.map((hit: { version_id: string }) => hit.version_id)).toEqual(['v1', 'v2']);
  });

  it('refuses a semantic mode before any request', async () => {
    stub(() => undefined);
    await expect(run('sec', 'search', '-q', 'x', '--mode', 'semantic')).rejects.toThrow(/Allowed choices are lexical, literal/);
    expect(calls).toEqual([]);
  });

  it('search switched off is a 503 not_ready error, never an empty result', async () => {
    stub(() => json({ error: 'not_ready', message: 'SEC search is not enabled', code: 'search_provider_not_registered' }, 503));
    await run('sec', 'search', '-q', 'supply chain');
    expect(plain(err)).toContain('Error 503: not_ready (search_provider_not_registered)');
    expect(out).toEqual([]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('a plan denial names the plan', async () => {
    stub(() => json({ error: 'Forbidden', message: 'This endpoint requires STANDARD plan. Your current plan is FREE.' }, 403));
    await run('sec', 'filings', '-i', 'AAPL');
    expect(plain(err)).toContain('This route needs the STANDARD plan');
  });

  it('a partial page prints the readiness note beside the table', async () => {
    stub(() => json({
      api_schema: 'secdoors.v1',
      readiness: { status: 'partial', reason: 'held_not_verified', recoverable: true },
      filings: [],
      form_facet: [],
    }));
    await run('sec', 'filings', '-i', '320193');
    expect(plain(err)).toContain('readiness: partial (held_not_verified)');
  });
});

describe('readinessNotes', () => {
  const ready = { status: 'ready', reason: null, recoverable: false };
  it('is silent for a ready, complete answer and for a non-SEC body', () => {
    expect(readinessNotes({ api_schema: 'secdoors.v1', readiness: ready, coverage: { completeness: 'complete', reasons: [] } })).toEqual([]);
    expect(readinessNotes({ readiness: { status: 'pending' } })).toEqual([]);
  });

  it('says a partial coverage is not proof of absence', () => {
    expect(readinessNotes({ api_schema: 'secdoors.v1', readiness: ready, coverage: { completeness: 'partial', reasons: ['not_held'] } }))
      .toEqual(['coverage: partial (not_held) — no hits here is not proof that nothing matches']);
  });
});

describe('legacy filings * → sec … parity (task 7 removes the left column in 1.0.0)', () => {
  const operations = loadManifest().operations;
  const find = (group: string, action: string) => {
    const found = operations.find(operation => operation.group === group && operation.action === action);
    if (!found) throw new Error(`no ${group} ${action}`);
    return found;
  };
  const params = (group: string, action: string) => find(group, action).params.map(param => param.name);

  it('filings list → sec filings: same filer (ticker or CIK), form and date filters; rows by cursor', () => {
    expect(params('filings', 'list')).toEqual(expect.arrayContaining(['identifier', 'form_type']));
    expect(params('sec', 'filings')).toEqual(expect.arrayContaining(['identifier', 'form', 'filed_from', 'filed_to', 'cursor', 'limit']));
    expect(find('sec', 'filings').pagination).toBe('top');
    expect(find('sec', 'filings').columns).toEqual(expect.arrayContaining(['accession', 'form', 'filing_date', 'report_date']));
  });

  it('filings form-types → the form_facet of sec filings', () => {
    expect(find('filings', 'form-types').path).toBe('/v1/sec-filings/available-form-types');
    expect(find('sec', 'filings').path).toBe('/v1/sec/filings');
  });

  it('filings sections → sec document (pins the version) → sec sections → sec version --blocks', () => {
    expect(params('sec', 'document')).toEqual(expect.arrayContaining(['accession', 'filename', 'blocks']));
    expect(params('sec', 'sections')).toEqual(expect.arrayContaining(['version_id', 'outline']));
    expect(find('sec', 'sections').columns).toContain('legacy_section_key');
    expect(params('sec', 'version')).toEqual(expect.arrayContaining(['version_id', 'blocks']));
  });

  it('filings search → sec search: cited passages, explicit lexical | literal, no prose answer', () => {
    const mode = find('sec', 'search').params.find(param => param.name === 'mode');
    expect(mode?.enum).toEqual(['lexical', 'literal']);
    expect(find('sec', 'search').allItemsPath).toEqual(['hits']);
    expect(params('filings', 'search')).toContain('request');
  });

  it('the export file stays a hand-written download (spec x-cli.exclude), never a manifest operation', () => {
    expect(operations.some(operation => operation.path === '/v1/sec/exports/{export_id}/file')).toBe(false);
  });
});

describe('no client-side SEC or LLM source', () => {
  const files = (root: string): string[] => readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

  it('no source file requests sec.gov or an LLM provider', () => {
    const offenders = files(resolve(__dirname, '../../../src'))
      .filter(path => /sec\.gov|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
