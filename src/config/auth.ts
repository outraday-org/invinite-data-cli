import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthRequiredError } from '../shared/errors.js';
import { deleteStoredApiKey, getStoredApiKey, setStoredApiKey } from './config-manager.js';

interface KeytarLike {
  deletePassword: (service: string, account: string) => Promise<boolean>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
}

export type ApiKeySource = 'environment' | 'dotenv' | 'keychain' | 'config';

export interface ResolvedApiKey {
  key: string;
  source: ApiKeySource;
  /** The variable (environment / `.env`) or store the key came from, for `invd auth status`. */
  origin: string;
}

/**
 * The key variables, in precedence order. `INVD_API_KEY` is 4.0's name; `INVINITE_DATA_API_KEY` (3.x, the plugin,
 * the MCP agent) is still read after it.
 */
export const KEY_VARIABLES = ['INVD_API_KEY', 'INVINITE_DATA_API_KEY'] as const;

async function tryKeytar(): Promise<KeytarLike | null> {
  try {
    // keytar is optional: a dynamic import an absent package turns into `null`.
    const mod = await (Function('return import("keytar")')() as Promise<unknown>);
    return mod as KeytarLike;
  } catch {
    return null;
  }
}

/** The first key variable a `.env` file in the current directory sets. */
export function readDotEnvKey(cwd = process.cwd()): { key: string; variable: string } | undefined {
  let content: string;
  try {
    content = readFileSync(join(cwd, '.env'), 'utf-8');
  } catch {
    return undefined;
  }
  const found = new Map<string, string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;
    const match = /^(?:export\s+)?([A-Z_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match?.[1] || match[2] === undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    found.set(match[1], value);
  }
  for (const variable of KEY_VARIABLES) {
    const key = found.get(variable);
    if (key) return { key, variable };
  }
  return undefined;
}

const SERVICE = 'invinite-data-cli';
const ACCOUNT = 'api-key';

/** `INVD_API_KEY` (then `INVINITE_DATA_API_KEY`) > `./.env` > the OS keychain > the config file. */
export async function resolveApiKey(): Promise<ResolvedApiKey> {
  for (const variable of KEY_VARIABLES) {
    const key = process.env[variable];
    if (key) return { key, source: 'environment', origin: variable };
  }
  const dotEnv = readDotEnvKey();
  if (dotEnv) return { key: dotEnv.key, source: 'dotenv', origin: `.env ${dotEnv.variable}` };
  const keytar = await tryKeytar();
  if (keytar) {
    const keychainKey = await keytar.getPassword(SERVICE, ACCOUNT);
    if (keychainKey) return { key: keychainKey, source: 'keychain', origin: 'OS keychain' };
  }
  const storedKey = getStoredApiKey();
  if (storedKey) return { key: storedKey, source: 'config', origin: 'config.toml api_key' };
  throw new AuthRequiredError();
}

export async function getApiKey(): Promise<string> {
  const resolved = await resolveApiKey();
  return resolved.key;
}

/** Stores a key in the keychain, else in the global config file. Returns where it went. */
export async function setApiKey(key: string): Promise<'keychain' | 'config'> {
  const keytar = await tryKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE, ACCOUNT, key);
    return 'keychain';
  }
  setStoredApiKey(key);
  return 'config';
}

export async function clearApiKey(): Promise<void> {
  const keytar = await tryKeytar();
  try {
    if (keytar) await keytar.deletePassword(SERVICE, ACCOUNT);
  } finally {
    deleteStoredApiKey();
  }
}

/** `sk_live_…abcd`: enough to recognise a key, never enough to use it. */
export const keyHint = (key: string): string => (key.length <= 8 ? '…' : `${key.slice(0, 4)}…${key.slice(-4)}`);
