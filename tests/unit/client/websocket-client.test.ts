import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
}));

import { connectWebSocket } from '../../../src/client/websocket-client.js';

const EVENT_ID = '0b9d6f43-6b1e-4c39-9d3a-2f6a3c1e8b11';

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: unknown[] = [];
  private listeners: Record<string, ((event: any) => void)[]> = {};

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (event: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.emit('close', { code: 1000, reason: '' });
  }

  emit(type: string, event: any = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }

  frame(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) });
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('connectWebSocket --earnings', () => {
  let logs: string[];

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Only the console spies: restoreAllMocks would also strip the vi.mock factories' return values.
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  const listen = (json = false) => connectWebSocket({
    earnings: { target: { event_id: EVENT_ID }, sinceSeq: -1, partials: false, names: false, json },
  });

  it('replays from -1, resubscribes after the last final on reconnect, exits on transcript_ready', async () => {
    vi.useFakeTimers();
    const done = listen();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    expect(first.url).toBe('wss://api.example.com/v1/ws?api_key=test-api-key');

    first.emit('open');
    expect(first.sent).toEqual([{ type: 'subscribe', channel: 'earnings-calls.live', event_id: EVENT_ID, since_seq: -1, partials: false }]);
    first.frame({ type: 'subscribed', subscription_id: 's1', event_id: EVENT_ID, cik: '0000320193', symbol: 'AAPL', conference_date: '2026-10-30T21:00:00.000Z', current_seq: 1, state: 'capturing' });
    first.frame({ type: 'speaker_names', subscription_id: 's1', event_id: EVENT_ID, revision: 1, assignments: [{ speaker_label: 'A', from_seq: 0, to_seq: null, name: 'Tim Cook', role: 'executive', title: null, firm: null, source: 'llm', confidence: 0.9 }] });
    first.frame({ type: 'transcript_segment', subscription_id: 's1', event_id: EVENT_ID, seq: 0, start_ms: 0, end_ms: 1000, speaker_label: 'A', text: 'Hello.', is_final: true });
    first.frame({ type: 'transcript_segment', subscription_id: 's1', event_id: EVENT_ID, seq: 1, start_ms: 65_000, end_ms: 66_000, speaker_label: 'A', text: 'Welcome.', is_final: true });
    first.frame({ type: 'new_filing', filing: { form_type: '8-K' } });
    expect(logs).toContain('[1:05] Tim Cook: Welcome.');
    expect(logs.join('\n')).not.toContain('8-K');

    first.emit('close', { code: 1006, reason: '' });
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeSocket.instances[1];
    second.emit('open');
    expect(second.sent).toEqual([{ type: 'subscribe', channel: 'earnings-calls.live', event_id: EVENT_ID, since_seq: 1, partials: false }]);

    second.frame({ type: 'transcript_ready', subscription_id: 's2', event_id: EVENT_ID, at: '2026-10-30T22:40:00Z' });
    await expect(done).resolves.toBeUndefined();
    expect(logs.join('\n')).toContain(`invd earnings transcript --event ${EVENT_ID}`);
  });

  it('sends the keyword fields with the subscribe and prints a hit with its speaker', async () => {
    const done = connectWebSocket({
      earnings: { target: { cik: '320193' }, sinceSeq: -1, partials: false, names: false, json: false, keywords: { keywords: ['tariffs'], keywordMatch: 'stem' } },
    });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    expect(socket.sent).toEqual([{ type: 'subscribe', channel: 'earnings-calls.live', cik: '320193', since_seq: -1, partials: false, keywords: ['tariffs'], keyword_match: 'stem' }]);
    socket.frame({ type: 'keyword_hit', subscription_id: 's1', cik: '0000320193', symbol: 'AAPL', conference_date: '2026-10-30T21:00:00.000Z', keyword: 'tariffs', seq: 3, start_ms: 65_000, end_ms: 66_000, text: 'Tariffs hurt.', context_before: '', speaker_label: 'A', speaker_name: 'Tim Cook', speaker_role: 'executive', layer: 'live', latency_ms: 500 });
    socket.frame({ type: 'warning', code: 'global_scope_degraded' });
    socket.frame({ type: 'unsubscribed', subscription_id: 's1', reason: 'call_not_live' });
    await done;
    const out = logs.join('\n');
    expect(out).toContain('[1:05] keyword "tariffs"');
    expect(out).toContain('Tim Cook (executive): Tariffs hurt.');
    expect(out).toContain('warning: global scope degraded');
  });

  it('subscribes to the global scope with --all-live', async () => {
    const done = connectWebSocket({
      earnings: { target: { scope: 'all_live' }, sinceSeq: -1, partials: false, names: false, json: false, keywords: { keywords: ['tariffs'] } },
    });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    expect(socket.sent).toEqual([{
      type: 'subscribe', channel: 'earnings-calls.live', scope: 'all_live', keywords: ['tariffs'], events: ['keyword_hit', 'guidance_flash'],
    }]);
    socket.frame({ type: 'subscribed', subscription_id: 's1', scope: 'all_live', keywords: ['tariffs'] });
    socket.frame({ type: 'error', code: 'bad_message', message: 'keywords required' });
    await expect(done).rejects.toThrow('bad_message');
    expect(logs.join('\n')).toContain('all live calls · keywords: tariffs');
  });

  it('prints NDJSON only under --json', async () => {
    const done = listen(true);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    const segment = { type: 'transcript_segment', subscription_id: 's1', event_id: EVENT_ID, seq: 0, start_ms: 0, end_ms: 1, speaker_label: 'A', text: 'Hi.', is_final: true };
    socket.frame(segment);
    socket.frame({ type: 'unsubscribed', subscription_id: 's1', reason: 'call_not_live' });
    await done;
    expect(logs).toEqual([
      JSON.stringify(segment),
      JSON.stringify({ type: 'unsubscribed', subscription_id: 's1', reason: 'call_not_live' }),
    ]);
  });

  it('rejects on a fatal error frame', async () => {
    const done = listen();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0].emit('open');
    FakeSocket.instances[0].frame({ type: 'error', code: 'not_live', message: 'This earnings call is not live' });
    await expect(done).rejects.toThrow('not_live');
  });

  it('does not reconnect after a permanent close code', async () => {
    const done = listen();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0].emit('close', { code: 4003, reason: 'Forbidden: Requires PRO plan' });
    await expect(done).rejects.toThrow('4003');
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('connectWebSocket --news', () => {
  let logs: string[];

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  const ITEM = {
    id: '4c1d9e62-3b7a-4f2e-8d1c-9e0a7b6c5d4f',
    title: 'NVIDIA Announces Rubin Platform',
    url: 'https://nvidianews.nvidia.com/news/rubin',
    published_at: '2026-10-29T13:03:22.000Z',
    symbols: ['NVDA'],
    source: { id: 'ir', name: null, host: 'nvidianews.nvidia.com' },
    is_earnings_news: false,
  };

  it('subscribes with the filters, prints one line per item before any other branch, ignores filings', async () => {
    const done = connectWebSocket({ news: { tickers: ['NVDA'], earningsOnly: false, json: false } });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    expect(socket.sent).toEqual([{ type: 'subscribe', channel: 'news.live', tickers: ['NVDA'] }]);
    socket.frame({ type: 'subscribed', channel: 'news.live', filters: { tickers: ['NVDA'], ciks: [], earnings_only: false, kinds: [], sources: [] } });
    socket.frame({ type: 'new_filing', filing: { form_type: '8-K', cik: '1045810', filing_date: '2026-10-29' } });
    socket.frame({ type: 'news_item', channel: 'news.live', item: ITEM });
    socket.frame({ type: 'unsubscribed', channel: 'news.live' });
    await done;
    const out = logs.join('\n');
    expect(out).toContain('news.live · tickers NVDA');
    expect(out).toMatch(/2026-10-29 13:03:22Z\s+nvidianews\.nvidia\.com\s+.*NVDA.*NVIDIA Announces Rubin Platform/);
    expect(out).not.toContain('8-K');
  });

  it('prints NDJSON only under --json', async () => {
    const done = connectWebSocket({ news: { earningsOnly: true, json: true } });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    expect(socket.sent).toEqual([{ type: 'subscribe', channel: 'news.live', earnings_only: true }]);
    const frame = { type: 'news_item', channel: 'news.live', item: ITEM };
    socket.frame(frame);
    socket.frame({ type: 'unsubscribed', channel: 'news.live' });
    await done;
    expect(logs).toEqual([JSON.stringify(frame), JSON.stringify({ type: 'unsubscribed', channel: 'news.live' })]);
  });

  it('a news error frame ends the run; the earnings error of the same type is not read as news', async () => {
    const done = connectWebSocket({ news: { earningsOnly: false, json: false } });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    socket.frame({ type: 'error', code: 'not_live', message: 'earnings' });
    socket.frame({ type: 'error', channel: 'news.live', code: 'forbidden_tier', message: 'Requires STANDARD' });
    await expect(done).rejects.toThrow('news.live needs the STANDARD plan');
  });
});
