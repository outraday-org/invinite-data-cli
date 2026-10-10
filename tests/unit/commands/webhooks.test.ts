import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
}));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { Command } from 'commander';
import { buildUpdateBody, parseActive, parseEvents, registerWebhooksCommands, WEBHOOK_EVENTS } from '../../../src/commands/webhooks.js';
import { splitList } from '../../../src/shared/options.js';

const SUBSCRIPTION = {
  id: 'wh_1',
  url: 'https://hooks.example.com/invinite',
  events: ['earnings_call.transcript_ready'],
  filters: { ciks: ['0000320193'], keywords: [] },
  active: true,
  disabled_reason: null,
  consecutive_failures: 0,
  secret_hint: 'abcd',
  created_at: '2026-10-10T00:00:00.000Z',
  updated_at: '2026-10-10T00:00:00.000Z',
};

function program(): Command {
  const root = new Command();
  root.exitOverride().option('--json').option('--all');
  registerWebhooksCommands(root);
  return root;
}

const run = (...args: string[]) => program().parseAsync(['node', 'invd', ...args]);

function respond(status: number, body?: unknown) {
  (fetch as any).mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  });
}

const call = (i = 0) => {
  const [url, init] = (fetch as any).mock.calls[i];
  return { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined };
};

describe('webhooks commands', () => {
  let logs: string[];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Only the console spies: restoreAllMocks would also strip the vi.mock factories' return values.
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it('list → GET /v1/earnings-calls/webhooks', async () => {
    respond(200, { data: [SUBSCRIPTION] });
    await run('webhooks', 'list');
    expect(call()).toEqual({ url: 'https://api.example.com/v1/earnings-calls/webhooks', method: 'GET', body: undefined });
    expect(logs.join('\n')).toContain('wh_1');
  });

  it('create → POST with events + filters and prints the secret once', async () => {
    respond(201, { ...SUBSCRIPTION, secret: 'whsec_secret' });
    await run('webhooks', 'create', '--url', SUBSCRIPTION.url, '--events', 'earnings_call.transcript_ready, ping', '--ciks', '320193');
    expect(call()).toEqual({
      url: 'https://api.example.com/v1/earnings-calls/webhooks',
      method: 'POST',
      body: { url: SUBSCRIPTION.url, events: ['earnings_call.transcript_ready', 'ping'], filters: { ciks: ['320193'] } },
    });
    expect(logs.filter(line => line.includes('whsec_secret'))).toHaveLength(1);
    expect(logs.join('\n')).toContain('shown only this once');
  });

  it('create without filters sends no filters key', async () => {
    respond(201, { ...SUBSCRIPTION, secret: 'whsec_secret' });
    await run('webhooks', 'create', '--url', SUBSCRIPTION.url, '--events', 'ping');
    expect(call().body).toEqual({ url: SUBSCRIPTION.url, events: ['ping'] });
  });

  it('update → PATCH /:id with only the given fields', async () => {
    respond(200, { ...SUBSCRIPTION, filters: { ciks: [], keywords: ['tariffs'] } });
    await run('webhooks', 'update', 'wh_1', '--keywords', 'tariffs');
    expect(call()).toEqual({
      url: 'https://api.example.com/v1/earnings-calls/webhooks/wh_1',
      method: 'PATCH',
      body: { keywords: ['tariffs'] },
    });
    expect(logs.join('\n')).toContain('Webhook updated');
  });

  it('update sends every field it is given, an empty list clears, --active parses', async () => {
    respond(200, SUBSCRIPTION);
    await run('webhooks', 'update', 'wh_1', '--keywords', 'tariffs, china', '--ciks', '', '--events', 'earnings_call.keyword_hit,ping', '--active', 'false');
    expect(call().body).toEqual({ keywords: ['tariffs', 'china'], ciks: [], events: ['earnings_call.keyword_hit', 'ping'], active: false });
  });

  it('update without an option is refused before any request', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    await expect(run('webhooks', 'update', 'wh_1')).rejects.toThrow('exit');
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('at least one of --keywords, --ciks, --events, --active');
    exit.mockRestore();
  });

  it('delete → DELETE /:id (204)', async () => {
    respond(204);
    await run('webhooks', 'delete', 'wh_1');
    expect(call()).toEqual({ url: 'https://api.example.com/v1/earnings-calls/webhooks/wh_1', method: 'DELETE', body: undefined });
    expect(logs.join('\n')).toContain('Deleted webhook wh_1');
  });

  it('rotate-secret → POST /:id/rotate-secret and prints the new secret + expiry', async () => {
    respond(200, { secret: 'whsec_new', previous_secret_expires_at: '2026-10-10T00:05:00.000Z' });
    await run('webhooks', 'rotate-secret', 'wh_1');
    expect(call()).toMatchObject({ url: 'https://api.example.com/v1/earnings-calls/webhooks/wh_1/rotate-secret', method: 'POST' });
    expect(logs).toContain('whsec_new');
    expect(logs.join('\n')).toContain('2026-10-10T00:05:00.000Z');
  });

  it('test → POST /:id/test and prints the queued delivery', async () => {
    respond(202, { delivery_id: 'd-1', event: 'ping' });
    await run('webhooks', 'test', 'wh_1');
    expect(call()).toMatchObject({ url: 'https://api.example.com/v1/earnings-calls/webhooks/wh_1/test', method: 'POST' });
    expect(logs.join('\n')).toContain('d-1');
  });

  it('deliveries → GET /:id/deliveries and tabulates the attempts', async () => {
    respond(200, { data: [{ delivery_id: 'd-1', event: 'ping', attempt: 1, status: 'delivered', response_status: 200, duration_ms: 120, at: '2026-10-10T00:00:01.000Z', next_attempt_at: null }] });
    await run('webhooks', 'deliveries', 'wh_1');
    expect(call()).toEqual({ url: 'https://api.example.com/v1/earnings-calls/webhooks/wh_1/deliveries', method: 'GET', body: undefined });
    const table = logs.join('\n');
    for (const column of ['delivery_id', 'response_status', 'next_attempt_at', 'delivered']) expect(table).toContain(column);
  });

  it('--json prints the API body (secret included) and nothing else', async () => {
    respond(201, { ...SUBSCRIPTION, secret: 'whsec_secret' });
    await run('--json', 'webhooks', 'create', '--url', SUBSCRIPTION.url, '--events', 'ping');
    expect(JSON.parse(logs.join('\n'))).toMatchObject({ id: 'wh_1', secret: 'whsec_secret' });
  });
});

describe('parseEvents / splitList', () => {
  it('accepts the documented events, trimmed and de-duplicated', () => {
    expect(parseEvents('ping, ping,earnings_call.ended')).toEqual(['ping', 'earnings_call.ended']);
    expect(WEBHOOK_EVENTS).toHaveLength(11);
    expect(WEBHOOK_EVENTS).toContain('earnings_call.keyword_hit');
    expect(WEBHOOK_EVENTS).toContain('earnings_call.guidance_flash');
  });

  it('names unknown events', () => {
    expect(() => parseEvents('earnings_call.started,earnings_call.nope')).toThrow('Unknown event(s): earnings_call.nope');
    expect(() => parseEvents(' , ')).toThrow('--events');
  });

  it('buildUpdateBody / parseActive', () => {
    expect(buildUpdateBody({ active: 'true' })).toEqual({ active: true });
    expect(buildUpdateBody({ keywords: '' })).toEqual({ keywords: [] });
    expect(() => buildUpdateBody({})).toThrow('at least one of');
    expect(() => buildUpdateBody({ active: 'yes' })).toThrow('--active takes true or false');
    expect(() => buildUpdateBody({ events: 'earnings_call.nope' })).toThrow('Unknown event(s)');
    expect(parseActive('false')).toBe(false);
  });

  it('splits comma lists', () => {
    expect(splitList(undefined)).toEqual([]);
    expect(splitList('320193, 789019,')).toEqual(['320193', '789019']);
  });
});
