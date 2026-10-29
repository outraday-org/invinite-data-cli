import { describe, it, expect } from 'vitest';
import {
  formatNewsItem,
  isNewsFrame,
  newsStep,
  newsSubscribeFrame,
  parseCiks,
  parseNewsKinds,
  parseNewsSources,
  parseTickers,
} from '../../../src/client/news-live.js';

const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '');

const ITEM = {
  id: '4c1d9e62-3b7a-4f2e-8d1c-9e0a7b6c5d4f',
  title: 'NVIDIA Announces Financial Results — Q3 FY2027 (Ünïcode ✓)',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/index.htm',
  published_at: '2026-10-28T20:05:10.123456Z',
  symbols: ['NVDA'],
  source: { id: 'edgar' },
  is_earnings_news: true,
};

describe('news-live', () => {
  it('builds the subscribe frame without empty filters', () => {
    expect(newsSubscribeFrame({ earningsOnly: false, json: false })).toEqual({ type: 'subscribe', channel: 'news.live' });
    expect(newsSubscribeFrame({ tickers: ['NVDA'], ciks: ['1045810'], kinds: ['guidance'], sources: ['edgar'], earningsOnly: true, json: true })).toEqual({
      type: 'subscribe', channel: 'news.live', tickers: ['NVDA'], ciks: ['1045810'], earnings_only: true, kinds: ['guidance'], sources: ['edgar'],
    });
  });

  it('tells news frames by channel, not by type', () => {
    expect(isNewsFrame({ type: 'error', channel: 'news.live' })).toBe(true);
    expect(isNewsFrame({ type: 'news_item' })).toBe(true);
    expect(isNewsFrame({ type: 'error', code: 'not_live' })).toBe(false);
    expect(isNewsFrame({ type: 'new_filing' })).toBe(false);
  });

  it('formats one line: time (µs dropped), source, tickers, headline (Unicode kept), url', () => {
    const line = strip(formatNewsItem(ITEM));
    expect(line).toBe(`2026-10-28 20:05:10Z  SEC EDGAR  NVDA  ${ITEM.title} [earnings]  ${ITEM.url}`);
    expect(strip(formatNewsItem({ ...ITEM, symbols: [], source: { id: 'ir', host: 'nvidianews.nvidia.com' }, is_earnings_news: false })))
      .toContain('nvidianews.nvidia.com  —  ');
    expect(strip(formatNewsItem({ ...ITEM, source: { id: 'ir', host: null } }))).toContain('company newsroom  NVDA');
  });

  it('steps through the channel frames', () => {
    expect(strip(newsStep({ type: 'subscribed', channel: 'news.live', filters: { tickers: [], ciks: [], kinds: [], sources: [], earnings_only: false } }).lines[0]))
      .toBe('news.live · every company');
    expect(newsStep({ type: 'news_item', channel: 'news.live', item: ITEM }).lines).toHaveLength(1);
    expect(newsStep({ type: 'unsubscribed', channel: 'news.live' }).end).toEqual({ code: 0, message: 'news subscription ended' });
    expect(newsStep({ type: 'error', channel: 'news.live', code: 'unavailable', message: 'x' }).reconnect).toBe(true);
    expect(newsStep({ type: 'error', channel: 'news.live', code: 'forbidden_tier', message: 'x' }).end?.message).toContain('STANDARD plan');
    expect(newsStep({ type: 'error', channel: 'news.live', code: 'channel_unavailable', message: 'x' }).end?.code).toBe(1);
  });

  it('parses the filters', () => {
    expect(parseTickers('nvda, brk-b,nvda')).toEqual(['NVDA', 'BRK-B']);
    expect(parseCiks('0001045810,320193')).toEqual(['0001045810', '320193']);
    expect(parseNewsKinds('dividend')).toEqual(['dividend']);
    expect(parseNewsSources('edgar,ir')).toEqual(['edgar', 'ir']);
    expect(parseTickers(undefined)).toBeUndefined();
    expect(() => parseTickers('')).toThrow('1–50');
    expect(() => parseCiks(Array.from({ length: 51 }, (_, i) => String(i + 1)).join(','))).toThrow('1–50');
    expect(() => parseNewsSources('businesswire')).toThrow('edgar, ir');
  });
});
