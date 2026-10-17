import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
  DASHBOARD_URL: 'https://app.example.com/data-api',
}));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { Command } from 'commander';
import { registerUsageCommands } from '../../../src/commands/usage.js';

const errors = (overrides: Record<string, number> = {}) => ({ '402': 0, '403': 0, '429': 0, '4xx': 0, '5xx': 0, ...overrides });

const USAGE = {
  window_days: 7,
  period: {
    tier: 'lite',
    included_credits: 250000,
    used_credits: 141220,
    resets_at: '2026-11-01T00:00:00.000Z',
    prepaid_balance_usd: 12.5,
  },
  daily: [
    { date: '2026-10-11', requests: 0, credits: 0, errors: errors() },
    { date: '2026-10-12', requests: 10, credits: 20000, errors: errors({ '403': 12 }) },
    { date: '2026-10-13', requests: 20, credits: 121220, errors: errors({ '429': 3 }) },
  ],
  by_family: [
    { family: 'financials', label: 'Financials', requests: 20, credits: 98100 },
    { family: 'filings', label: 'SEC Filings', requests: 10, credits: 43120 },
  ],
  by_key: [
    { caller: 'key', label: 'Backtest box', key_hint: 'invd_a1b...c2d3', requests: 25, credits: 120000 },
    { caller: 'oauth', label: 'Signed-in user', key_hint: null, requests: 5, credits: 21220 },
  ],
  truncated: false,
};

function program(): Command {
  const root = new Command();
  root.exitOverride().option('--json').option('--all');
  registerUsageCommands(root);
  return root;
}

const run = (...args: string[]) => program().parseAsync(['node', 'invd', ...args]);

function respond(status: number, text: string) {
  (fetch as any).mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  });
}

describe('usage command', () => {
  let logs: string[];
  let errorLines: string[];
  let written: string;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    logs = [];
    errorLines = [];
    written = '';
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { logs.push(String(line ?? '')); });
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { errorLines.push(parts.map(String).join(' ')); });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { written += String(chunk); return true; });
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.exit).mockRestore();
  });

  it('GETs /v1/account/usage with the window and renders every section', async () => {
    respond(200, JSON.stringify(USAGE));
    await run('usage', '--days', '7');
    expect((fetch as any).mock.calls[0][0]).toBe('https://api.example.com/v1/account/usage?days=7');
    const out = logs.join('\n');
    expect(out).toContain('Lite · 250,000 credits included · resets 1 Nov 2026, 00:00 UTC');
    expect(out).toContain('141,220 credits (56 %) · prepaid balance $12.50');
    expect(out).toContain('▁▂█   (credits per day, 2026-10-11 → 2026-10-13 UTC)');
    expect(out).toContain('Financials 98,100 · SEC Filings 43,120');
    expect(out).toContain('Backtest box (invd_a1b...c2d3) 120,000 · Signed-in user 21,220');
    expect(out).toContain('403 ×12 · 429 ×3');
    expect(out).toContain('https://app.example.com/data-api/usage');
    for (const label of ['Plan', 'Used', 'Daily', 'By family', 'By key', 'Errors', 'Details']) {
      expect(out).toContain(label);
    }
  });

  it('defaults to a 30-day window', async () => {
    respond(200, JSON.stringify({ ...USAGE, window_days: 30 }));
    await run('usage');
    expect((fetch as any).mock.calls[0][0]).toBe('https://api.example.com/v1/account/usage?days=30');
  });

  it('--json passes the body through byte-identical', async () => {
    const body = JSON.stringify(USAGE);
    respond(200, body);
    await run('--json', 'usage', '--days', '7');
    expect(written).toBe(`${body}\n`);
    expect(logs).toEqual([]);
  });

  it('refuses --days 14 before any request', async () => {
    await expect(run('usage', '--days', '14')).rejects.toThrow(/Allowed choices are 7, 30, 90/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers a 503 with the retry sentence', async () => {
    respond(503, JSON.stringify({ error: 'Service Unavailable', message: 'Usage is temporarily unavailable. Please retry.' }));
    await run('usage');
    expect(errorLines.join('\n')).toContain('Usage is temporarily unavailable — try again in a minute.');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('points a 401 at invd login', async () => {
    respond(401, JSON.stringify({ error: 'Unauthorized', message: 'Invalid API key' }));
    await run('usage');
    expect(errorLines.join('\n')).toContain('Run: invd login');
  });

  it('says when a breakdown was capped and handles a plan without included credits', async () => {
    respond(200, JSON.stringify({
      ...USAGE,
      period: { ...USAGE.period, tier: 'prepaid', included_credits: 0, resets_at: null },
      by_family: [], by_key: [], daily: [], truncated: true,
    }));
    await run('usage');
    const out = logs.join('\n');
    expect(out).toContain('Prepaid · 0 credits included · no reset date');
    expect(out).toContain('141,220 credits · prepaid balance');
    expect(out).toContain('Breakdowns are capped');
  });
});
