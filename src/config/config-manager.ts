import Conf from 'conf';

interface ConfigSchema {
  baseUrl: string;
  apiKey?: string;
}

/** The Data API dashboard in the Invinite app (keys, usage, plan) — the APP origin, never the API's. */
export const DASHBOARD_URL = 'https://invinite.com/data-api';

/** The Data API's public origin (REST, `/v1/ws`, MCP). */
export const DEFAULT_BASE_URL = 'https://api.data.invinite.com';

/**
 * Retired API origins. `conf` WRITES its defaults into the config file, so every install that ran an older version
 * holds one of these as if the person had chosen it; `getBaseUrl()` rewrites it once. A host the person set
 * themselves (`invd config set-url`) is never touched.
 */
export const LEGACY_BASE_URLS: readonly string[] = ['https://data.invinite.com'];

const config = new Conf<ConfigSchema>({
  projectName: 'invinite-data-cli',
  // The test suite points this at a temp dir: its `resetConfig()` would otherwise clear the person's real config.
  cwd: process.env.INVD_CONFIG_DIR || undefined,
  schema: {
    baseUrl: {
      type: 'string',
      default: DEFAULT_BASE_URL,
    },
    apiKey: {
      type: 'string',
      default: '',
    },
  },
});

export function getBaseUrl(): string {
  const stored = config.get('baseUrl');
  if (!LEGACY_BASE_URLS.includes(stored.replace(/\/+$/, ''))) return stored;
  config.set('baseUrl', DEFAULT_BASE_URL);
  // stderr: `getBaseUrl()` runs inside `--json` commands, whose stdout is machine output.
  console.error(`Updated API host to ${DEFAULT_BASE_URL}`);
  return DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  config.set('baseUrl', url);
}

export function getStoredApiKey(): string | undefined {
  const key = config.get('apiKey');
  return key || undefined;
}

export function setStoredApiKey(key: string): void {
  config.set('apiKey', key);
}

export function deleteStoredApiKey(): void {
  config.delete('apiKey');
}

export function resetConfig(): void {
  config.clear();
}

export function showConfig(): Record<string, unknown> {
  return {
    baseUrl: getBaseUrl(),
    apiKeySet: !!getStoredApiKey(),
  };
}
