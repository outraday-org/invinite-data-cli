import { describe, it, expect } from 'vitest';
import {
  formatGuidanceFlash,
  formatKeywordHit,
  formatSegment,
  initialLiveState,
  isEarningsFrame,
  liveStep,
  nameFor,
  parseKeywordMatch,
  parseKeywords,
  parseSinceSeq,
  parseSpeakerRoles,
  parseTarget,
  subscribeFrame,
  type KeywordHit,
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

  it('adds the keyword fields to a call subscribe', () => {
    expect(subscribeFrame({ event_id: EVENT_ID }, -1, false, { keywords: ['tariffs'], keywordMatch: 'stem', speakerRoles: ['executive'] })).toEqual({
      type: 'subscribe', channel: 'earnings-calls.live', event_id: EVENT_ID, since_seq: -1, partials: false,
      keywords: ['tariffs'], keyword_match: 'stem', speaker_roles: ['executive'],
    });
    expect(subscribeFrame({ cik: '320193' }, -1, false, { keywords: ['tariffs'] })).not.toHaveProperty('keyword_match');
  });

  it('builds the global scope without a call target, replay or partials', () => {
    expect(subscribeFrame({ scope: 'all_live' }, -1, false, { keywords: ['tariffs'], minRank: 500 })).toEqual({
      type: 'subscribe', channel: 'earnings-calls.live', scope: 'all_live', keywords: ['tariffs'],
      events: ['keyword_hit', 'guidance_flash'], min_rank: 500,
    });
  });
});

describe('parseKeywords / parseKeywordMatch / parseSpeakerRoles', () => {
  it('trims, de-duplicates and bounds keywords', () => {
    expect(parseKeywords('tariffs, China , tariffs')).toEqual(['tariffs', 'China']);
    expect(() => parseKeywords('')).toThrow('1–20 keywords');
    expect(() => parseKeywords('a')).toThrow('2–64 characters');
    expect(() => parseKeywords(Array.from({ length: 21 }, (_, i) => `kw${i}`).join(','))).toThrow('at most 20');
  });

  it('accepts only the documented modes and roles', () => {
    expect(parseKeywordMatch(undefined)).toBeUndefined();
    expect(parseKeywordMatch('stem')).toBe('stem');
    expect(() => parseKeywordMatch('fuzzy')).toThrow('exact or stem');
    expect(parseSpeakerRoles('executive, ir_host')).toEqual(['executive', 'ir_host']);
    expect(() => parseSpeakerRoles('ceo')).toThrow('Unknown role(s): ceo');
  });
});

const HIT: KeywordHit = {
  cik: '0000320193', symbol: 'AAPL', conference_date: '2026-10-30T21:00:00.000Z', keyword: 'tariffs',
  seq: 12, start_ms: 125_000, end_ms: 130_000, text: 'Tariffs weighed on gross margin this quarter.',
  context_before: 'Turning to costs.', speaker_label: 'A', speaker_name: 'Tim Cook', speaker_role: 'executive',
  layer: 'live', latency_ms: 900,
};

describe('formatKeywordHit / formatGuidanceFlash', () => {
  it('names the speaker, the role and the time of a hit', () => {
    const line = formatKeywordHit(HIT);
    expect(line).toContain('[2:05] keyword "tariffs"');
    expect(line).toContain('Tim Cook (executive): Tariffs weighed on gross margin this quarter.');
    expect(line).not.toContain('AAPL');
    expect(formatKeywordHit(HIT, true)).toContain('AAPL [2:05]');
    expect(formatKeywordHit({ ...HIT, speaker_name: null, speaker_role: null, layer: 'final' })).toContain('keyword "tariffs" (final) · Speaker A:');
  });

  it('formats a guidance flash with its range and sentence', () => {
    const line = formatGuidanceFlash({
      symbol: 'AAPL', conference_date: '2026-10-30T21:00:00.000Z', seq: 40, revision: 2, metric: 'revenue', metric_normalized: 'Revenue',
      period_label: 'Q1 FY2027', low: 4.1, high: 4.3, point: null, unit: 'billion', currency: 'USD',
      source_sentence: 'We expect revenue in the range of $4.1 to $4.3 billion.', start_ms: 600_000,
    });
    expect(line).toContain('[10:00] guidance flash (revision 2)');
    expect(line).toContain('Revenue Q1 FY2027: USD 4.1–4.3 billion');
    expect(line).toContain('"We expect revenue in the range of $4.1 to $4.3 billion."');
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

  it('prints keyword hits and guidance flashes without moving lastSeq; a warning is never fatal', () => {
    const hit = liveStep(initialLiveState(3), { ...HIT, type: 'keyword_hit', subscription_id: 's1' }, OPTS);
    expect(hit.lines[0]).toContain('Tim Cook (executive)');
    expect(hit.state.lastSeq).toBe(3);
    expect(hit.end).toBeUndefined();
    const flash = liveStep(initialLiveState(3), { type: 'guidance_flash', subscription_id: 's1', symbol: 'AAPL', seq: 9, revision: 1, metric: 'eps', metric_normalized: null, period_label: null, low: null, high: null, point: 1.2, unit: null, currency: 'USD', source_sentence: 'EPS of $1.20.', start_ms: 1000 }, OPTS);
    expect(flash.lines[0]).toContain('eps: USD 1.2');
    const warning = liveStep(initialLiveState(3), { type: 'warning', code: 'global_scope_degraded' }, { ...OPTS, allLive: true });
    expect(warning.lines[0]).toContain('warning: global scope degraded');
    expect(warning.end).toBeUndefined();
    expect(warning.reconnect).toBeUndefined();
  });

  it('prints the global-scope header and company-prefixed hits under allLive', () => {
    const header = liveStep(initialLiveState(-1), { type: 'subscribed', subscription_id: 's1', scope: 'all_live', keywords: ['tariffs'] }, { ...OPTS, allLive: true });
    expect(header.lines[0]).toContain('all live calls · keywords: tariffs');
    expect(header.state.eventId).toBeNull();
    expect(liveStep(initialLiveState(-1), { ...HIT, type: 'keyword_hit' }, { ...OPTS, allLive: true }).lines[0]).toContain('AAPL [2:05]');
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
    expect(isEarningsFrame({ type: 'warning', code: 'global_scope_degraded' })).toBe(true);
    expect(isEarningsFrame({ ...HIT, type: 'keyword_hit' })).toBe(true);
  });
});
