import chalk from 'chalk';
import { formatMs } from '../formatters/time.js';

/**
 * Pure pieces of `invd ws listen --earnings`: the subscribe frame and one step per server
 * frame of IDA's `earnings-calls.live` channel (`src/routes/websocket/types/earningsMessages.ts`).
 */

export const EARNINGS_LIVE_CHANNEL = 'earnings-calls.live';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ends the run with exit 1. */
const FATAL_ERRORS = new Set(['forbidden_tier', 'not_live', 'not_found', 'subscription_limit', 'bad_message']);

/** Retried through the reconnect backoff. */
const RETRY_ERRORS = new Set(['attach_failed', 'unavailable']);

export type LiveTarget = { event_id: string } | { cik: string };

export interface SpeakerAssignment {
  speaker_label: string;
  from_seq: number;
  to_seq: number | null;
  name: string;
  role?: string;
  title?: string | null;
  firm?: string | null;
}

export interface LiveSegment {
  seq: number;
  start_ms: number;
  speaker_label: string | null;
  text: string;
  is_final: boolean;
}

export interface LiveState {
  /** Highest final seq printed (or the `since_seq` asked for): a reconnect resumes after it. */
  lastSeq: number;
  eventId: string | null;
  names: { revision: number; assignments: SpeakerAssignment[] } | null;
}

export interface LiveOptions {
  partials: boolean;
  names: boolean;
}

export interface LiveStep {
  state: LiveState;
  lines: string[];
  /** A partial to show in place of the previous one (TTY only). */
  partial?: string;
  /** Stop: exit code + a closing line. */
  end?: { code: 0 | 1; message: string };
  /** Close the socket and resubscribe through the backoff. */
  reconnect?: boolean;
}

/** `--earnings`: a UUID is an event_id, 1–10 digits a CIK. */
export function parseTarget(value: string): LiveTarget {
  const target = value.trim();
  if (UUID_RE.test(target)) return { event_id: target.toLowerCase() };
  if (/^\d{1,10}$/.test(target)) return { cik: target };
  throw new Error('--earnings takes an event ID (UUID) or a CIK (digits)');
}

/** `--since-seq`: an integer ≥ -1; default -1 (the whole call from its first final). */
export function parseSinceSeq(value: string | undefined): number {
  if (value === undefined) return -1;
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < -1) throw new Error('--since-seq takes an integer ≥ -1');
  return seq;
}

export function subscribeFrame(target: LiveTarget, sinceSeq: number, partials: boolean) {
  return { type: 'subscribe', channel: EARNINGS_LIVE_CHANNEL, ...target, since_seq: sinceSeq, partials };
}

export function initialLiveState(sinceSeq: number): LiveState {
  return { lastSeq: sinceSeq, eventId: null, names: null };
}

/** The assignment of `label` covering `seq` (the latest-starting one wins), else null. */
export function nameFor(assignments: SpeakerAssignment[], label: string | null, seq: number): string | null {
  let best: SpeakerAssignment | null = null;
  for (const a of assignments) {
    if (a.speaker_label !== label || a.from_seq > seq || (a.to_seq !== null && seq > a.to_seq)) continue;
    if (!best || a.from_seq > best.from_seq) best = a;
  }
  return best?.name ?? null;
}

/** `[m:ss] name: text`, the name from the snapshot, else `Speaker <label>`. */
export function formatSegment(segment: LiveSegment, assignments: SpeakerAssignment[]): string {
  const name = nameFor(assignments, segment.speaker_label, segment.seq)
    ?? (segment.speaker_label === null ? 'Speaker' : `Speaker ${segment.speaker_label}`);
  return `[${formatMs(segment.start_ms)}] ${name}: ${segment.text}`;
}

export function finalTranscriptHint(eventId: string | null): string {
  return `final transcript: invd earnings transcript --event ${eventId ?? '<event_id>'}`;
}

/** IDA `UNSUBSCRIBE_REASONS` → the closing line; the transcript hint only where a transcript follows. */
function unsubscribedNote(reason: string, eventId: string | null): string {
  switch (reason) {
    case 'transcript_ready':
      return finalTranscriptHint(eventId);
    case 'rescheduled':
      return 'the call was rescheduled; listen again at the new time';
    case 'no_transcript':
      return `no final transcript yet; check later with: invd earnings transcript --event ${eventId ?? '<event_id>'}`;
    default:
      return 'this call produces no more live segments';
  }
}

function namesLines(revision: number, assignments: SpeakerAssignment[]): string[] {
  return [
    chalk.dim(`speaker names (revision ${revision})`),
    ...assignments.map(a => {
      const detail = [a.title, a.firm].filter(Boolean).join(', ');
      const range = `seq ${a.from_seq}–${a.to_seq ?? '…'}`;
      return chalk.dim(`  ${a.speaker_label} → ${a.name}${detail ? ` (${detail})` : ''}${a.role ? ` [${a.role}]` : ''} ${range}`);
    }),
  ];
}

/** One server frame → the new state and what to print / do. Unknown frames are ignored. */
export function liveStep(state: LiveState, frame: Record<string, any>, opts: LiveOptions): LiveStep {
  switch (frame.type) {
    case 'subscribed': {
      const latest = frame.current_seq === null ? 'none yet' : `latest ${frame.current_seq}`;
      return {
        state: { ...state, eventId: frame.event_id },
        lines: [chalk.bold(`${frame.symbol} ${frame.conference_date} · ${frame.state} · from seq ${state.lastSeq + 1} (${latest})`)],
      };
    }
    case 'transcript_segment': {
      const assignments = state.names?.assignments ?? [];
      if (!frame.is_final) {
        return opts.partials ? { state, lines: [], partial: chalk.dim(formatSegment(frame as LiveSegment, assignments)) } : { state, lines: [] };
      }
      return {
        state: { ...state, lastSeq: Math.max(state.lastSeq, frame.seq) },
        lines: [formatSegment(frame as LiveSegment, assignments)],
      };
    }
    case 'speaker_names': {
      if (state.names && frame.revision <= state.names.revision) return { state, lines: [] };
      const names = { revision: frame.revision, assignments: frame.assignments ?? [] };
      return { state: { ...state, names }, lines: opts.names ? namesLines(names.revision, names.assignments) : [] };
    }
    // `gap` and `resume_unavailable` are notes only — never a re-subscribe. Verified against IDA
    // (invinite-data-api, 2026-10-10): a final inside a reported gap is still delivered once on
    // the SAME subscription (`deliverFinal`, src/lib/earningsLiveBridge.ts:462-476), and so are
    // gaps of a `since_seq` replay (`recordReportedGaps`, src/routes/websocket/earningsSubscriptions.ts:273).
    // `resume_unavailable` is sent after a successful `subscribed` (earningsSubscriptions.ts:286-293);
    // live delivery continues, and once the call's Ably history becomes readable the bridge
    // back-fills missed finals into the existing subscriptions (`repass`, earningsLiveBridge.ts:660-690).
    // A second subscribe would replay from the same ring and add a duplicate subscription.
    case 'gap':
      return { state, lines: [chalk.dim(`gap after seq ${frame.after_seq} (next ${frame.next_seq}); late segments still arrive`)] };
    case 'call_started':
      return { state, lines: [chalk.bold(`call started ${frame.at}`)] };
    case 'call_ended':
      return { state, lines: [chalk.bold(`call ended ${frame.at}`)] };
    case 'transcript_provisional':
      return { state, lines: [chalk.bold(`provisional transcript v${frame.version} (${frame.word_count} words, speakers not named yet)`)] };
    case 'rescheduled':
      return { state, lines: [chalk.bold(`rescheduled to ${frame.new_conference_date}`)] };
    case 'transcript_ready':
      return {
        state,
        lines: [chalk.bold(`transcript ready ${frame.at}`)],
        end: { code: 0, message: finalTranscriptHint(state.eventId) },
      };
    case 'unsubscribed':
      return {
        state,
        lines: [chalk.bold(`subscription ended: ${frame.reason}`)],
        end: { code: 0, message: unsubscribedNote(frame.reason, state.eventId) },
      };
    case 'error': {
      if (frame.code === 'resume_unavailable') {
        return { state, lines: [chalk.dim('missed segments cannot be replayed for this call; live delivery continues')] };
      }
      if (RETRY_ERRORS.has(frame.code)) {
        return { state, lines: [chalk.dim(`${frame.code}: ${frame.message}; retrying`)], reconnect: true };
      }
      const message = frame.code === 'forbidden_tier'
        ? `earnings-calls.live needs the PRO plan (${frame.message})`
        : `${frame.code}: ${frame.message}`;
      return { state, lines: [], end: { code: 1, message: FATAL_ERRORS.has(frame.code) ? message : `${message} (unknown error code)` } };
    }
    default:
      return { state, lines: [] };
  }
}

/** Frames of the earnings channel (the socket also carries `new_filing` broadcasts and pings). */
export function isEarningsFrame(frame: Record<string, any>): boolean {
  return frame.type === 'error' || frame.type === 'unsubscribed' || typeof frame.subscription_id === 'string';
}
