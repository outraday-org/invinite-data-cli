import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
}

async function tryKeytar(): Promise<KeytarLike | null> {
  try {
    // Dynamic import - keytar is optional
    const mod = await (Function('return import("keytar")')() as Promise<unknown>);
    return mod as KeytarLike;
  } catch {
    return null;
  }
}

function readDotEnvKey(): string | undefined {
  try {
    const content = readFileSync(join(process.cwd(), '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;
      const match = trimmed.match(/^INVINITE_DATA_API_KEY\s*=\s*(.+)$/);
      if (match) {
        let value = match[1].trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
  } catch {
    // .env file not found or unreadable — that's fine
  }
  return undefined;
}

const SERVICE = 'invinite-data-cli';
const ACCOUNT = 'api-key';

export async function resolveApiKey(): Promise<ResolvedApiKey> {
  // 1. Environment variable (highest priority)
  const envKey = process.env.INVINITE_DATA_API_KEY;
  if (envKey) return { key: envKey, source: 'environment' };

  // 2. .env file in current working directory
  const dotEnvKey = readDotEnvKey();
  if (dotEnvKey) return { key: dotEnvKey, source: 'dotenv' };

  // 3. OS keychain via keytar
  const keytar = await tryKeytar();
  if (keytar) {
    const keychainKey = await keytar.getPassword(SERVICE, ACCOUNT);
    if (keychainKey) return { key: keychainKey, source: 'keychain' };
  }

  // 4. Conf fallback
  const storedKey = getStoredApiKey();
  if (storedKey) return { key: storedKey, source: 'config' };

  throw new Error('No API key configured. Run: invd login');
}

export async function getApiKey(): Promise<string> {
  const resolved = await resolveApiKey();
  return resolved.key;
}

export async function setApiKey(key: string): Promise<void> {
  const keytar = await tryKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE, ACCOUNT, key);
  } else {
    setStoredApiKey(key);
  }
}

export async function clearApiKey(): Promise<void> {
  const keytar = await tryKeytar();
  try {
    if (keytar) {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    }
  } finally {
    deleteStoredApiKey();
  }
}
