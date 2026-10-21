import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
  DASHBOARD_URL: 'https://app.example.com/data-api',
}));

vi.mock('../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { createProgram, loadManifest } from '../../src/cli.js';

function respond(headers: Record<string, string>) {
  (fetch as any).mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: () => Promise.resolve({ status: 'ok', timestamp: '2026-10-17T00:00:00Z' }),
  });
}

const run = (...args: string[]) => createProgram().exitOverride().parseAsync(['node', 'invd', ...args]);

describe('--show-cost', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
    vi.spyOn(console, 'error').mockImplementation((line?: unknown) => { err.push(String(line ?? '')); });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INVD_SHOW_COST;
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it('writes both credit headers to stderr only', async () => {
    respond({ 'X-Credits-Charged': '5', 'X-Credits-Included-Remaining': '99' });
    await run('--show-cost', 'health');
    // The header is the allowance BEFORE this request: 99 − 5 charged = 94 left after it.
    expect(err).toEqual(['credits: 5 · included left: 94']);
    expect(out.join('\n')).not.toContain('credits:');
  });

  it('honours INVD_SHOW_COST=1 and prints — for an absent remaining header', async () => {
    process.env.INVD_SHOW_COST = '1';
    respond({ 'X-Credits-Charged': '0' });
    await run('health');
    expect(err).toEqual(['credits: 0 · included left: —']);
  });

  it('prints nothing without the flag', async () => {
    respond({ 'X-Credits-Charged': '5', 'X-Credits-Included-Remaining': '99' });
    await run('health');
    expect(err).toEqual([]);
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
});
