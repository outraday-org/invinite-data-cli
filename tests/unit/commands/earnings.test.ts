import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
}));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { Command } from 'commander';
import { planHint, qaStartLine, registerEarningsCommands, transcriptText } from '../../../src/commands/earnings.js';
import { ApiError } from '../../../src/shared/errors.js';

const SUBCOMMANDS = [
  'calendar', 'events', 'live', 'event', 'transcript', 'versions', 'transcript-diff', 'qa',
  'participants', 'analysts', 'person', 'press-release', 'extractions', 'guidance-history',
  'diff', 'metrics', 'prosody', 'price-attribution', 'audio', 'slides', 'documents', 'search', 'stream',
];

const SELECTOR_COMMANDS = [
  'transcript', 'versions', 'transcript-diff', 'qa', 'participants', 'press-release',
  'extractions', 'diff', 'metrics', 'prosody', 'price-attribution', 'audio', 'slides', 'documents', 'stream',
];

const OUTPUT_COMMANDS = ['transcript', 'press-release', 'audio', 'slides', 'documents'];

function earningsGroup(): Command {
  const program = new Command();
  program.option('--json').option('--all');
  registerEarningsCommands(program);
  return program.commands.find(c => c.name() === 'earnings')!;
}

function optionNames(group: Command, name: string): string[] {
  const cmd = group.commands.find(c => c.name() === name)!;
  return cmd.options.map(o => o.long ?? '');
}

describe('earnings commands', () => {
  it('registers every subcommand', () => {
    const names = earningsGroup().commands.map(c => c.name());
    for (const name of SUBCOMMANDS) expect(names).toContain(name);
  });

  it('adds the selector options to the selector commands', () => {
    const group = earningsGroup();
    for (const name of SELECTOR_COMMANDS) {
      expect(optionNames(group, name)).toEqual(expect.arrayContaining(['--event', '--identifier', '--year', '--quarter', '--date']));
    }
  });

  it('gives calendar --from / --to', () => {
    expect(optionNames(earningsGroup(), 'calendar')).toEqual(expect.arrayContaining(['--from', '--to', '--status', '--session']));
  });

  it('offers --output and --force on the media and text commands', () => {
    const group = earningsGroup();
    for (const name of OUTPUT_COMMANDS) {
      expect(optionNames(group, name)).toEqual(expect.arrayContaining(['--output', '--force']));
    }
  });

  it('never registers a subcommand --version (the root program owns it)', () => {
    expect(optionNames(earningsGroup(), 'transcript')).toContain('--transcript-version');
    expect(optionNames(earningsGroup(), 'transcript')).not.toContain('--version');
  });
});

describe('transcriptText', () => {
  it('renders turns with timestamps and names', () => {
    const text = transcriptText([
      { speaker_label: 'A', name: 'Tim Cook', start_ms: 65_000, text: 'Hello.' },
      { speaker_label: 'B', name: null, start_ms: null, text: 'Hi.' },
    ], 'speakers');
    expect(text).toBe('[1:05] Tim Cook: Hello.\n\nSpeaker B: Hi.');
  });

  it('passes text through and heads sections', () => {
    expect(transcriptText('plain', 'text')).toBe('plain');
    expect(transcriptText({ prepared_remarks: 'P', questions_and_answers: null }, 'sections')).toContain('## Prepared remarks');
  });
});

describe('qaStartLine', () => {
  it('formats the Q&A boundary and stays silent without one', () => {
    expect(qaStartLine(1_234_000)).toBe('Q&A starts at 20:34');
    expect(qaStartLine(null)).toBeUndefined();
  });
});

describe('planHint', () => {
  it('names the plan of a 403 tier denial', () => {
    const error = new ApiError(403, 'Forbidden', 'This endpoint requires PRO plan. Your current plan is LITE.');
    expect(planHint(error)).toContain('PRO plan');
  });

  it('stays silent for other errors', () => {
    expect(planHint(new ApiError(503, 'audio_disabled', 'Audio is not enabled'))).toBeUndefined();
    expect(planHint(new ApiError(403, 'Forbidden', 'Not a member of the requested team'))).toBeUndefined();
  });
});

describe('earnings requests', () => {
  let logs: string[];

  const run = (...args: string[]) => {
    const root = new Command();
    root.exitOverride().option('--json').option('--all');
    registerEarningsCommands(root);
    return root.parseAsync(['node', 'invd', 'earnings', ...args]);
  };

  const json = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const url = (i = 0) => new URL((fetch as any).mock.calls[i][0]);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.log).mockRestore();
  });

  it('calendar sends one status= per value and the snake_case names', async () => {
    (fetch as any).mockResolvedValueOnce(json({ from: 'a', to: 'b', events: [] }));
    await run('calendar', '--status', 'confirmed,estimated', '--event-type', 'agm', '-l', '5');
    expect(url().pathname).toBe('/v1/earnings-calls/calendar');
    expect(url().searchParams.getAll('status')).toEqual(['confirmed', 'estimated']);
    expect(url().searchParams.get('event_type')).toBe('agm');
    expect(url().searchParams.get('limit')).toBe('5');
  });

  it('calendar and events accept --event-type all', async () => {
    (fetch as any)
      .mockResolvedValueOnce(json({ from: 'a', to: 'b', events: [] }))
      .mockResolvedValueOnce(json({ symbol: 'AAPL', cik: '320193', covered: true, events: [] }));
    await run('calendar', '--event-type', 'all');
    await run('events', '-i', 'AAPL', '--event-type', 'all');
    expect(url(0).searchParams.get('event_type')).toBe('all');
    expect(url(1).pathname).toBe('/v1/earnings-calls/events');
    expect(url(1).searchParams.get('event_type')).toBe('all');
  });

  it('transcript prints the Q&A start and passes qa_start_ms through in JSON', async () => {
    const body = { event: {}, format: 'text', version: 1, qa_start_ms: 65_000, data: 'hi' };
    (fetch as any).mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json(body));
    await run('transcript', '--event', 'e1');
    expect(logs.join('\n')).toContain('Q&A starts at 1:05');
    logs = [];
    const root = new Command();
    root.exitOverride().option('--json').option('--all');
    registerEarningsCommands(root);
    await root.parseAsync(['node', 'invd', '--json', 'earnings', 'transcript', '--event', 'e1']);
    expect(JSON.parse(logs.join('\n')).qa_start_ms).toBe(65_000);
  });

  it('transcript maps the selector, --transcript-version and --as-of', async () => {
    (fetch as any).mockResolvedValueOnce(json({ event: {}, format: 'text', version: 2, data: 'hi' }));
    await run('transcript', '-i', 'AAPL', '--year', '2026', '--quarter', '4', '--transcript-version', '2', '--as-of', '2026-10-31T00:00:00Z');
    expect(url().pathname).toBe('/v1/earnings-calls/transcript');
    expect(Object.fromEntries(url().searchParams)).toEqual({
      identifier: 'AAPL', year: '2026', quarter: '4', version: '2', as_of: '2026-10-31T00:00:00Z',
    });
  });

  it('price-attribution maps the selector and prints the coincidence note with the top minutes', async () => {
    (fetch as any).mockResolvedValueOnce(json({
      event: { symbol: 'AAPL' }, anchor_kind: 't0_wallclock', anchor_lag_ms: 4_000, lag_kind: 'playlist',
      anchor_uncertainty_s: 2, session: 'post', bar_count: 1, end_of_window_return_bps: -35,
      buckets: [{ bucket: '2026-10-30T21:05:00Z', bar_start: '2026-10-30T21:05:00Z', return_bps: -35, cumulative_return_bps: -35, utterance_refs: [] }],
      top_minutes: [{ bucket: '2026-10-30T21:05:00Z', return_bps: -35, utterance_refs: [{ start_ms: 65_000, speaker_label: 'A', text: 'Gross margin will be lower.' }] }],
    }));
    await run('price-attribution', '-i', 'AAPL', '--date', '2026-10-30');
    expect(url().pathname).toBe('/v1/earnings-calls/price-attribution');
    expect(Object.fromEntries(url().searchParams)).toEqual({ identifier: 'AAPL', date: '2026-10-30' });
    const printed = logs.join('\n');
    expect(printed).toContain('not attribution of cause');
    expect(printed).toContain('[1:05] Gross margin will be lower.');
  });

  it('price-attribution marks live rows and prints only the known summary fields', async () => {
    (fetch as any).mockResolvedValueOnce(json({
      event: { symbol: 'AAPL' }, live: true, settled: false, anchor_kind: null, anchor_lag_ms: null, lag_kind: null,
      anchor_uncertainty_s: null, session: null, bar_count: 1, end_of_window_return_bps: null,
      buckets: [{ bucket: '2026-10-30T21:05:00Z', bar_start: '2026-10-30T21:05:00Z', return_bps: 12, cumulative_return_bps: 12, utterance_refs: [] }],
      top_minutes: [],
    }));
    await run('price-attribution', '--event', 'e1');
    const printed = logs.join('\n');
    expect(printed).toContain('LIVE — minute rows so far, not settled');
    expect(printed).toContain('bar_count');
    expect(printed).not.toContain('anchor_kind');
    expect(printed).not.toContain('Top minutes');
    expect(printed).toContain('Minutes');
  });

  it('extractions --all follows next_url and concatenates the kpis', async () => {
    (fetch as any)
      .mockResolvedValueOnce(json({ event: {}, kind: 'kpi', kpis: [{ seq: 1 }], next_url: 'https://api.example.com/v1/earnings-calls/extractions?event_id=e1&kind=kpi&offset=1' }))
      .mockResolvedValueOnce(json({ event: {}, kind: 'kpi', kpis: [{ seq: 2 }] }));
    const root = new Command();
    root.exitOverride().option('--json').option('--all');
    registerEarningsCommands(root);
    await root.parseAsync(['node', 'invd', '--all', '--json', 'earnings', 'extractions', '--event', 'e1', '--kind', 'kpi']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(url(1).searchParams.get('offset')).toBe('1');
    expect(JSON.parse(logs.join('\n')).kpis).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it('audio --output saves the file and never prints the signed URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invd-earnings-'));
    try {
      const signed = 'https://r2.example.com/call.mp3?X-Amz-Signature=secret';
      (fetch as any)
        .mockResolvedValueOnce(json({ event: { symbol: 'AAPL' }, url: signed, expires_at: 'x', duration_seconds: null, bytes: 3, codec: 'mp3', capture_path: null }))
        .mockResolvedValueOnce({ ok: true, status: 200, body: new Blob(['mp3']).stream() });
      const file = join(dir, 'call.mp3');
      await run('audio', '--event', 'e1', '--output', file);
      expect((fetch as any).mock.calls[1][0]).toBe(signed);
      expect((fetch as any).mock.calls[1][1]).not.toHaveProperty('headers');
      expect(await readFile(file, 'utf8')).toBe('mp3');
      expect(logs.join('\n')).not.toContain('X-Amz-Signature');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('documents --output', () => {
    let dir: string;
    let errors: string[];
    const doc = (id: string, url: string | null) => ({
      document_id: id, kind: url ? 'cfo_commentary' : 'sec_filing', content_type: 'application/pdf', url,
      source_url: url ? null : `https://www.sec.gov/${id}`,
    });

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'invd-docs-'));
      errors = [];
      vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
        errors.push(parts.map(String).join(' '));
      });
    });

    afterEach(async () => {
      vi.mocked(console.error).mockRestore();
      await rm(dir, { recursive: true, force: true });
    });

    it('warns per document without a URL and counts at the end', async () => {
      (fetch as any)
        .mockResolvedValueOnce(json({ event: {}, documents: [doc('d1', 'https://r2.example.com/d1'), doc('d2', null)] }))
        .mockResolvedValueOnce({ ok: true, status: 200, body: new Blob(['pdf']).stream() });
      await run('documents', '--event', 'e1', '--output', dir);
      expect(await readFile(join(dir, 'cfo_commentary-d1.pdf'), 'utf8')).toBe('pdf');
      expect(errors.join('\n')).toContain('Not saved: sec_filing d2 has no download URL; source: https://www.sec.gov/d2');
      expect(errors.join('\n')).toContain('1 of 2 documents saved; 1 skipped (no download URL)');
    });

    it('exits 1 when none of the listed documents could be saved', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      (fetch as any).mockResolvedValueOnce(json({ event: {}, documents: [doc('d2', null)] }));
      await run('documents', '--event', 'e1', '--output', dir);
      expect(exit).toHaveBeenCalledWith(1);
      expect(errors.join('\n')).toContain('None of the 1 documents could be downloaded');
      exit.mockRestore();
    });

    it('exits 0 for an empty list', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      (fetch as any).mockResolvedValueOnce(json({ event: {}, documents: [] }));
      await run('documents', '--event', 'e1', '--output', dir);
      expect(exit).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });
});
