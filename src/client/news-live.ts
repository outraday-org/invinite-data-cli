import chalk from 'chalk';

/**
 * Pure pieces of `invd ws listen --news`: the subscribe frame, the option parsers and one step per server frame of
 * IDA's `news.live` channel (`src/routes/websocket/types/newsMessages.ts`). Every news frame carries
 * `channel: "news.live"` — that, not its `type`, tells it apart from the earnings frames (both have `error` /
 * `subscribed` / `unsubscribed`). A `news_item` frame's `item` is the same object as a `GET /v1/news` row.
 */

export const NEWS_LIVE_CHANNEL = 'news.live';

/** IDA `NEWS_KINDS` (`src/lib/news/constants.ts`) — change both or neither. */
export const NEWS_KINDS = [
  'earnings_results', 'results_date', 'call_announcement', 'event_announcement', 'guidance', 'm_and_a',
  'material_agreement', 'management_change', 'dividend', 'capital_markets', 'legal_spam', 'promo', 'other',
] as const;

/** IDA `NEWS_SOURCE_FILTERS`: the item's first source, SEC EDGAR or a company newsroom. */
export const NEWS_SOURCES = ['edgar', 'ir'] as const;

/** IDA `NEWS_WS_MAX_IDENTIFIERS`: tickers / CIKs one subscription may name. */
const MAX_IDENTIFIERS = 50;

export interface NewsListenOptions {
  tickers?: string[];
  ciks?: string[];
  kinds?: string[];
  sources?: string[];
  earningsOnly: boolean;
  /** NDJSON: every news frame as one line, nothing else on stdout. */
  json: boolean;
}

/** The pushed item's fields `ws listen` prints (the full row is in `--json`). */
export interface NewsItemRow {
  id: string;
  title: string;
  url: string;
  published_at: string;
  symbols: string[];
  /** IDA `publicSource`: `edgar`, or `ir` with the newsroom's host in `host`. */
  source: { id: string; host?: string | null };
  is_earnings_news?: boolean;
  attribution?: { publisher?: string };
}

const list = (value: string | undefined) => [...new Set((value ?? '').split(',').map(v => v.trim()).filter(Boolean))];

/** `--tickers`: 1–50 tickers (letters, digits, `.` and `-`; `BRK.B` and `BRK-B` both match). */
export function parseTickers(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const tickers = list(value).map(t => t.toUpperCase());
  if (tickers.length === 0 || tickers.length > MAX_IDENTIFIERS) throw new Error(`--tickers takes 1–${MAX_IDENTIFIERS} comma-separated tickers`);
  const bad = tickers.filter(t => !/^[A-Z0-9.-]{1,20}$/.test(t));
  if (bad.length) throw new Error(`--tickers: not a ticker: ${bad.join(', ')}`);
  return tickers;
}

/** `--ciks`: 1–50 CIKs (digits, padded or not). */
export function parseCiks(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const ciks = list(value);
  if (ciks.length === 0 || ciks.length > MAX_IDENTIFIERS) throw new Error(`--ciks takes 1–${MAX_IDENTIFIERS} comma-separated CIKs`);
  const bad = ciks.filter(c => !/^\d{1,10}$/.test(c));
  if (bad.length) throw new Error(`--ciks: not a CIK: ${bad.join(', ')}`);
  return ciks;
}

function parseEnumList(flag: string, value: string | undefined, allowed: readonly string[]): string[] | undefined {
  if (value === undefined) return undefined;
  const values = list(value);
  const unknown = values.filter(v => !allowed.includes(v));
  if (values.length === 0 || unknown.length) {
    const named = unknown.length ? `Unknown value(s): ${unknown.join(', ')}. ` : '';
    throw new Error(`${named}${flag} takes a comma-separated list of: ${allowed.join(', ')}`);
  }
  return values;
}

export const parseNewsKinds = (value: string | undefined) => parseEnumList('--news-kinds', value, NEWS_KINDS);

export const parseNewsSources = (value: string | undefined) => parseEnumList('--news-sources', value, NEWS_SOURCES);

/** The `news.live` subscribe frame; an absent filter is left out (no filter = every new item). */
export function newsSubscribeFrame(opts: NewsListenOptions) {
  return {
    type: 'subscribe',
    channel: NEWS_LIVE_CHANNEL,
    ...(opts.tickers?.length ? { tickers: opts.tickers } : {}),
    ...(opts.ciks?.length ? { ciks: opts.ciks } : {}),
    ...(opts.earningsOnly ? { earnings_only: true } : {}),
    ...(opts.kinds?.length ? { kinds: opts.kinds } : {}),
    ...(opts.sources?.length ? { sources: opts.sources } : {}),
  };
}

/** A frame of the news channel (the socket also carries `new_filing` broadcasts, pings and earnings frames). */
export function isNewsFrame(frame: Record<string, any>): boolean {
  return frame.channel === NEWS_LIVE_CHANNEL || frame.type === 'news_item';
}

/** `edgar` → `SEC EDGAR`, `ir` → the newsroom's host (`source.host`). */
function sourceName(source: NewsItemRow['source']): string {
  if (source.id === 'edgar') return 'SEC EDGAR';
  return source.id === 'ir' ? (source.host ?? 'company newsroom') : source.id;
}

/**
 * One line per item: `2026-10-29 13:03:22Z  nvidianews.nvidia.com  NVDA  NVIDIA Announces Rubin  <url>` — time,
 * source, tickers, headline, the original link (the headline is the publisher's, so its source travels with it).
 */
export function formatNewsItem(item: NewsItemRow): string {
  const at = item.published_at.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const tickers = item.symbols.length ? item.symbols.join(',') : '—';
  const earnings = item.is_earnings_news ? ` ${chalk.yellow('[earnings]')}` : '';
  return `${chalk.dim(at)}  ${sourceName(item.source)}  ${chalk.bold(tickers)}  ${item.title}${earnings}  ${chalk.dim(item.url)}`;
}

export interface NewsStep {
  lines: string[];
  /** Stop: exit code + a closing line. */
  end?: { code: 0 | 1; message: string };
  /** Close the socket and resubscribe through the backoff (`unavailable`). */
  reconnect?: boolean;
}

/** One news frame → what to print / do. Unknown frames are ignored. */
export function newsStep(frame: Record<string, any>): NewsStep {
  switch (frame.type) {
    case 'subscribed': {
      const f = frame.filters ?? {};
      const scope = [
        f.tickers?.length ? `tickers ${f.tickers.join(',')}` : null,
        f.ciks?.length ? `CIKs ${f.ciks.join(',')}` : null,
        f.kinds?.length ? `kinds ${f.kinds.join(',')}` : null,
        f.sources?.length ? `sources ${f.sources.join(',')}` : null,
        f.earnings_only ? 'earnings only' : null,
      ].filter(Boolean);
      return { lines: [chalk.bold(`news.live · ${scope.length ? scope.join(' · ') : 'every company'}`)] };
    }
    case 'news_item':
      return { lines: frame.item ? [formatNewsItem(frame.item as NewsItemRow)] : [] };
    case 'unsubscribed':
      return { lines: [], end: { code: 0, message: 'news subscription ended' } };
    case 'error': {
      if (frame.code === 'unavailable') return { lines: [chalk.dim(`unavailable: ${frame.message}; retrying`)], reconnect: true };
      const message = frame.code === 'forbidden_tier'
        ? `news.live needs the STANDARD plan (${frame.message})`
        : frame.code === 'channel_unavailable'
          ? `live news is not enabled on the API yet (${frame.message})`
          : `${frame.code}: ${frame.message}`;
      return { lines: [], end: { code: 1, message } };
    }
    default:
      return { lines: [] };
  }
}
