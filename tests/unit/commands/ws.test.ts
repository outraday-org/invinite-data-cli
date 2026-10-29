import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/client/websocket-client.js', () => ({
  connectWebSocket: vi.fn().mockResolvedValue(undefined),
}));

import { Command } from 'commander';
import { connectWebSocket } from '../../../src/client/websocket-client.js';
import { buildListenOptions, buildNewsOptions, registerWsCommands } from '../../../src/commands/ws.js';

const EVENT_ID = '0b9d6f43-6b1e-4c39-9d3a-2f6a3c1e8b11';

function program(): Command {
  const root = new Command();
  root.exitOverride().option('--json').option('--all');
  registerWsCommands(root);
  return root;
}

const run = (...args: string[]) => program().parseAsync(['node', 'invd', ...args]);

const connected = () => vi.mocked(connectWebSocket).mock.calls[0][0];

describe('ws listen', () => {
  let errors: string[];

  beforeEach(() => {
    vi.mocked(connectWebSocket).mockClear();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
  });

  it('without --earnings listens to the filing stream', async () => {
    await run('ws', 'listen');
    expect(connected()).toEqual({});
  });

  it('--earnings with --keywords, --keyword-match and --speaker-roles subscribes with the alert fields', async () => {
    await run('--json', 'ws', 'listen', '--earnings', '320193', '--keywords', 'tariffs, china', '--keyword-match', 'stem', '--speaker-roles', 'executive,analyst');
    expect(connected()).toEqual({
      earnings: {
        target: { cik: '320193' },
        sinceSeq: -1,
        partials: false,
        names: false,
        json: true,
        keywords: { keywords: ['tariffs', 'china'], keywordMatch: 'stem', speakerRoles: ['executive', 'analyst'], minRank: undefined },
      },
    });
  });

  it('--earnings without keywords sends no keyword fields', async () => {
    await run('ws', 'listen', '--earnings', EVENT_ID, '--partials', '--since-seq', '7');
    expect(connected()).toEqual({
      earnings: { target: { event_id: EVENT_ID }, sinceSeq: 7, partials: true, names: false, json: false },
    });
  });

  it('--earnings --prices asks for price ticks', async () => {
    await run('ws', 'listen', '--earnings', EVENT_ID, '--prices');
    expect(connected()).toEqual({
      earnings: { target: { event_id: EVENT_ID }, sinceSeq: -1, partials: false, names: false, json: false, prices: true },
    });
  });

  it('--all-live --keywords subscribes to the global scope', async () => {
    await run('ws', 'listen', '--all-live', '--keywords', 'tariffs', '--min-rank', '500');
    expect(connected()).toMatchObject({
      earnings: { target: { scope: 'all_live' }, keywords: { keywords: ['tariffs'], minRank: 500 } },
    });
  });

  it('--all-live without --keywords is refused client-side', async () => {
    await expect(run('ws', 'listen', '--all-live')).rejects.toThrow('exit');
    expect(connectWebSocket).not.toHaveBeenCalled();
    expect(errors.join('\n')).toContain('--all-live needs --keywords');
  });

  it('refuses invalid combinations and values', () => {
    expect(() => buildListenOptions({ earnings: '320193', allLive: true, keywords: 'x' }, false)).toThrow('exclude each other');
    expect(() => buildListenOptions({ earnings: '320193', keywordMatch: 'stem' }, false)).toThrow('need --keywords');
    expect(() => buildListenOptions({ allLive: true, keywords: 'tariffs', partials: true }, false)).toThrow('need --earnings');
    expect(() => buildListenOptions({ earnings: '320193', keywords: 'tariffs', minRank: '5' }, false)).toThrow('--min-rank needs --all-live');
    expect(() => buildListenOptions({ keywords: 'tariffs' }, false)).toThrow('need --earnings or --all-live');
    expect(() => buildListenOptions({ allLive: true, keywords: 'tariffs', prices: true }, false)).toThrow('--names and --prices follow one call');
    expect(() => buildListenOptions({ prices: true }, false)).toThrow('need --earnings or --all-live');
    expect(() => buildListenOptions({ earnings: '320193', keywords: 'a' }, false)).toThrow('2–64 characters');
    expect(() => buildListenOptions({ earnings: '320193', keywords: 'tariffs', keywordMatch: 'fuzzy' }, false)).toThrow('--keyword-match takes exact or stem');
    expect(() => buildListenOptions({ earnings: '320193', keywords: 'tariffs', speakerRoles: 'ceo' }, false)).toThrow('Unknown role(s): ceo');
  });

  it('--news --tickers subscribes to news.live and nothing else', async () => {
    await run('--json', 'ws', 'listen', '--news', '--tickers', 'nvda, BRK.B', '--news-kinds', 'guidance,earnings_results', '--news-sources', 'ir', '--earnings-news');
    expect(connected()).toEqual({
      news: { tickers: ['NVDA', 'BRK.B'], kinds: ['guidance', 'earnings_results'], sources: ['ir'], earningsOnly: true, json: true },
    });
  });

  it('--news alone follows every company', async () => {
    await run('ws', 'listen', '--news');
    expect(connected()).toEqual({ news: { earningsOnly: false, json: false } });
  });

  it('--news --earnings is refused before connecting', async () => {
    await expect(run('ws', 'listen', '--news', '--earnings', '123')).rejects.toThrow('exit');
    expect(connectWebSocket).not.toHaveBeenCalled();
    expect(errors.join('\n')).toContain('--news and --earnings exclude each other');
  });

  it('refuses the news filters without --news and the live-call flags with it', () => {
    expect(() => buildNewsOptions({ tickers: 'NVDA' }, false)).toThrow('need --news');
    expect(() => buildNewsOptions({ earningsNews: true }, false)).toThrow('need --news');
    expect(() => buildNewsOptions({ news: true, allLive: true }, false)).toThrow('--news and --all-live exclude each other');
    expect(() => buildNewsOptions({ news: true, keywords: 'tariffs' }, false)).toThrow('not with --news');
    expect(() => buildNewsOptions({ news: true, newsKinds: 'rumour' }, false)).toThrow('Unknown value(s): rumour');
    expect(() => buildNewsOptions({ news: true, newsSources: 'prnewswire' }, false)).toThrow('Unknown value(s): prnewswire');
    expect(() => buildNewsOptions({ news: true, ciks: 'abc' }, false)).toThrow('not a CIK');
    expect(() => buildNewsOptions({ news: true, tickers: 'NV DA' }, false)).toThrow('not a ticker');
    expect(buildNewsOptions({}, false)).toBeNull();
  });
});
