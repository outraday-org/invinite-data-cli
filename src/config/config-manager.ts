import Conf from 'conf';

interface ConfigSchema {
  baseUrl: string;
  apiKey?: string;
}

/** The Data API dashboard in the Invinite app (keys, usage, plan) — the APP origin, never the API's. */
export const DASHBOARD_URL = 'https://invinite.com/data-api';

const config = new Conf<ConfigSchema>({
  projectName: 'invinite-data-cli',
  schema: {
    baseUrl: {
      type: 'string',
      default: 'https://data.invinite.com',
    },
    apiKey: {
      type: 'string',
      default: '',
    },
  },
});

export function getBaseUrl(): string {
  return config.get('baseUrl');
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
