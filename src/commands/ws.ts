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
import { withErrorHandling } from '../shared/errors.js';

export interface ListenOptions {
  earnings?: string;
  allLive?: boolean;
  sinceSeq?: string;
  partials?: boolean;
  names?: boolean;
  keywords?: string;
  keywordMatch?: string;
  speakerRoles?: string;
  minRank?: string;
}

/**
 * `ws listen` options → the earnings subscription, or null for the filing stream. Mirrors the
 * API's refusals client-side: the global scope needs keywords, the alert tuning needs keywords,
 * the per-call replay / partials / names need one call.
 */
export function buildListenOptions(cmdOpts: ListenOptions, json: boolean): EarningsListenOptions | null {
  const perCall = ['sinceSeq', 'partials', 'names'] as const;
  const alerts = ['keywords', 'keywordMatch', 'speakerRoles', 'minRank'] as const;
  if (!cmdOpts.earnings && !cmdOpts.allLive) {
    if ([...perCall, ...alerts].some(key => cmdOpts[key] !== undefined)) {
      throw new Error('--since-seq, --partials, --names, --keywords, --keyword-match, --speaker-roles and --min-rank need --earnings or --all-live');
    }
    return null;
  }
  if (cmdOpts.earnings && cmdOpts.allLive) throw new Error('--earnings and --all-live exclude each other');
  if (cmdOpts.allLive && cmdOpts.keywords === undefined) throw new Error('--all-live needs --keywords (keyword alerts across every live call)');
  if (cmdOpts.keywords === undefined && (cmdOpts.keywordMatch !== undefined || cmdOpts.speakerRoles !== undefined)) {
    throw new Error('--keyword-match and --speaker-roles need --keywords');
  }
  if (cmdOpts.allLive && perCall.some(key => cmdOpts[key] !== undefined)) {
    throw new Error('--since-seq, --partials and --names follow one call; they need --earnings');
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
    ...(keywords ? { keywords } : {}),
  };
}

export function registerWsCommands(program: Command): void {
  const ws = program
    .command('ws')
    .description('WebSocket streaming');

  ws
    .command('listen')
    .description('Listen to real-time SEC filing stream, or with --earnings follow a live earnings call transcript (with --keywords: keyword alerts; --all-live: keyword alerts across every live call)')
    .option('--earnings <event_id|cik>', 'Follow a live earnings call transcript (PRO): event ID (UUID) or CIK')
    .option('--all-live', 'Keyword alerts across every live call (PRO; needs --keywords)')
    .option('--since-seq <n>', 'Replay finals after this seq (default -1 = the whole call so far)')
    .option('--partials', 'Show interim segments, overwritten in place (terminal only; --json emits them)')
    .option('--names', 'Print each speaker-name snapshot')
    .option('--keywords <list>', 'Comma-separated keywords (max 20, 2–64 chars each): one keyword_hit line per mention')
    .option('--keyword-match <mode>', 'exact (default) or stem (tariff also hits "tariffs")')
    .option('--speaker-roles <list>', 'Only hits by these speakers: executive, ir_host, analyst, operator')
    .option('--min-rank <n>', 'With --all-live: only companies ranked ≤ n by market cap')
    .action(withErrorHandling(async (cmdOpts: ListenOptions) => {
      const earnings = buildListenOptions(cmdOpts, Boolean(program.opts().json));
      await connectWebSocket(earnings ? { earnings } : {});
    }));
}
