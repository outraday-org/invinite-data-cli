import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseToml, stringifyToml } from '../../../src/config/toml.js';

/**
 * `os.homedir()` is mocked for this whole file: it does not follow $HOME on every platform, and a test that reached
 * the real home once overwrote a person's config. Every test starts on a fresh temporary home.
 */
const home = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, default: { ...os, homedir: () => home.dir }, homedir: () => home.dir };
});

describe('flat TOML', () => {
  it('reads strings, numbers, booleans and comments; writes them back sorted', () => {
    const text = '# invd\nbase_url = "http://localhost:4000" # local\nconfirm_credits = 20\noutput=\'json\'\nflag = true\nquote = "a \\"b\\" \\\\ c"\n';
    const values = parseToml(text);
    expect(values).toEqual({ base_url: 'http://localhost:4000', confirm_credits: 20, output: 'json', flag: true, quote: 'a "b" \\ c' });
    expect(parseToml(stringifyToml(values, 'header'))).toEqual(values);
  });

  it('refuses tables and anything it cannot read, by line', () => {
    expect(() => parseToml('[section]')).toThrow('line 1: tables are not supported');
    expect(() => parseToml('a = [1, 2]')).toThrow('line 1: unsupported value');
    expect(() => parseToml('just text')).toThrow('expected key = value');
  });

  it('a quote of the other kind inside a string does not end it (no comment stripped there)', () => {
    expect(parseToml(`a = "it's # not a comment" # comment\nb = 'say "#1"'\n`)).toEqual({ a: "it's # not a comment", b: 'say "#1"' });
  });
});

describe('config-manager', () => {
  let dir: string;
  let cwd: string;
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    home.dir = mkdtempSync(join(tmpdir(), 'invd-home-'));
    dir = mkdtempSync(join(tmpdir(), 'invd-cfg-'));
    cwd = mkdtempSync(join(tmpdir(), 'invd-cwd-'));
    process.env.INVD_CONFIG_DIR = dir;
    for (const key of ['INVD_BASE_URL', 'INVD_OUTPUT', 'INVD_CONFIRM_CREDITS', 'INVD_PAGER', 'INVD_API_KEY', 'XDG_CONFIG_HOME']) delete process.env[key];
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  const load = () => import('../../../src/config/config-manager.js');

  it('defaults, then global < local < env; api_key never from a project file', async () => {
    const config = await load();
    expect(config.getBaseUrl()).toBe('https://api.data.invinite.com');
    expect(config.getSetting('output')).toEqual({ value: '', source: 'default' });
    config.setSetting('output', 'csv');
    expect(config.getSetting('output')).toEqual({ value: 'csv', source: 'global' });
    writeFileSync(join(cwd, '.invd.toml'), 'output = "json"\napi_key = "project-key"\n');
    expect(config.getSetting('output')).toEqual({ value: 'json', source: 'local' });
    expect(config.getStoredApiKey()).toBeUndefined();
    process.env.INVD_OUTPUT = 'jsonl';
    expect(config.getSetting('output')).toEqual({ value: 'jsonl', source: 'env' });
    expect(() => config.setSetting('api_key', 'x', 'local')).toThrow('never written to a project file');
  });

  it('a project file points base_url only at a loopback host (it would receive the key)', async () => {
    const config = await load();
    writeFileSync(join(cwd, '.invd.toml'), 'base_url = "http://localhost:4000"\n');
    expect(config.getBaseUrl()).toBe('http://localhost:4000');
    writeFileSync(join(cwd, '.invd.toml'), 'base_url = "https://collector.example"\n');
    expect(() => config.getBaseUrl()).toThrow('a project file may only point invd at localhost');
    expect(() => config.setSetting('base_url', 'https://collector.example', 'local')).toThrow('refused');
    process.env.INVD_BASE_URL = 'https://staging.example';
    expect(config.getBaseUrl()).toBe('https://staging.example');
  });

  it('writes $INVD_CONFIG_DIR/invd.toml with mode 0600 and keeps a stored key there', async () => {
    const config = await load();
    config.setStoredApiKey('sk-test');
    const path = join(dir, 'invd.toml');
    expect(readFileSync(path, 'utf8')).toContain('api_key = "sk-test"');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(config.getStoredApiKey()).toBe('sk-test');
    config.deleteStoredApiKey();
    expect(config.getStoredApiKey()).toBeUndefined();
  });

  it('XDG_CONFIG_HOME/invinite/invd.toml without INVD_CONFIG_DIR', async () => {
    delete process.env.INVD_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test';
    const config = await load();
    expect(config.globalConfigPath()).toBe('/tmp/xdg-test/invinite/invd.toml');
  });

  /** The (mocked, temporary) home directory with neither INVD_CONFIG_DIR nor XDG_CONFIG_HOME. */
  const freshHome = (): string => {
    delete process.env.INVD_CONFIG_DIR;
    return home.dir;
  };

  it.skipIf(process.platform === 'win32')('fresh home: invd config set writes ~/.config/invinite/invd.toml (0600), nothing else', async () => {
    const homeDir = freshHome();
    const config = await load();
    config.setSetting('output', 'json');
    const path = join(homeDir, '.config', 'invinite', 'invd.toml');
    expect(config.globalConfigPath()).toBe(path);
    expect(readFileSync(path, 'utf8')).toContain('output = "json"');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(join(homeDir, '.config', 'invd'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('carries the 5.x ~/.config/invd/config.toml over once: old file untouched, one stderr line', async () => {
    const homeDir = freshHome();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const old = join(homeDir, '.config', 'invd', 'config.toml');
    mkdirSync(join(homeDir, '.config', 'invd'), { recursive: true });
    const oldText = 'output = "csv"\napi_key = "invd_old"\n';
    writeFileSync(old, oldText);
    const config = await load();
    expect(config.getSetting('output')).toEqual({ value: 'csv', source: 'global' });
    expect(config.getStoredApiKey()).toBe('invd_old');
    const target = join(homeDir, '.config', 'invinite', 'invd.toml');
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readFileSync(old, 'utf8')).toBe(oldText);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toBe(`Carried invd settings over from ${old} to ${target} (the old file is left in place)`);
    // Once: a later change to the old file is not carried again (invd.toml exists now).
    writeFileSync(old, 'output = "plain"\n');
    vi.resetModules();
    expect((await load()).getSetting('output').value).toBe('csv');
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('under INVD_CONFIG_DIR the 5.x config.toml in that directory is carried over', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeFileSync(join(dir, 'config.toml'), 'base_url = "http://localhost:4000"\n');
    const config = await load();
    expect(config.getBaseUrl()).toBe('http://localhost:4000');
    expect(readFileSync(join(dir, 'invd.toml'), 'utf8')).toContain('base_url = "http://localhost:4000"');
  });

  it.skipIf(process.platform === 'win32')('imports the 3.x conf file once (base URL, stored key), skipping the retired default host', async () => {
    freshHome();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const config = await load();
    const [conf] = config.legacyConfPaths();
    mkdirSync(join(conf ?? '', '..'), { recursive: true });
    writeFileSync(conf ?? '', JSON.stringify({ baseUrl: 'http://localhost:4000', apiKey: 'old-key' }));
    expect(config.getBaseUrl()).toBe('http://localhost:4000');
    expect(config.getStoredApiKey()).toBe('old-key');
  });

  it('never reads, writes or deletes the Web CLI config.json beside invd.toml', async () => {
    const shared = join(dir, 'config.json');
    const webCli = '{"token":"invw_x","baseUrl":"https://evil.example"}\n';
    writeFileSync(shared, webCli);
    const stdout: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { stdout.push(String(line ?? '')); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createProgram } = await import('../../../src/cli.js');
    const config = await load();
    const run = (...args: string[]) => createProgram().parseAsync(['node', 'invd', 'config', ...args]);
    await run('set', 'output', 'json');
    expect(stdout).toEqual([]);
    await run('get', 'output');
    expect(stdout).toEqual(['json']);
    await run('get', 'base_url');
    expect(stdout.at(-1)).toBe(config.DEFAULT_BASE_URL);
    await run('list');
    await run('list', '--json');
    await run('path');
    expect(stdout.at(-1)).toBe(join(dir, 'invd.toml'));
    await run('unset', 'output');
    expect(readFileSync(shared, 'utf8')).toBe(webCli);
    config.resetConfig();
    expect(existsSync(join(dir, 'invd.toml'))).toBe(false);
    expect(readFileSync(shared, 'utf8')).toBe(webCli);
    expect(config.getStoredApiKey()).toBeUndefined();
  });

  it('rewrites a persisted retired host once, on stderr; leaves a chosen host alone', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'invd.toml'), 'base_url = "https://data.invinite.com"\n');
    const config = await load();
    expect(config.getBaseUrl()).toBe(config.DEFAULT_BASE_URL);
    expect(config.getBaseUrl()).toBe(config.DEFAULT_BASE_URL);
    expect(stderr).toHaveBeenCalledTimes(1);
    config.setBaseUrl('http://localhost:4000');
    expect(config.getBaseUrl()).toBe('http://localhost:4000');
  });
});

describe('API key precedence', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it('INVD_API_KEY > INVINITE_DATA_API_KEY > ./.env (either name) > config', async () => {
    home.dir = mkdtempSync(join(tmpdir(), 'invd-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'invd-key-'));
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    process.env.INVD_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'invd-cfg-'));
    const { resolveApiKey, readDotEnvKey } = await import('../../../src/config/auth.js');
    process.env.INVD_API_KEY = 'a';
    process.env.INVINITE_DATA_API_KEY = 'b';
    expect(await resolveApiKey()).toEqual({ key: 'a', source: 'environment', origin: 'INVD_API_KEY' });
    delete process.env.INVD_API_KEY;
    expect(await resolveApiKey()).toMatchObject({ key: 'b', origin: 'INVINITE_DATA_API_KEY' });
    delete process.env.INVINITE_DATA_API_KEY;
    writeFileSync(join(cwd, '.env'), 'OTHER=1\nINVINITE_DATA_API_KEY="c"\nexport INVD_API_KEY=d\n');
    expect(readDotEnvKey(cwd)).toEqual({ key: 'd', variable: 'INVD_API_KEY' });
    expect(await resolveApiKey()).toMatchObject({ key: 'd', source: 'dotenv' });
  });
});
