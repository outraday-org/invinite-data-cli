import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { clearApiKey, resolveApiKey, setApiKey, type ResolvedApiKey } from '../config/auth.js';
import { DASHBOARD_URL, getBaseUrl } from '../config/config-manager.js';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BIND_ATTEMPTS = 3;

type ExchangeData = {
  key: string;
  keyHint: string;
  label: string;
};

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export type LoginDependencies = {
  fetch: typeof fetch;
  openBrowser: (url: string) => Promise<void>;
  timeoutMs: number;
};

const defaultDependencies: LoginDependencies = {
  fetch: globalThis.fetch,
  openBrowser,
  timeoutMs: CALLBACK_TIMEOUT_MS,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | undefined> {
  try {
    return await response.json() as ApiEnvelope<T>;
  } catch {
    return undefined;
  }
}

function browserCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

async function openBrowser(url: string): Promise<void> {
  const target = browserCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target.command, target.args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function callbackHtml(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function listenOnRandomPort(server: Server): Promise<number> {
  for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt += 1) {
    const port = 49_152 + randomBytes(2).readUInt16BE(0) % (65_535 - 49_152 + 1);
    try {
      await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => reject(error);
        server.once('error', handleError);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', handleError);
          resolve();
        });
      });
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === MAX_BIND_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error('Could not start the login callback server');
}

export async function login(dependencies: LoginDependencies = defaultDependencies): Promise<ExchangeData> {
  const state = randomBytes(16).toString('hex');
  let resolveCallback: (value: ExchangeData) => void = () => undefined;
  let rejectCallback: (reason: Error) => void = () => undefined;
  const callback = new Promise<ExchangeData>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  let settled = false;
  const settleError = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectCallback(error);
  };
  const settleSuccess = (data: ExchangeData): void => {
    if (settled) return;
    settled = true;
    resolveCallback(data);
  };
  const baseUrl = getBaseUrl().replace(/\/$/u, '');
  const server = createServer(async (request, response) => {
    const callbackUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || callbackUrl.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    if (callbackUrl.searchParams.get('state') !== state) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackHtml('Login failed', 'State verification failed. Return to the terminal and try again.'));
      settleError(new Error('Login state verification failed'));
      return;
    }
    const code = callbackUrl.searchParams.get('code');
    if (!code) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackHtml('Login failed', 'The callback did not include an exchange code.'));
      settleError(new Error('Login callback did not include an exchange code'));
      return;
    }
    try {
      const exchangeResponse = await dependencies.fetch(`${baseUrl}/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const envelope = await parseEnvelope<ExchangeData>(exchangeResponse);
      if (!exchangeResponse.ok || !envelope?.ok) {
        if (exchangeResponse.status === 401) throw new Error('Login expired, run `invd login` again');
        throw new Error(envelope && !envelope.ok ? envelope.error : `Login exchange failed (${exchangeResponse.status})`);
      }
      await setApiKey(envelope.data.key);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      });
      response.end(callbackHtml('Login complete', 'You can close this tab and return to the terminal.'));
      settleSuccess(envelope.data);
    } catch (error) {
      const exchangeError = error instanceof Error ? error : new Error(String(error));
      response.writeHead(502, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      });
      response.end(callbackHtml('Login failed', 'The credential exchange failed. Return to the terminal and try again.'));
      settleError(exchangeError);
    }
  });

  const port = await listenOnRandomPort(server);
  const loginUrl = new URL(`${baseUrl}/auth/login`);
  loginUrl.searchParams.set('port', String(port));
  loginUrl.searchParams.set('state', state);
  loginUrl.searchParams.set('hostname', hostname().slice(0, 64));

  const handleInterrupt = (): void => settleError(new Error('Login cancelled'));
  process.once('SIGINT', handleInterrupt);
  const timeout = setTimeout(() => settleError(new Error('Login timed out. Run `invd login` again.')), dependencies.timeoutMs);

  try {
    const preflight = await dependencies.fetch(loginUrl, { redirect: 'manual' });
    if (preflight.status === 503) {
      throw new Error('OAuth login is not enabled on this deployment. Use `invd config set-key` instead.');
    }
    if (preflight.status < 300 || preflight.status >= 400) {
      const envelope = await parseEnvelope<never>(preflight);
      throw new Error(envelope && !envelope.ok ? envelope.error : `Could not start login (${preflight.status})`);
    }
    try {
      await dependencies.openBrowser(loginUrl.toString());
      console.log(chalk.dim('Opening your browser to complete login...'));
    } catch {
      console.warn(chalk.yellow('Could not open a browser automatically. Open this URL:'));
      console.log(loginUrl.toString());
    }
    const data = await callback;
    const approximateExpiry = new Date(Date.now() + KEY_LIFETIME_MS).toLocaleDateString();
    console.log(chalk.green('Logged in successfully.'));
    console.log(`  Key hint:   ${data.keyHint}`);
    console.log(`  Label:      ${data.label}`);
    console.log(`  Expires:    approximately ${approximateExpiry} (90 days)`);
    console.log(chalk.dim(`This sign-in is also listed on your keys page: ${DASHBOARD_URL}/keys`));
    console.log(`Manage keys and usage: ${DASHBOARD_URL}`);
    return data;
  } finally {
    clearTimeout(timeout);
    process.off('SIGINT', handleInterrupt);
    await closeServer(server);
  }
}

export async function logout(dependencies: Pick<LoginDependencies, 'fetch'> = defaultDependencies): Promise<void> {
  let resolved: ResolvedApiKey;
  try {
    resolved = await resolveApiKey();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No API key configured.')) {
      console.log('Not logged in.');
      return;
    }
    throw error;
  }

  const baseUrl = getBaseUrl().replace(/\/$/u, '');
  try {
    const response = await dependencies.fetch(`${baseUrl}/auth/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resolved.key}` },
    });
    if (!response.ok) {
      const envelope = await parseEnvelope<never>(response);
      console.warn(chalk.yellow(`Warning: remote revocation failed: ${envelope && !envelope.ok ? envelope.error : response.status}`));
    }
  } catch (error) {
    console.warn(chalk.yellow(`Warning: remote revocation failed: ${errorMessage(error)}`));
  }

  if (resolved.source === 'environment') {
    console.log('The active key comes from INVINITE_DATA_API_KEY. Remove that environment variable to finish logging out.');
    return;
  }
  if (resolved.source === 'dotenv') {
    console.log('The active key comes from the current directory\'s .env file. Remove INVINITE_DATA_API_KEY from that file to finish logging out.');
    return;
  }

  await clearApiKey();
  console.log(chalk.green('Logged out locally.'));
}

export function registerLoginCommands(program: Command): void {
  program
    .command('login')
    .description('Log in through your browser (the key belongs to your Invinite Data account)')
    .action(async () => {
      try {
        await login();
      } catch (error) {
        console.error(chalk.red(errorMessage(error)));
        process.exitCode = 1;
      }
    });

  program
    .command('logout')
    .description('Revoke the current login and clear local credentials')
    .action(async () => {
      try {
        await logout();
      } catch (error) {
        console.error(chalk.red(errorMessage(error)));
        process.exitCode = 1;
      }
    });
}
