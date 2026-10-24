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
import {
  companyDocumentFileName, pagesText, qaStartLine, registerEarningsCommands, transcriptText,
} from '../../../src/commands/earnings.js';
import { ApiError, apiErrorHint } from '../../../src/shared/errors.js';

const SUBCOMMANDS = ['transcript', 'press-release', 'audio', 'slides', 'documents', 'company-documents', 'document'];

const SELECTOR_COMMANDS = ['transcript', 'press-release', 'audio', 'slides', 'documents'];

const OUTPUT_COMMANDS = ['transcript', 'press-release', 'audio', 'slides', 'documents', 'company-documents', 'document'];

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
      expect(optionNames(group, name)).toEqual(expect.arrayContaining(['--event-id', '--identifier', '--year', '--quarter', '--date', '--event-type']));
    }
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

describe('company document helpers', () => {
  it('names a saved file <year>-<kind>-<document_id>.<ext>, undated without a year', () => {
    expect(companyDocumentFileName({ year: 2025, kind: 'annual_report', document_id: 'd1', content_type: 'application/pdf' }))
      .toBe('2025-annual_report-d1.pdf');
    expect(companyDocumentFileName({ year: null, kind: 'fact_sheet', document_id: 'd2', content_type: 'application/pdf' }))
      .toBe('undated-fact_sheet-d2.pdf');
  });

  it('renders the pages JSON as text and tolerates anything else', () => {
    expect(pagesText({ pages: [{ n: 1, title: 'Cover', text: 'Hello' }, { text: 'Two' }] }))
      .toBe('## Page 1 · Cover\n\nHello\n\n## Page 2\n\nTwo');
    expect(pagesText(undefined)).toBe('');
    expect(pagesText({ pages: 'x' })).toBe('');
  });
});

describe('apiErrorHint', () => {
  it('names the plan of a 403 tier denial and points a 401 at invd login', () => {
    const error = new ApiError(403, 'Forbidden', 'This endpoint requires PRO plan. Your current plan is LITE.');
    expect(apiErrorHint(error)).toBe('This route needs the PRO plan');
    expect(apiErrorHint(new ApiError(401, 'Unauthorized', 'Invalid API key'))).toBe('Run: invd login');
  });

  it('stays silent for other errors', () => {
    expect(apiErrorHint(new ApiError(503, 'audio_disabled', 'Audio is not enabled'))).toBeUndefined();
    expect(apiErrorHint(new ApiError(403, 'Forbidden', 'This account is blocked'))).toBeUndefined();
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

  it('company-documents maps its filters and prints the table without signed URLs', async () => {
    (fetch as any).mockResolvedValueOnce(json({
      company: { cik: '0000000001', symbol: 'ACME', name: 'Acme' },
      documents: [{ document_id: 'd1', kind: 'annual_report', section: 'annual_reports', year: 2025, period: 'FY', title: 'Annual Report', pages: 120, url: 'https://r2.example.com/a.pdf?X-Amz-Signature=secret' }],
    }));
    await run('company-documents', '-i', 'ACME', '--section', 'annual_reports,proxy', '--kind', 'annual_report', '--year', '2025', '--event-id', 'e1', '-l', '20');
    expect(url().pathname).toBe('/v1/earnings-calls/company-documents');
    expect(Object.fromEntries(url().searchParams)).toEqual({
      identifier: 'ACME', section: 'annual_reports,proxy', kind: 'annual_report', year: '2025', event_id: 'e1', limit: '20',
    });
    const printed = logs.join('\n');
    expect(printed).toContain('ACME (0000000001) IR documents');
    expect(printed).toContain('Annual Report');
    expect(printed).not.toContain('X-Amz-Signature');
  });

  it('company-documents --include calls asks for the calls\' documents and shows each row\'s source', async () => {
    (fetch as any).mockResolvedValueOnce(json({
      company: { cik: '0000000001', symbol: 'ACME', name: 'Acme' },
      documents: [
        { document_id: 'd1', source: 'company', kind: 'annual_report', group: 'reports/2025', year: 2025, title: 'Annual Report' },
        { document_id: 'd2', source: 'call', kind: 'cfo_commentary', group: 'earnings/fy2027/q2', section: null, year: 2027, period: 'Q2', title: 'CFO Commentary' },
      ],
    }));
    await run('company-documents', '-i', 'ACME', '--include', 'calls');
    expect(Object.fromEntries(url().searchParams)).toEqual({ identifier: 'ACME', include: 'calls' });
    const printed = logs.join('\n');
    expect(printed).toContain('CFO Commentary');
    expect(printed).toContain('earnings/fy2027/q2');
    expect(printed).toMatch(/call/);
  });

  it('document --pages prints the inline page text', async () => {
    (fetch as any).mockResolvedValueOnce(json({
      company: { symbol: 'ACME' },
      document: { document_id: 'd1', kind: 'annual_report', title: 'Annual Report', pages_json: { pages: [{ n: 3, title: 'Strategy', text: 'Capital allocation.' }] } },
    }));
    await run('document', '--document-id', 'd1', '--pages');
    expect(url().pathname).toBe('/v1/earnings-calls/company-documents/d1');
    expect(url().searchParams.get('include')).toBe('pages');
    expect(fetch).toHaveBeenCalledTimes(1);
    const printed = logs.join('\n');
    expect(printed).toContain('## Page 3 · Strategy');
    expect(printed).toContain('Capital allocation.');
  });

  it('document --pages reads a large pages file from its signed URL without the API key', async () => {
    const signed = 'https://r2.example.com/a.pdf.pages.json?X-Amz-Signature=secret';
    (fetch as any)
      .mockResolvedValueOnce(json({ company: { symbol: 'ACME' }, document: { document_id: 'd1', kind: 'annual_report', title: null, pages_url: signed } }))
      .mockResolvedValueOnce(json({ pages: [{ n: 1, text: 'Big file.' }] }));
    await run('document', '--document-id', 'd1', '--pages');
    expect((fetch as any).mock.calls[1][0]).toBe(signed);
    expect((fetch as any).mock.calls[1][1]).toBeUndefined();
    expect(logs.join('\n')).toContain('Big file.');
  });

  it('transcript prints the Q&A start and passes qa_start_ms through in JSON', async () => {
    const body = { event: {}, format: 'text', version: 1, qa_start_ms: 65_000, data: 'hi' };
    (fetch as any).mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json(body));
    await run('transcript', '--event-id', 'e1');
    expect(logs.join('\n')).toContain('Q&A starts at 1:05');
    logs = [];
    const root = new Command();
    root.exitOverride().option('--json').option('--all');
    registerEarningsCommands(root);
    await root.parseAsync(['node', 'invd', '--json', 'earnings', 'transcript', '--event-id', 'e1']);
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

  it('audio --output saves the file and never prints the signed URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invd-earnings-'));
    try {
      const signed = 'https://r2.example.com/call.mp3?X-Amz-Signature=secret';
      (fetch as any)
        .mockResolvedValueOnce(json({ event: { symbol: 'AAPL' }, url: signed, expires_at: 'x', duration_seconds: null, bytes: 3, codec: 'mp3', capture_path: null }))
        .mockResolvedValueOnce({ ok: true, status: 200, body: new Blob(['mp3']).stream() });
      const file = join(dir, 'call.mp3');
      await run('audio', '--event-id', 'e1', '--output', file);
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
      await run('documents', '--event-id', 'e1', '--output', dir);
      expect(await readFile(join(dir, 'cfo_commentary-d1.pdf'), 'utf8')).toBe('pdf');
      expect(errors.join('\n')).toContain('Not saved: sec_filing d2 has no download URL; source: https://www.sec.gov/d2');
      expect(errors.join('\n')).toContain('1 of 2 documents saved; 1 skipped (no download URL)');
    });

    it('exits 1 when none of the listed documents could be saved', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      (fetch as any).mockResolvedValueOnce(json({ event: {}, documents: [doc('d2', null)] }));
      await run('documents', '--event-id', 'e1', '--output', dir);
      expect(exit).toHaveBeenCalledWith(1);
      expect(errors.join('\n')).toContain('None of the 1 documents could be downloaded');
      exit.mockRestore();
    });

    it('company-documents --output saves <year>-<kind>-<id> and warns on a link-only row', async () => {
      (fetch as any)
        .mockResolvedValueOnce(json({
          company: { symbol: 'ACME', cik: '1' },
          documents: [
            { document_id: 'd1', kind: 'annual_report', year: 2025, content_type: 'application/pdf', url: 'https://r2.example.com/d1' },
            { document_id: 'd2', kind: 'webcast', year: 2026, content_type: null, url: null, source_url: 'https://ir.example.com/replay' },
          ],
        }))
        .mockResolvedValueOnce({ ok: true, status: 200, body: new Blob(['pdf']).stream() });
      await run('company-documents', '-i', 'ACME', '--output', dir);
      expect(await readFile(join(dir, '2025-annual_report-d1.pdf'), 'utf8')).toBe('pdf');
      expect(errors.join('\n')).toContain('Not saved: webcast d2 has no download URL; source: https://ir.example.com/replay');
      expect(errors.join('\n')).toContain('1 of 2 documents saved; 1 skipped (no download URL)');
    });

    it('exits 0 for an empty list', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      (fetch as any).mockResolvedValueOnce(json({ event: {}, documents: [] }));
      await run('documents', '--event-id', 'e1', '--output', dir);
      expect(exit).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });
});
