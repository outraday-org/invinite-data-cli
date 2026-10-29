import { Command } from 'commander';
import { connectWebSocket, type EarningsListenOptions } from '../client/websocket-client.js';
import {
  parseKeywordMatch,
  parseKeywords,
  parseMinRank,
  parseSinceSeq,
  parseSpeakerRoles,
  parseTarget,
  type KeywordOptions,
} from '../client/earnings-live.js';
import { parseCiks, parseNewsKinds, parseNewsSources, parseTickers, type NewsListenOptions } from '../client/news-live.js';
import { withErrorHandling } from '../shared/errors.js';

export interface ListenOptions {
  earnings?: string;
  allLive?: boolean;
  sinceSeq?: string;
  partials?: boolean;
  names?: boolean;
  prices?: boolean;
  keywords?: string;
  keywordMatch?: string;
  speakerRoles?: string;
  minRank?: string;
  news?: boolean;
  tickers?: string;
  ciks?: string;
  newsKinds?: string;
  newsSources?: string;
  earningsNews?: boolean;
}

const NEWS_FLAGS = ['tickers', 'ciks', 'newsKinds', 'newsSources', 'earningsNews'] as const;

const EARNINGS_FLAGS = ['sinceSeq', 'partials', 'names', 'prices', 'keywords', 'keywordMatch', 'speakerRoles', 'minRank'] as const;

/**
 * `ws listen` options → the `news.live` subscription, or null when `--news` is absent. Refused before connecting:
 * `--news` with `--earnings` / `--all-live` or any live-call flag, and the news filters without `--news`.
 */
export function buildNewsOptions(cmdOpts: ListenOptions, json: boolean): NewsListenOptions | null {
  if (!cmdOpts.news) {
    if (NEWS_FLAGS.some(key => cmdOpts[key] !== undefined)) {
      throw new Error('--tickers, --ciks, --news-kinds, --news-sources and --earnings-news need --news');
    }
    return null;
  }
  if (cmdOpts.earnings !== undefined) throw new Error('--news and --earnings exclude each other');
  if (cmdOpts.allLive) throw new Error('--news and --all-live exclude each other');
  if (EARNINGS_FLAGS.some(key => cmdOpts[key] !== undefined)) {
    throw new Error('--since-seq, --partials, --names, --prices, --keywords, --keyword-match, --speaker-roles and --min-rank follow a live call; not with --news');
  }
  const tickers = parseTickers(cmdOpts.tickers);
  const ciks = parseCiks(cmdOpts.ciks);
  const kinds = parseNewsKinds(cmdOpts.newsKinds);
  const sources = parseNewsSources(cmdOpts.newsSources);
  return {
    ...(tickers ? { tickers } : {}),
    ...(ciks ? { ciks } : {}),
    ...(kinds ? { kinds } : {}),
    ...(sources ? { sources } : {}),
    earningsOnly: Boolean(cmdOpts.earningsNews),
    json,
  };
}

/**
 * `ws listen` options → the earnings subscription, or null for the filing stream. Mirrors the
 * API's refusals client-side: the global scope needs keywords, the alert tuning needs keywords,
 * the per-call replay / partials / names / prices need one call.
 */
export function buildListenOptions(cmdOpts: ListenOptions, json: boolean): EarningsListenOptions | null {
  const perCall = ['sinceSeq', 'partials', 'names', 'prices'] as const;
  const alerts = ['keywords', 'keywordMatch', 'speakerRoles', 'minRank'] as const;
  if (!cmdOpts.earnings && !cmdOpts.allLive) {
    if ([...perCall, ...alerts].some(key => cmdOpts[key] !== undefined)) {
      throw new Error('--since-seq, --partials, --names, --prices, --keywords, --keyword-match, --speaker-roles and --min-rank need --earnings or --all-live');
    }
    return null;
  }
  if (cmdOpts.earnings && cmdOpts.allLive) throw new Error('--earnings and --all-live exclude each other');
  if (cmdOpts.allLive && cmdOpts.keywords === undefined) throw new Error('--all-live needs --keywords (keyword alerts across every live call)');
  if (cmdOpts.keywords === undefined && (cmdOpts.keywordMatch !== undefined || cmdOpts.speakerRoles !== undefined)) {
    throw new Error('--keyword-match and --speaker-roles need --keywords');
  }
  if (cmdOpts.allLive && perCall.some(key => cmdOpts[key] !== undefined)) {
    throw new Error('--since-seq, --partials, --names and --prices follow one call; they need --earnings');
  }
  if (!cmdOpts.allLive && cmdOpts.minRank !== undefined) throw new Error('--min-rank needs --all-live');

  const keywords: KeywordOptions | undefined = cmdOpts.keywords === undefined
    ? undefined
    : {
      keywords: parseKeywords(cmdOpts.keywords),
      keywordMatch: parseKeywordMatch(cmdOpts.keywordMatch),
      speakerRoles: parseSpeakerRoles(cmdOpts.speakerRoles),
      minRank: parseMinRank(cmdOpts.minRank),
    };
  return {
    target: cmdOpts.allLive ? { scope: 'all_live' } : parseTarget(cmdOpts.earnings as string),
    sinceSeq: parseSinceSeq(cmdOpts.sinceSeq),
    partials: Boolean(cmdOpts.partials),
    names: Boolean(cmdOpts.names),
    json,
    ...(cmdOpts.prices ? { prices: true } : {}),
    ...(keywords ? { keywords } : {}),
  };
}

export function registerWsCommands(program: Command): void {
  const ws = program
    .command('ws')
    .description('WebSocket streaming');

  ws
    .command('listen')
    .description('Listen to real-time SEC filing stream, or with --earnings follow a live earnings call transcript (with --keywords: keyword alerts; --all-live: keyword alerts across every live call), or with --news new news items')
    .option('--earnings <event_id|cik>', 'Follow a live earnings call transcript (PRO): event ID (UUID) or CIK')
    .option('--all-live', 'Keyword alerts across every live call (PRO; needs --keywords)')
    .option('--since-seq <n>', 'Replay finals after this seq (default -1 = the whole call so far)')
    .option('--partials', 'Show interim segments, overwritten in place (terminal only; --json emits them)')
    .option('--names', 'Print each speaker-name snapshot')
    .option('--prices', 'Price ticks of the call\'s stock (≤ 1/s, one line updated in place; --json emits them). Coincidence, not cause')
    .option('--keywords <list>', 'Comma-separated keywords (max 20, 2–64 chars each): one keyword_hit line per mention')
    .option('--keyword-match <mode>', 'exact (default) or stem (tariff also hits "tariffs")')
    .option('--speaker-roles <list>', 'Only hits by these speakers: executive, ir_host, analyst, operator')
    .option('--min-rank <n>', 'With --all-live: only companies ranked ≤ n by market cap')
    .option('--news', 'New news items (SEC filings and company newsrooms) as they are published (STANDARD); one line each, NDJSON with --json')
    .option('--tickers <list>', 'With --news: items mentioning these tickers (≤ 50; with --ciks either matches). Default: every company')
    .option('--ciks <list>', 'With --news: items mentioning these CIKs (≤ 50, padded or not)')
    .option('--news-kinds <list>', 'With --news: only these kinds (earnings_results, guidance, m_and_a, dividend, …)')
    .option('--news-sources <list>', 'With --news: edgar (SEC filings) and / or ir (company newsrooms)')
    .option('--earnings-news', 'With --news: earnings news only (results, results dates, call announcements, guidance)')
    .action(withErrorHandling(async (cmdOpts: ListenOptions) => {
      const json = Boolean(program.opts().json);
      const news = buildNewsOptions(cmdOpts, json);
      if (news) {
        await connectWebSocket({ news });
        return;
      }
      const earnings = buildListenOptions(cmdOpts, json);
      await connectWebSocket(earnings ? { earnings } : {});
    }));
}
