import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram, loadManifest, TOP_COMMANDS } from '../../src/cli.js';

function respond(headers: Record<string, string>, body: unknown = { plan: 'pro' }) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers }));
}

const run = (...args: string[]) => createProgram().exitOverride().parseAsync(['node', 'invd', ...args]);

describe('--show-cost', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.INVD_API_KEY = 'test-key';
    process.env.INVD_BASE_URL = 'https://api.example.com';
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
    vi.spyOn(console, 'error').mockImplementation((line?: unknown) => { err.push(String(line ?? '')); });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INVD_SHOW_COST;
    delete process.env.INVD_API_KEY;
    delete process.env.INVD_BASE_URL;
    vi.restoreAllMocks();
  });

  it('writes the credit headers to stderr only', async () => {
    respond({ 'X-Credits-Charged': '1', 'X-Credits-Remaining': '99' });
    await run('me', 'show', '--show-cost', '--json');
    expect(err).toEqual(['credits: 1 · remaining: 99']);
    expect(out.join('\n')).not.toContain('credits:');
    expect(JSON.parse(out.join('\n'))).toEqual({ plan: 'pro' });
  });

  it('honours INVD_SHOW_COST=1 and prints — for an absent remaining header', async () => {
    process.env.INVD_SHOW_COST = '1';
    respond({ 'X-Credits-Charged': '0' });
    await run('me', 'show', '--json');
    expect(err).toEqual(['credits: 0 · remaining: —']);
  });

  it('prints nothing without the flag', async () => {
    respond({ 'X-Credits-Charged': '5', 'X-Credits-Remaining': '99' });
    await run('me', 'show', '--json');
    expect(err).toEqual([]);
  });

  it('sends the key as a bearer token to the configured host', async () => {
    respond({});
    await run('me', 'show', '--json');
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.example.com/v1/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });
});

describe('help', () => {
  it('lists the eight most-used commands first and every one of them resolves', () => {
    expect(TOP_COMMANDS).toHaveLength(8);
    const help = createProgram().helpInformation();
    expect(help).toContain('financials');
    const program = createProgram();
    let text = '';
    program.configureOutput({ writeOut: (chunk) => { text += chunk; } });
    program.exitOverride();
    expect(() => program.parse(['node', 'invd', '--help'])).toThrow();
    expect(text.startsWith('Most used:')).toBe(true);
    expect(text).toContain('Exit codes: 0 ok');
  });

  it('every generated command leads its help with two examples', () => {
    const program = createProgram();
    let text = '';
    program.configureOutput({ writeOut: (chunk) => { text += chunk; } });
    program.exitOverride();
    const holdings = program.commands.find(command => command.name() === 'holdings');
    holdings?.commands.forEach(command => command.configureOutput({ writeOut: (chunk) => { text += chunk; } }));
    expect(() => program.parse(['node', 'invd', 'holdings', 'list', '--help'])).toThrow();
    const examples = text.split('\n').filter(line => line.startsWith('  $ invd holdings list'));
    expect(text.startsWith('Examples:')).toBe(true);
    expect(examples).toHaveLength(2);
    expect(examples[0]).toContain('AAPL');
    expect(text).toContain('Fields (--json a,b):');
  });
});

describe('loadManifest', () => {
  it('reads src/generated/cli-manifest.json next to src/cli.ts (dist/src/generated/ in the build)', () => {
    const file = JSON.parse(readFileSync(new URL('../../src/generated/cli-manifest.json', import.meta.url), 'utf8'));
    const manifest = loadManifest();
    expect(manifest.specSha256).toBe(file.specSha256);
    expect(manifest.operations).toHaveLength(file.operations.length);
    expect(loadManifest()).toBe(manifest);
  });

  it('carries only /v1 operations', () => {
    expect(loadManifest().operations.every(operation => operation.path.startsWith('/v1/'))).toBe(true);
    expect(loadManifest().operations).toHaveLength(82);
  });
});
