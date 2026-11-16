import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../../src/cli.js';
import { parseInterval, tailAlertEvents, type TailDeps } from '../../../src/commands/alert-events.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const page = (ids: string[], hasMore = false) =>
  json({ data: ids.map(id => ({ id, type: 'alert.fired', alert_id: 'alt_1', occurred_at: '2026-11-16T00:00:00Z', payload: {} })), has_more: hasMore, next_cursor: null, meta: {} });
const requested = (call: number) => new URL(String(vi.mocked(fetch).mock.calls[call]?.[0]));

/** Deps that record output and stop after `polls` waits between polls. */
function deps(polls: number) {
  const lines: string[] = [];
  const notes: string[] = [];
  const sleeps: number[] = [];
  let waits = 0;
  const value: TailDeps = {
    write: line => { lines.push(line); },
    note: line => { notes.push(line); },
    sleep: async ms => { sleeps.push(ms); },
    stop: () => waits++ >= polls,
  };
  return { value, lines, notes, sleeps };
}

describe('invd alert-events tail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.INVD_API_KEY = 'k';
    process.env.INVD_BASE_URL = 'https://api.example.com';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.INVD_API_KEY;
    delete process.env.INVD_BASE_URL;
  });

  it('with --after prints every newer event as one JSON line and polls on with after=<last id> every interval', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page(['evt_2', 'evt_3']))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page(['evt_4']));
    const d = deps(2);
    await tailAlertEvents({ after: 'evt_1', type: 'alert.fired', intervalSeconds: 2 }, d.value);
    expect(d.lines.map(line => (JSON.parse(line) as { id: string }).id)).toEqual(['evt_2', 'evt_3', 'evt_4']);
    expect(requested(0).pathname).toBe('/v1/alert-events');
    expect(Object.fromEntries(requested(0).searchParams)).toEqual({ type: 'alert.fired', after: 'evt_1', limit: '200' });
    expect(requested(1).searchParams.get('after')).toBe('evt_3');
    expect(requested(2).searchParams.get('after')).toBe('evt_3');
    expect(d.sleeps).toEqual([2000, 2000]);
    expect(d.notes).toEqual([]);
  });

  it('without --after skips the backlog (reading on at once while has_more), then prints only new events', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page(['evt_1', 'evt_2'], true))
      .mockResolvedValueOnce(page(['evt_3']))
      .mockResolvedValueOnce(page(['evt_4']));
    const d = deps(1);
    await tailAlertEvents({ intervalSeconds: 2 }, d.value);
    expect(requested(0).searchParams.has('after')).toBe(false);
    expect(requested(1).searchParams.get('after')).toBe('evt_2');
    expect(requested(2).searchParams.get('after')).toBe('evt_3');
    expect(d.lines.map(line => (JSON.parse(line) as { id: string }).id)).toEqual(['evt_4']);
    expect(d.notes).toEqual(['Following new events after evt_3 (3 earlier skipped; --from-start prints them)']);
    expect(d.sleeps).toEqual([2000]);
  });

  it('--from-start prints the backlog too', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page(['evt_1'], true)).mockResolvedValueOnce(page(['evt_2']));
    const d = deps(0);
    await tailAlertEvents({ fromStart: true, intervalSeconds: 1 }, d.value);
    expect(d.lines).toHaveLength(2);
  });

  it('a 429 is retried after its Retry-After; another refusal ends the tail', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ title: 'Too Many Requests', detail: 'slow down', code: 'rate_limited' }, 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(page(['evt_2']));
    const d = deps(0);
    await tailAlertEvents({ after: 'evt_1', intervalSeconds: 2 }, d.value);
    expect(d.sleeps[0]).toBe(3000);
    expect(d.lines).toHaveLength(1);

    vi.mocked(fetch).mockResolvedValueOnce(json({ title: 'Not Found', detail: 'no such alert', code: 'not_found' }, 404));
    await expect(tailAlertEvents({ after: 'evt_1', intervalSeconds: 2 }, deps(5).value)).rejects.toThrow('no such alert');
  });

  it('--interval is a number of seconds of at least 1', () => {
    expect(parseInterval(undefined)).toBe(2);
    expect(parseInterval('5')).toBe(5);
    expect(() => parseInterval('0.5')).toThrow('at least 1');
    expect(() => parseInterval('x')).toThrow('at least 1');
  });

  it('is registered under the generated alert-events group, beside its list and get', () => {
    const group = createProgram().commands.find(command => command.name() === 'alert-events');
    expect(group?.commands.map(command => command.name()).sort()).toEqual(['get', 'list', 'tail']);
  });

  it('refuses --after with --from-start and an unknown --type before any request (exit 2)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never);
    await expect(createProgram().parseAsync(['node', 'invd', 'alert-events', 'tail', '--after', 'evt_1', '--from-start'])).rejects.toThrow('exit 2');
    await expect(createProgram().parseAsync(['node', 'invd', 'alert-events', 'tail', '--type', 'nope'])).rejects.toThrow('exit 2');
    expect(fetch).not.toHaveBeenCalled();
  });
});
