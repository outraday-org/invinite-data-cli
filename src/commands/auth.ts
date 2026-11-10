import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { apiCall } from '../client/api-client.js';
import { clearApiKey, keyHint, resolveApiKey, setApiKey, type ResolvedApiKey } from '../config/auth.js';
import { DASHBOARD_URL, getBaseUrl } from '../config/config-manager.js';
import { AuthRequiredError, UsageError, withErrorHandling } from '../shared/errors.js';
import { readStdin } from '../shared/prompt.js';

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
  /**
   * `--no-browser`: the redirect URL (or code) the person pastes; resolves with the pasted text. `signal` aborts the
   * read once the login settled another way (the loopback callback won), so a waiting prompt never holds the process.
   */
  readPasted?: (prompt: string, signal: AbortSignal) => Promise<string>;
};

async function readLine(prompt: string, signal: AbortSignal): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(prompt, { signal });
  } finally {
    rl.close();
  }
}

const defaultDependencies: LoginDependencies = {
  fetch: globalThis.fetch,
  openBrowser,
  timeoutMs: CALLBACK_TIMEOUT_MS,
  readPasted: readLine,
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

/** The exchange code and state of a pasted redirect URL (`http://127.0.0.1:…/callback?code=…&state=…`), or a bare code. */
export function parsePastedCallback(text: string): { code?: string; state?: string } {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    return { code: url.searchParams.get('code') ?? undefined, state: url.searchParams.get('state') ?? undefined };
  } catch {
    return trimmed ? { code: trimmed } : {};
  }
}

async function exchange(dependencies: LoginDependencies, baseUrl: string, code: string): Promise<ExchangeData> {
  const exchangeResponse = await dependencies.fetch(`${baseUrl}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const envelope = await parseEnvelope<ExchangeData>(exchangeResponse);
  if (!exchangeResponse.ok || !envelope?.ok) {
    if (exchangeResponse.status === 401) throw new Error('Login expired, run `invd auth login` again');
    throw new Error(envelope && !envelope.ok ? envelope.error : `Login exchange failed (${exchangeResponse.status})`);
  }
  await setApiKey(envelope.data.key);
  return envelope.data;
}

/**
 * Browser sign-in: a loopback callback server receives the exchange code. With `noBrowser` (SSH sessions) the URL
 * is printed instead and the person pastes the address their browser was sent to (the page itself may not load —
 * the code is in its URL); whichever arrives first wins.
 */
export async function login(
  dependencies: LoginDependencies = defaultDependencies,
  opts: { noBrowser?: boolean } = {},
): Promise<ExchangeData> {
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
      const data = await exchange(dependencies, baseUrl, code);
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackHtml('Login complete', 'You can close this tab and return to the terminal.'));
      settleSuccess(data);
    } catch (error) {
      response.writeHead(502, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackHtml('Login failed', 'The credential exchange failed. Return to the terminal and try again.'));
      settleError(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const port = await listenOnRandomPort(server);
  const loginUrl = new URL(`${baseUrl}/auth/login`);
  loginUrl.searchParams.set('port', String(port));
  loginUrl.searchParams.set('state', state);
  loginUrl.searchParams.set('hostname', hostname().slice(0, 64));

  const handleInterrupt = (): void => settleError(new Error('Login cancelled'));
  process.once('SIGINT', handleInterrupt);
  const timeout = setTimeout(() => settleError(new Error('Login timed out. Run `invd auth login` again.')), dependencies.timeoutMs);
  const pasteAbort = new AbortController();

  try {
    const preflight = await dependencies.fetch(loginUrl, { redirect: 'manual' });
    if (preflight.status === 503) {
      throw new Error('OAuth login is not enabled on this deployment. Use `invd auth login --with-token` instead.');
    }
    if (preflight.status < 300 || preflight.status >= 400) {
      const envelope = await parseEnvelope<never>(preflight);
      throw new Error(envelope && !envelope.ok ? envelope.error : `Could not start login (${preflight.status})`);
    }
    if (opts.noBrowser) {
      console.error('Open this URL in a browser on any machine and sign in:');
      console.error(loginUrl.toString());
      const read = dependencies.readPasted ?? readLine;
      void read('Then paste the address the browser was sent to (it starts with http://127.0.0.1): ', pasteAbort.signal).then(async (text) => {
        const pasted = parsePastedCallback(text);
        if (pasted.state !== undefined && pasted.state !== state) throw new Error('Login state verification failed');
        if (!pasted.code) throw new Error('The pasted text has no exchange code');
        settleSuccess(await exchange(dependencies, baseUrl, pasted.code));
      }).catch((error: unknown) => settleError(error instanceof Error ? error : new Error(String(error))));
    } else {
      try {
        await dependencies.openBrowser(loginUrl.toString());
        console.error(chalk.dim('Opening your browser to complete login...'));
      } catch {
        console.error(chalk.yellow('Could not open a browser automatically. Open this URL:'));
        console.error(loginUrl.toString());
      }
    }
    const data = await callback;
    const approximateExpiry = new Date(Date.now() + KEY_LIFETIME_MS).toLocaleDateString();
    console.log(chalk.green('Logged in successfully.'));
    console.log(`  Key hint:   ${data.keyHint}`);
    console.log(`  Label:      ${data.label}`);
    console.log(`  Expires:    approximately ${approximateExpiry} (90 days)`);
    console.log(chalk.dim(`This sign-in is also listed on your keys page: ${DASHBOARD_URL}/keys`));
    return data;
  } finally {
    clearTimeout(timeout);
    pasteAbort.abort();
    process.off('SIGINT', handleInterrupt);
    await closeServer(server);
  }
}

export async function logout(dependencies: Pick<LoginDependencies, 'fetch'> = defaultDependencies): Promise<void> {
  let resolved: ResolvedApiKey;
  try {
    resolved = await resolveApiKey();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
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
    console.log(`The active key comes from ${resolved.origin}. Remove that environment variable to finish logging out.`);
    return;
  }
  if (resolved.source === 'dotenv') {
    console.log(`The active key comes from the current directory's ${resolved.origin}. Remove it from that file to finish logging out.`);
    return;
  }

  await clearApiKey();
  console.log(chalk.green('Logged out locally.'));
}

/** `invd auth status`: where the key comes from and, unless `offline`, what `GET /v2/me` says about it (free). */
export async function status(opts: { offline?: boolean; json?: boolean } = {}): Promise<void> {
  const resolved = await resolveApiKey();
  const summary: Record<string, unknown> = {
    host: getBaseUrl(),
    key: keyHint(resolved.key),
    source: resolved.source,
    origin: resolved.origin,
  };
  if (!opts.offline) {
    const { body } = await apiCall<Record<string, unknown>>({ path: '/v2/me', silent: true });
    const account = body?.account;
    const plan = body?.plan;
    if (typeof account === 'object' && account !== null) {
      const fields = account as Record<string, unknown>;
      summary.account = fields.email ?? fields.name ?? fields.id ?? account;
    } else {
      summary.account = account;
    }
    summary.plan = typeof plan === 'object' && plan !== null ? (plan as Record<string, unknown>).name ?? plan : plan;
  }
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(chalk.green('Logged in.'));
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(8)}  ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  }
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Sign in, inspect and remove the API key invd uses');

  auth
    .command('login')
    .description('Sign in through your browser (the key belongs to your Invinite Data account)')
    .option('--no-browser', 'Print the sign-in URL and paste the redirect address back (SSH sessions)')
    .option('--with-token', 'Read an API key from stdin instead (e.g. invd auth login --with-token < key.txt)')
    .addHelpText('before', 'Examples:\n  $ invd auth login\n  $ invd auth login --no-browser\n')
    .action(withErrorHandling(async (opts: { browser?: boolean; withToken?: boolean }) => {
      if (opts.withToken) {
        const key = (await readStdin()).trim();
        if (!key) throw new UsageError('--with-token: stdin held no key');
        const where = await setApiKey(key);
        console.log(chalk.green(`API key saved (${where === 'keychain' ? 'OS keychain' : 'config.toml'}): ${keyHint(key)}`));
        return;
      }
      await login(defaultDependencies, { noBrowser: opts.browser === false });
    }));

  auth
    .command('status')
    .description('Show which key is active, where it comes from, and the account it belongs to (GET /v2/me, free)')
    .option('--offline', 'Do not call the API')
    .option('--json', 'Print JSON')
    .addHelpText('before', 'Examples:\n  $ invd auth status\n  $ invd auth status --offline --json\n')
    .action(withErrorHandling(async (opts: { offline?: boolean; json?: boolean }) => status(opts)));

  auth
    .command('token')
    .description('Print the active API key to stdout (for scripts: curl -H "Authorization: Bearer $(invd auth token)")')
    .addHelpText('before', 'Examples:\n  $ invd auth token\n  $ export INVD_API_KEY="$(invd auth token)"\n')
    .action(withErrorHandling(async () => {
      process.stdout.write(`${(await resolveApiKey()).key}\n`);
    }));

  auth
    .command('logout')
    .description('Revoke the current login and clear the stored key')
    .addHelpText('before', 'Examples:\n  $ invd auth logout\n  $ INVD_API_KEY= invd auth logout\n')
    .action(withErrorHandling(async () => logout()));
}
