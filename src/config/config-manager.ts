import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseToml, stringifyToml, type TomlValue } from './toml.js';

/** The Invinite Data app (keys, usage, plan, docs) — the APP origin, never the API's. */
export const DASHBOARD_URL = 'https://data.invinite.com';

/** The Data API's public origin (REST, MCP). */
export const DEFAULT_BASE_URL = 'https://api.data.invinite.com';

/**
 * Retired API origins: an install that persisted one (3.x wrote its defaults into its config file) is moved to
 * `DEFAULT_BASE_URL` once by `getBaseUrl()`. A host the person set themselves is never touched.
 */
export const LEGACY_BASE_URLS: readonly string[] = ['https://data.invinite.com'];

/**
 * The settings `invd config` knows, each with its environment variable. Precedence: flags > env > `./.invd.toml`
 * > `$XDG_CONFIG_HOME/invd/config.toml` (`INVD_CONFIG_DIR` replaces the directory) > the default.
 */
export const SETTINGS = {
  base_url: { env: 'INVD_BASE_URL', default: DEFAULT_BASE_URL, description: 'API origin' },
  output: { env: 'INVD_OUTPUT', default: '', description: 'default output: table, plain, json, jsonl, csv' },
  confirm_credits: {
    env: 'INVD_CONFIRM_CREDITS',
    default: '10',
    description: '--all asks first when one page costs at least this many credits',
  },
  pager: { env: 'INVD_PAGER', default: '', description: 'pager for long human output (else $PAGER; empty = none)' },
  api_key: { env: 'INVD_API_KEY', default: '', description: 'API key fallback when no keychain is available (global file only)' },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingSource = 'env' | 'local' | 'global' | 'default';

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);

/** `$INVD_CONFIG_DIR`, else `$XDG_CONFIG_HOME/invd`, else `~/.config/invd` (`%APPDATA%\invd` on Windows). */
export function configDir(): string {
  if (process.env.INVD_CONFIG_DIR) return process.env.INVD_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'invd');
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'invd');
  return join(homedir(), '.config', 'invd');
}

export const globalConfigPath = (): string => join(configDir(), 'config.toml');
export const localConfigPath = (): string => join(process.cwd(), '.invd.toml');

/** Where 3.x's `conf` package kept its JSON (`invinite-data-cli-nodejs`), per platform. */
export function legacyConfPaths(): string[] {
  if (process.env.INVD_CONFIG_DIR) return [join(process.env.INVD_CONFIG_DIR, 'config.json')];
  const home = homedir();
  if (process.platform === 'darwin') return [join(home, 'Library/Preferences/invinite-data-cli-nodejs/config.json')];
  if (process.platform === 'win32') {
    return [join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'invinite-data-cli-nodejs/Config/config.json')];
  }
  return [join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'invinite-data-cli-nodejs/config.json')];
}

function readFile(path: string): Record<string, TomlValue> {
  if (!existsSync(path)) return {};
  try {
    return parseToml(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeFile(path: string, values: Record<string, TomlValue>): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, stringifyToml(values, 'invd configuration (invd config set <key> <value>)'), { mode: 0o600 });
  try {
    chmodSync(path, 0o600); // the file may hold api_key
  } catch {
    // a filesystem without modes
  }
}

let imported = false;

/**
 * The 3.x settings (base URL, the config-stored key) carried into `config.toml` once, the first time 4.x reads a
 * config while no `config.toml` exists. The old file is left in place (3.x may still be installed elsewhere).
 */
function importLegacyOnce(): void {
  if (imported) return;
  imported = true;
  const target = globalConfigPath();
  if (existsSync(target)) return;
  for (const path of legacyConfPaths()) {
    if (!existsSync(path)) continue;
    try {
      const legacy = JSON.parse(readFileSync(path, 'utf8')) as { baseUrl?: unknown; apiKey?: unknown };
      const values: Record<string, TomlValue> = {};
      if (typeof legacy.baseUrl === 'string' && legacy.baseUrl && legacy.baseUrl !== DEFAULT_BASE_URL
        && !LEGACY_BASE_URLS.includes(legacy.baseUrl.replace(/\/+$/, ''))) values.base_url = legacy.baseUrl;
      if (typeof legacy.apiKey === 'string' && legacy.apiKey) values.api_key = legacy.apiKey;
      if (Object.keys(values).length > 0) writeFile(target, values);
    } catch {
      // unreadable: nothing to carry over
    }
    return;
  }
}

const globalValues = () => {
  importLegacyOnce();
  return readFile(globalConfigPath());
};

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** `http://localhost:4000`, `http://127.0.0.1:…`, `http://[::1]:…`: a host on this machine. */
export function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * A project file (`./.invd.toml`, e.g. in a cloned repository) never decides where the key goes: its `base_url` may
 * only name a loopback host (local development); any other host is refused, not followed.
 */
function checkProjectBaseUrl(value: string, path: string): void {
  if (isLoopbackUrl(value)) return;
  throw new Error(`${path}: base_url ${value} refused — a project file may only point invd at localhost (it would `
    + 'receive your API key); set INVD_BASE_URL or `invd config set base_url` (global) instead');
}

/**
 * One setting's effective value and where it came from. `api_key` is never read from a project file, and a project
 * file's `base_url` only for a loopback host.
 */
export function getSetting(key: SettingKey): { value: string; source: SettingSource } {
  const env = process.env[SETTINGS[key].env];
  if (env) return { value: env, source: 'env' };
  if (key !== 'api_key') {
    const local = readFile(localConfigPath())[key];
    if (key === 'base_url' && local !== undefined) checkProjectBaseUrl(String(local), localConfigPath());
    if (local !== undefined) return { value: String(local), source: 'local' };
  }
  const global = globalValues()[key];
  if (global !== undefined) return { value: String(global), source: 'global' };
  return { value: SETTINGS[key].default, source: 'default' };
}

export function setSetting(key: SettingKey, value: string, scope: 'global' | 'local' = 'global'): string {
  if (key === 'api_key' && scope === 'local') {
    throw new Error('api_key is never written to a project file (use invd auth login, or INVD_API_KEY)');
  }
  if (key === 'base_url' && scope === 'local') checkProjectBaseUrl(value, localConfigPath());
  const path = scope === 'local' ? localConfigPath() : globalConfigPath();
  const values = scope === 'local' ? readFile(path) : globalValues();
  writeFile(path, { ...values, [key]: key === 'confirm_credits' ? Number(value) : value });
  return path;
}

export function unsetSetting(key: SettingKey, scope: 'global' | 'local' = 'global'): string {
  const path = scope === 'local' ? localConfigPath() : globalConfigPath();
  const values = scope === 'local' ? readFile(path) : globalValues();
  delete values[key];
  writeFile(path, values);
  return path;
}

export function getBaseUrl(): string {
  const { value, source } = getSetting('base_url');
  if (source !== 'global' || !LEGACY_BASE_URLS.includes(value.replace(/\/+$/, ''))) return value;
  unsetSetting('base_url');
  // stderr: `getBaseUrl()` runs inside `--json` commands, whose stdout is machine output.
  console.error(`Updated API host to ${DEFAULT_BASE_URL}`);
  return DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  setSetting('base_url', url);
}

export function getStoredApiKey(): string | undefined {
  const key = globalValues().api_key;
  return typeof key === 'string' && key ? key : undefined;
}

export function setStoredApiKey(key: string): void {
  setSetting('api_key', key);
}

export function deleteStoredApiKey(): void {
  if (existsSync(globalConfigPath())) unsetSetting('api_key');
}

/** Removes the global config file (the keychain entry is `invd auth logout`'s). */
export function resetConfig(): void {
  rmSync(globalConfigPath(), { force: true });
  imported = true;
}

export function showConfig(): Record<string, unknown> {
  return {
    baseUrl: getBaseUrl(),
    apiKeySet: !!getStoredApiKey(),
  };
}
