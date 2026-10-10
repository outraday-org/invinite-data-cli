import { describe, it, expect } from 'vitest';
import {
  formatSegment,
  initialLiveState,
  isEarningsFrame,
  liveStep,
  nameFor,
  parseSinceSeq,
  parseTarget,
  subscribeFrame,
  type SpeakerAssignment,
} from '../../../src/client/earnings-live.js';

const EVENT_ID = '0b9d6f43-6b1e-4c39-9d3a-2f6a3c1e8b11';
const OPTS = { partials: false, names: false };

const ASSIGNMENTS: SpeakerAssignment[] = [
  { speaker_label: 'A', from_seq: 0, to_seq: 9, name: 'Operator', role: 'operator' },
  { speaker_label: 'A', from_seq: 10, to_seq: null, name: 'Tim Cook', role: 'executive', title: 'CEO', firm: 'Apple' },
];

const segment = (seq: number, label: string | null, text: string, isFinal = true) => ({
  type: 'transcript_segment', subscription_id: 's1', event_id: EVENT_ID,
  seq, start_ms: seq * 10_000, end_ms: seq * 10_000 + 5_000, speaker_label: label, text, is_final: isFinal,
});

describe('parseTarget', () => {
  it('reads a UUID as event_id and digits as cik', () => {
    expect(parseTarget(EVENT_ID.toUpperCase())).toEqual({ event_id: EVENT_ID });
    expect(parseTarget('320193')).toEqual({ cik: '320193' });
  });

  it('rejects anything else (tickers included)', () => {
    expect(() => parseTarget('AAPL')).toThrow('event ID');
    expect(() => parseTarget('12345678901')).toThrow();
  });
});

describe('parseSinceSeq', () => {
  it('defaults to -1 and accepts integers from -1', () => {
    expect(parseSinceSeq(undefined)).toBe(-1);
    expect(parseSinceSeq('41')).toBe(41);
    expect(() => parseSinceSeq('-2')).toThrow();
    expect(() => parseSinceSeq('1.5')).toThrow();
  });
});

describe('subscribeFrame', () => {
  it('builds the earnings-calls.live subscribe', () => {
    expect(subscribeFrame({ cik: '320193' }, 7, true)).toEqual({
      type: 'subscribe', channel: 'earnings-calls.live', cik: '320193', since_seq: 7, partials: true,
    });
  });
});

describe('nameFor / formatSegment', () => {
  it('picks the assignment covering the seq', () => {
    expect(nameFor(ASSIGNMENTS, 'A', 3)).toBe('Operator');
    expect(nameFor(ASSIGNMENTS, 'A', 42)).toBe('Tim Cook');
    expect(nameFor(ASSIGNMENTS, 'B', 42)).toBeNull();
  });

  it('formats [m:ss] name: text with a Speaker fallback', () => {
    expect(formatSegment(segment(12, 'A', 'Thanks.'), ASSIGNMENTS)).toBe('[2:00] Tim Cook: Thanks.');
    expect(formatSegment(segment(1, 'C', 'Hi.'), ASSIGNMENTS)).toBe('[0:10] Speaker C: Hi.');
    expect(formatSegment(segment(1, null, 'Hi.'), [])).toBe('[0:10] Speaker: Hi.');
  });
});

describe('liveStep', () => {
  it('prints the subscribed header and keeps the event id', () => {
    const step = liveStep(initialLiveState(-1), {
      type: 'subscribed', subscription_id: 's1', event_id: EVENT_ID, cik: '0000320193',
      symbol: 'AAPL', conference_date: '2026-10-30T21:00:00.000Z', current_seq: 41, state: 'capturing',
    }, OPTS);
    expect(step.state.eventId).toBe(EVENT_ID);
    expect(step.lines[0]).toContain('AAPL 2026-10-30T21:00:00.000Z · capturing · from seq 0 (latest 41)');
  });

  it('prints finals named from the newest snapshot and advances lastSeq', () => {
    let state = liveStep(initialLiveState(-1), { type: 'speaker_names', subscription_id: 's1', event_id: EVENT_ID, revision: 2, assignments: ASSIGNMENTS }, OPTS).state;
    const step = liveStep(state, segment(11, 'A', 'Good afternoon.'), OPTS);
    expect(step.lines).toEqual(['[1:50] Tim Cook: Good afternoon.']);
    expect(step.state.lastSeq).toBe(11);
    state = liveStep(step.state, segment(4, 'A', 'Late.'), OPTS).state;
    expect(state.lastSeq).toBe(11);
  });

  it('ignores an older names revision and prints a new one only with --names', () => {
    const named = liveStep(initialLiveState(-1), { type: 'speaker_names', revision: 5, assignments: ASSIGNMENTS }, { partials: false, names: true });
    expect(named.lines.join('\n')).toContain('A → Tim Cook (CEO, Apple)');
    const older = liveStep(named.state, { type: 'speaker_names', revision: 4, assignments: [] }, { partials: false, names: true });
    expect(older.lines).toEqual([]);
    expect(older.state.names?.revision).toBe(5);
    expect(liveStep(initialLiveState(-1), { type: 'speaker_names', revision: 1, assignments: [] }, OPTS).lines).toEqual([]);
  });

  it('shows partials only with --partials and never moves lastSeq', () => {
    const partial = segment(3, 'A', 'Good aft', false);
    expect(liveStep(initialLiveState(2), partial, OPTS)).toEqual({ state: initialLiveState(2), lines: [] });
    const step = liveStep(initialLiveState(2), partial, { partials: true, names: false });
    expect(step.partial).toContain('Good aft');
    expect(step.state.lastSeq).toBe(2);
  });

  it('notes a gap without resubscribing', () => {
    const step = liveStep(initialLiveState(5), { type: 'gap', subscription_id: 's1', event_id: EVENT_ID, after_seq: 5, next_seq: 8 }, OPTS);
    expect(step.lines[0]).toContain('gap after seq 5');
    expect(step.reconnect).toBeUndefined();
    expect(step.end).toBeUndefined();
  });

  it('ends with the final-transcript hint on transcript_ready and unsubscribed', () => {
    const state = { ...initialLiveState(-1), eventId: EVENT_ID };
    const ready = liveStep(state, { type: 'transcript_ready', subscription_id: 's1', event_id: EVENT_ID, at: '2026-10-30T22:40:00Z' }, OPTS);
    expect(ready.end).toEqual({ code: 0, message: `final transcript: invd earnings transcript --event ${EVENT_ID}` });
    const unsubscribed = liveStep(state, { type: 'unsubscribed', subscription_id: 's1', reason: 'no_transcript' }, OPTS);
    expect(unsubscribed.lines[0]).toContain('no_transcript');
    expect(unsubscribed.end?.code).toBe(0);
    const notLive = liveStep(state, { type: 'unsubscribed', subscription_id: 's1', reason: 'call_not_live' }, OPTS);
    expect(notLive.end).toEqual({ code: 0, message: 'this call produces no more live segments' });
  });

  it('prints one line per lifecycle frame without ending', () => {
    for (const frame of [
      { type: 'call_started', at: 't' },
      { type: 'call_ended', at: 't', live_transcript_available: true },
      { type: 'transcript_provisional', at: 't', version: 1, word_count: 9000 },
      { type: 'rescheduled', at: 't', new_conference_date: '2026-11-02T21:00:00Z' },
    ]) {
      const step = liveStep(initialLiveState(-1), frame, OPTS);
      expect(step.lines).toHaveLength(1);
      expect(step.end).toBeUndefined();
    }
  });

  it('maps error codes to exit 1, retry or a note', () => {
    const tier = liveStep(initialLiveState(-1), { type: 'error', code: 'forbidden_tier', message: 'Live earnings-call transcripts require the PRO plan' }, OPTS);
    expect(tier.end).toMatchObject({ code: 1 });
    expect(tier.end?.message).toContain('needs the PRO plan');
    for (const code of ['not_live', 'not_found', 'subscription_limit', 'bad_message']) {
      expect(liveStep(initialLiveState(-1), { type: 'error', code, message: 'x' }, OPTS).end?.code).toBe(1);
    }
    for (const code of ['attach_failed', 'unavailable']) {
      const step = liveStep(initialLiveState(-1), { type: 'error', code, message: 'x' }, OPTS);
      expect(step.reconnect).toBe(true);
      expect(step.end).toBeUndefined();
    }
    const resume = liveStep(initialLiveState(3), { type: 'error', code: 'resume_unavailable', message: 'x', subscription_id: 's1' }, OPTS);
    expect(resume.end).toBeUndefined();
    expect(resume.reconnect).toBeUndefined();
    expect(resume.lines[0]).toContain('live delivery continues');
  });
});

describe('isEarningsFrame', () => {
  it('skips filings broadcasts', () => {
    expect(isEarningsFrame({ type: 'new_filing', filing: {} })).toBe(false);
    expect(isEarningsFrame(segment(0, 'A', 'x'))).toBe(true);
    expect(isEarningsFrame({ type: 'error', code: 'not_live', message: 'x' })).toBe(true);
  });
});
