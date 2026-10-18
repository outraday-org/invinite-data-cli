import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClearApiKey, mockResolveApiKey, mockSetApiKey } = vi.hoisted(() => ({
  mockClearApiKey: vi.fn(),
  mockResolveApiKey: vi.fn(),
  mockSetApiKey: vi.fn(),
}));

vi.mock('../../../src/config/auth.js', () => ({
  clearApiKey: mockClearApiKey,
  resolveApiKey: mockResolveApiKey,
  setApiKey: mockSetApiKey,
}));

// Never the real `conf` file: test files run in parallel workers, and a base URL written here leaked into
// config-manager.test.ts's default-URL assertion.
vi.mock('../../../src/config/config-manager.js', () => ({
  getBaseUrl: () => 'https://data.example.test',
  DASHBOARD_URL: 'https://app.example.test/data-api',
}));

import { login, logout, type LoginDependencies } from '../../../src/commands/login.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function loginDependencies(
  exchangeResponse: Response,
  callbackQuery: (loginUrl: URL) => string = (loginUrl) => `code=exchange-code&state=${loginUrl.searchParams.get('state')}`,
): { dependencies: LoginDependencies; fetchMock: ReturnType<typeof vi.fn>; opened: URL[] } {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://clerk.test/oauth/authorize' } }))
    .mockResolvedValueOnce(exchangeResponse);
  const opened: URL[] = [];
  const dependencies: LoginDependencies = {
    fetch: fetchMock,
    timeoutMs: 2_000,
    openBrowser: async (url) => {
      const loginUrl = new URL(url);
      opened.push(loginUrl);
      setTimeout(() => {
        void globalThis.fetch(`http://127.0.0.1:${loginUrl.searchParams.get('port')}/callback?${callbackQuery(loginUrl)}`);
      }, 0);
    },
  };
  return { dependencies, fetchMock, opened };
}

describe('login commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetApiKey.mockResolvedValue(undefined);
    mockClearApiKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips state, exchanges the callback code (no team), and stores the key', async () => {
    const exchange = {
      key: `invd_${'a'.repeat(64)}`,
      keyHint: 'aaaa',
      label: 'CLI login (test-host)',
    };
    const { dependencies, fetchMock, opened } = loginDependencies(jsonResponse({ ok: true, data: exchange }));

    await expect(login(dependencies)).resolves.toEqual(exchange);

    expect(opened[0].searchParams.has('team')).toBe(false);
    expect(opened[0].searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/);
    expect(Number(opened[0].searchParams.get('port'))).toBeGreaterThanOrEqual(49_152);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://data.example.test/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'exchange-code' }),
    });
    expect(mockSetApiKey).toHaveBeenCalledWith(exchange.key);
  });

  it('rejects a callback whose state does not match', async () => {
    const { dependencies } = loginDependencies(
      jsonResponse({ ok: true, data: {} }),
      () => 'code=exchange-code&state=wrong-state',
    );

    await expect(login(dependencies)).rejects.toThrow('Login state verification failed');
    expect(mockSetApiKey).not.toHaveBeenCalled();
  });

  it('turns an exchange 401 into an actionable expired-login error', async () => {
    const { dependencies } = loginDependencies(jsonResponse({ ok: false, error: 'Invalid or expired exchange code' }, 401));

    await expect(login(dependencies)).rejects.toThrow('Login expired, run `invd login` again');
    expect(mockSetApiKey).not.toHaveBeenCalled();
  });

  it('shows a browser failure instead of success when the exchange fails', async () => {
    let resolveBrowserBody: (body: string) => void = () => undefined;
    const browserBody = new Promise<string>((resolve) => {
      resolveBrowserBody = resolve;
    });
    const { dependencies } = loginDependencies(jsonResponse({ ok: false, error: 'Exchange unavailable' }, 503));

    dependencies.openBrowser = async (url) => {
      const loginUrl = new URL(url);
      const callbackUrl = `http://127.0.0.1:${loginUrl.searchParams.get('port')}/callback?code=exchange-code&state=${loginUrl.searchParams.get('state')}`;
      setTimeout(() => {
        void globalThis.fetch(callbackUrl).then(async (callbackResponse) => {
          resolveBrowserBody(await callbackResponse.text());
        });
      }, 0);
    };

    await expect(login(dependencies)).rejects.toThrow('Exchange unavailable');
    await expect(browserBody).resolves.toContain('Login failed');
    await expect(browserBody).resolves.not.toContain('Login complete');
  });

  it('explains when OAuth login is disabled on the deployment', async () => {
    const dependencies: LoginDependencies = {
      fetch: vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'CLI OAuth is not configured' }, 503)),
      openBrowser: vi.fn(),
      timeoutMs: 2_000,
    };

    await expect(login(dependencies)).rejects.toThrow(
      'OAuth login is not enabled on this deployment. Use `invd config set-key` instead.',
    );
    expect(dependencies.openBrowser).not.toHaveBeenCalled();
  });

  it('revokes the stored key and clears local storage', async () => {
    const key = `invd_${'b'.repeat(64)}`;
    mockResolveApiKey.mockResolvedValue({ key, source: 'keychain' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await logout({ fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledWith('https://data.example.test/auth/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(mockClearApiKey).toHaveBeenCalledOnce();
  });

  it('clears local storage even when remote revocation fails', async () => {
    mockResolveApiKey.mockResolvedValue({ key: `invd_${'c'.repeat(64)}`, source: 'config' });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));

    await logout({ fetch: fetchMock });

    expect(mockClearApiKey).toHaveBeenCalledOnce();
  });

  it('instructs users to remove an environment key without clearing storage', async () => {
    mockResolveApiKey.mockResolvedValue({ key: `invd_${'d'.repeat(64)}`, source: 'environment' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await logout({ fetch: fetchMock });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('INVINITE_DATA_API_KEY'));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockClearApiKey).not.toHaveBeenCalled();
  });
});
