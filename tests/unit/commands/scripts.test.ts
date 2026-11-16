import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../../src/cli.js';
import { defaultScriptName, formatUpload, MAX_SOURCE_BYTES } from '../../../src/commands/scripts.js';

const json = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const SOURCE = 'import { defineIndicator } from "@invinite-org/chartlang-core";\nexport default defineIndicator({});\n';
const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'scv_1', script_id: 'scr_1', version: 1, status: 'ok', compiler_version: '1.0.0', source_sha256: 'x', source: SOURCE,
  diagnostics: [], manifest: {}, alert_ids: ['cross_up'], created_at: '2026-11-16T00:00:00Z', ...overrides,
});
const requested = (call: number) => vi.mocked(fetch).mock.calls[call] as [string, RequestInit];

describe('invd scripts upload', () => {
  let dir: string;
  let file: string;
  let stdout: string[];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.INVD_API_KEY = 'k';
    process.env.INVD_BASE_URL = 'https://api.example.com';
    dir = mkdtempSync(join(tmpdir(), 'invd-scripts-'));
    file = join(dir, 'ema-cross.chart');
    writeFileSync(file, SOURCE);
    stdout = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.INVD_API_KEY;
    delete process.env.INVD_BASE_URL;
  });

  it('creates a new script named after the file and prints the version, its status and alert ids', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'scr_1', name: 'ema-cross', description: null, version_count: 1, latest_version: version() }));
    await createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file]);
    const [url, init] = requested(0);
    expect(new URL(url).pathname).toBe('/v1/scripts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'ema-cross', source: SOURCE });
    expect(stdout.join('')).toBe('scr_1 "ema-cross" version 1 (scv_1): compiled\nalert ids: cross_up\n');
  });

  it('with --script posts the next version to that script and takes --name only for a new script', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(version({ version: 2, id: 'scv_2' })));
    await createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file, '--script', 'scr_1']);
    const [url, init] = requested(0);
    expect(new URL(url).pathname).toBe('/v1/scripts/scr_1/versions');
    expect(JSON.parse(String(init.body))).toEqual({ source: SOURCE });
    expect(stdout.join('')).toContain('scr_1 version 2 (scv_2): compiled');

    await expect(createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file, '--script', 'scr_1', '--name', 'x'])).rejects.toThrow('exit 2');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a compile error (still a 201) prints file:line:column diagnostics and exits 1', async () => {
    const diagnostics = [{ line: 4, column: 9, message: 'Cannot find name "foo"', code: 'type-error', severity: 'error' }];
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'scr_1', name: 'n', description: null, version_count: 1, latest_version: version({ status: 'error', diagnostics, alert_ids: [] }) }));
    await expect(createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file, '--name', 'n'])).rejects.toThrow('exit 1');
    expect(stdout.join('')).toBe(`scr_1 "n" version 1 (scv_1): compile error\n${file}:4:9 error Cannot find name "foo" (type-error)\n`);
  });

  it('--json prints the response body', async () => {
    const body = { id: 'scr_1', name: 'ema-cross', description: null, version_count: 1, latest_version: version() };
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file, '--json']);
    expect(JSON.parse(stdout.join(''))).toEqual(body);
  });

  it('refuses a missing, empty or oversized file before any request', async () => {
    await expect(createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', join(dir, 'nope.chart')])).rejects.toThrow('exit 1');
    writeFileSync(file, '  \n');
    await expect(createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file])).rejects.toThrow('exit 2');
    writeFileSync(file, 'x'.repeat(MAX_SOURCE_BYTES + 1));
    await expect(createProgram().parseAsync(['node', 'invd', 'scripts', 'upload', file])).rejects.toThrow('exit 2');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is registered under the generated scripts group', () => {
    const group = createProgram().commands.find(command => command.name() === 'scripts');
    expect(group?.commands.map(command => command.name()).sort()).toEqual(['create', 'delete', 'get', 'list', 'upload']);
  });

  it('names a script after its file and formats a warning on an ok version', () => {
    expect(defaultScriptName('strategies/ema-cross.chart')).toBe('ema-cross');
    expect(defaultScriptName('rsi')).toBe('rsi');
    expect(formatUpload({ version: { id: 'scv_3', script_id: 'scr_1', version: 3, status: 'ok', alert_ids: [], diagnostics: [{ line: 1, column: 2, message: 'unused', code: '', severity: 'warning' }] }, body: {} }, 'a.chart'))
      .toEqual(['scr_1 version 3 (scv_3): compiled', 'a.chart:1:2 warning unused']);
  });
});
