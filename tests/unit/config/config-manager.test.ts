import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseToml, stringifyToml } from '../../../src/config/toml.js';

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
    dir = mkdtempSync(join(tmpdir(), 'invd-cfg-'));
    cwd = mkdtempSync(join(tmpdir(), 'invd-cwd-'));
    process.env.INVD_CONFIG_DIR = dir;
    for (const key of ['INVD_BASE_URL', 'INVD_OUTPUT', 'INVD_CONFIRM_CREDITS', 'INVD_PAGER', 'INVD_API_KEY']) delete process.env[key];
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

  it('writes $INVD_CONFIG_DIR/config.toml with mode 0600 and keeps a stored key there', async () => {
    const config = await load();
    config.setStoredApiKey('sk-test');
    const path = join(dir, 'config.toml');
    expect(readFileSync(path, 'utf8')).toContain('api_key = "sk-test"');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(config.getStoredApiKey()).toBe('sk-test');
    config.deleteStoredApiKey();
    expect(config.getStoredApiKey()).toBeUndefined();
  });

  it('XDG_CONFIG_HOME/invd without INVD_CONFIG_DIR', async () => {
    delete process.env.INVD_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test';
    const config = await load();
    expect(config.globalConfigPath()).toBe('/tmp/xdg-test/invd/config.toml');
  });

  it('imports the 3.x conf file once (base URL, stored key), skipping the retired default host', async () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ baseUrl: 'http://localhost:4000', apiKey: 'old-key' }));
    const config = await load();
    expect(config.getBaseUrl()).toBe('http://localhost:4000');
    expect(config.getStoredApiKey()).toBe('old-key');
  });

  it('rewrites a persisted retired host once, on stderr; leaves a chosen host alone', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.toml'), 'base_url = "https://data.invinite.com"\n');
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
