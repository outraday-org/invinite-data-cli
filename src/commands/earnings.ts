import { Command, Option } from 'commander';
import { join } from 'node:path';
import chalk from 'chalk';
import { apiGet } from '../client/api-client.js';
import { downloadToFile, ensureDir, extensionFor, writeTextFile } from '../client/download.js';
import { fetchAllPages } from '../client/pagination.js';
import { apiErrorHint, withErrorHandling } from '../shared/errors.js';
import { output } from '../shared/output.js';
import { setJsonMode } from '../shared/spinner.js';
import { formatJson } from '../formatters/json-formatter.js';
import { formatKeyValue, formatTable, printPaginationHint } from '../formatters/table-formatter.js';
import { formatMs } from '../formatters/time.js';

/**
 * The hand-written `invd earnings` commands: each writes a file or renders text, so none is one REST call plus one
 * view (`src/hand-written-commands.ts` rosters them). Every other `earnings` action is generated from the manifest
 * and attached to the same group (`src/spec-commands.ts`).
 */

const BASE = '/v1/earnings-calls';

/** IDA's `event_type` values (the spec's enum on the selector operations). */
const EVENT_TYPES = ['earnings_call', 'investor_day', 'conference', 'agm', 'other'];

type Row = Record<string, any>;

interface Saved {
  path: string;
  bytes: number;
}

interface SelectorOptions {
  eventId?: string;
  identifier?: string;
  year?: string;
  quarter?: string;
  date?: string;
  eventType?: string;
}

/**
 * The event selector, as the generated commands spell it (the spec's query parameters): `--event-id`, or `-i` with
 * `--year` + `--quarter` or `--date`. An incomplete selector is the API's own 400.
 */
function selectorOptions(cmd: Command): Command {
  return cmd
    .option('--event-id <event_id>', 'Event ID (wins over the other selectors)')
    .option('-i, --identifier <ticker>', 'Ticker or CIK (with --year + --quarter, or --date)')
    .option('--year <n>', 'Fiscal year of the call (with --quarter)')
    .option('--quarter <n>', 'Fiscal quarter of the call (with --year)')
    .option('--date <date>', 'Day of the call (YYYY-MM-DD): a calendar day in New York time (America/New_York); a call without a confirmed time is listed on its announced date')
    .addOption(new Option('--event-type <type>', 'Event type of the selected call').choices(EVENT_TYPES));
}

function selectorParams(opts: SelectorOptions): Record<string, string | undefined> {
  return {
    event_id: opts.eventId,
    identifier: opts.identifier,
    year: opts.year,
    quarter: opts.quarter,
    date: opts.date,
    event_type: opts.eventType,
  };
}

const run = (fn: (...args: any[]) => Promise<void>) => withErrorHandling(fn, apiErrorHint);

/** `--all`: follows `next_url` and concatenates the `documents` pages. */
async function allDocuments<T extends { documents: Row[]; next_url?: string }>(data: T, all: boolean | undefined): Promise<T> {
  if (!all) return data;
  return fetchAllPages(data, page => page.next_url, (accumulated, page) => ({
    ...page,
    documents: [...accumulated.documents, ...page.documents],
  }));
}

function eventLine(event: Row | null | undefined): string {
  if (!event) return '';
  const day = event.conference_date ?? event.scheduled_at ?? '';
  // A non-earnings event (investor day, conference, AGM) by its type and title.
  const kind = event.event_type && event.event_type !== 'earnings_call'
    ? [event.event_type.replaceAll('_', ' '), event.event_title].filter(Boolean).join(': ')
    : undefined;
  return [event.symbol ?? event.cik, event.company_name, kind, day].filter(Boolean).join(' · ');
}

function printSaved(saved: Saved): void {
  console.log(chalk.green(`Saved ${saved.path} (${saved.bytes.toLocaleString('en-US')} bytes)`));
}

function speakerName(turn: Row): string {
  return turn.name ?? `Speaker ${turn.speaker_label}`;
}

/** "Q&A starts at m:ss" for the transcript header; undefined without a Q&A boundary. */
export function qaStartLine(qaStartMs: unknown): string | undefined {
  return typeof qaStartMs === 'number' ? `Q&A starts at ${formatMs(qaStartMs)}` : undefined;
}

/** Plain-text rendering of a transcript `data` (console and `--output`); `words` stays JSON. */
export function transcriptText(data: unknown, format: string): string {
  if (typeof data === 'string') return data;
  if (format === 'words') return JSON.stringify(data, null, 2);
  if (format === 'sections') {
    const sections = data as { prepared_remarks: string | null; questions_and_answers: string | null };
    return [
      '## Prepared remarks', '', sections.prepared_remarks ?? '—', '',
      '## Questions and answers', '', sections.questions_and_answers ?? '—',
    ].join('\n');
  }
  return (data as Row[])
    .map(turn => `${turn.start_ms === null || turn.start_ms === undefined ? '' : `[${formatMs(turn.start_ms)}] `}${speakerName(turn)}: ${turn.text}`)
    .join('\n\n');
}

/** `documents --output`: the warning for a document without a signed URL. */
export function skippedDocumentWarning(doc: Row): string {
  const source = doc.source_url ? `; source: ${doc.source_url}` : '';
  return `Not saved: ${doc.kind} ${doc.document_id} has no download URL${source}`;
}

/** The document tree's spine folders (IDA `ASSET_GROUP_CATEGORIES`), for `--category` help. */
export const DOCUMENT_TREE_CATEGORIES = 'earnings, events, news, reports, presentations, governance, esg, shareholder, other';

/** `company-documents --output`: `<year | undated>-<kind>-<document_id>.<ext>` (the public shape has no content hash). */
export function companyDocumentFileName(doc: Row): string {
  return `${doc.year ?? 'undated'}-${doc.kind}-${doc.document_id}.${extensionFor(doc.content_type)}`;
}

/** Plain text of a pages JSON (`{ pages: [{ n, title, text }] }`); anything else → empty string. */
export function pagesText(pagesJson: unknown): string {
  const pages = (pagesJson as { pages?: unknown } | null | undefined)?.pages;
  if (!Array.isArray(pages)) return '';
  return pages
    .map((page: Row, index) => {
      const n = typeof page?.n === 'number' ? page.n : index + 1;
      const title = typeof page?.title === 'string' && page.title.trim() ? ` · ${page.title}` : '';
      return `## Page ${n}${title}\n\n${typeof page?.text === 'string' ? page.text : ''}`;
    })
    .join('\n\n');
}

export function registerEarningsCommands(program: Command): void {
  const earnings = program.commands.find(command => command.name() === 'earnings') ?? program.command('earnings');

  const globalOpts = () => {
    const opts = program.opts();
    if (opts.json) setJsonMode(true);
    return opts;
  };

  const selectorCommand = (name: string, description: string) =>
    selectorOptions(earnings.command(name).description(description));

  // ── Transcript ─────────────────────────────────────────────────────

  selectorCommand('transcript', 'Transcript of a call')
    .addOption(new Option('--format <format>', 'Transcript format').choices(['speakers', 'text', 'words', 'sections', 'cleaned']))
    // Not `--version`: the root program's `-V, --version` is recognised after subcommands too.
    .option('--transcript-version <n>', 'A specific published version (see `invd earnings versions`)')
    .option('--as-of <iso>', 'The version current at this instant (ISO 8601)')
    .option('-o, --output <file>', 'Save the transcript to a file')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      const data = await apiGet<Row>({
        path: `${BASE}/transcript`,
        params: { ...selectorParams(cmdOpts), format: cmdOpts.format, version: cmdOpts.transcriptVersion, as_of: cmdOpts.asOf },
      });
      const text = transcriptText(data.data, data.format);
      const saved = cmdOpts.output ? await writeTextFile(cmdOpts.output, text, { force: cmdOpts.force }) : undefined;
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · version ${data.version} (${data.version_kind}) · ${data.published_at}\n`));
        const qaStart = qaStartLine(data.qa_start_ms);
        if (qaStart) console.log(chalk.dim(`${qaStart}\n`));
        if (saved) {
          printSaved(saved);
          return;
        }
        if (data.format === 'words') {
          console.log(chalk.yellow('The words format is JSON only; use --json to pipe it.\n'));
          formatJson(data.data);
          return;
        }
        console.log(text);
      });
    }));

  selectorCommand('press-release', 'Results press release of a call')
    .option('--body', 'Include the release text')
    .option('-o, --output <file>', 'Save the release text to a file')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      const data = await apiGet<Row>({
        path: `${BASE}/press-release`,
        params: { ...selectorParams(cmdOpts), include: cmdOpts.body || cmdOpts.output ? 'body' : undefined },
      });
      let saved: Saved | undefined;
      if (cmdOpts.output) {
        if (!data.body_text) throw new Error('The press release has no text to save');
        saved = await writeTextFile(cmdOpts.output, data.body_text, { force: cmdOpts.force });
      }
      output(data, opts, () => {
        console.log(chalk.bold(`\n${data.title ?? 'Press release'}\n`));
        formatKeyValue({
          published_at: data.published_at,
          origin: data.origin,
          url: data.url,
          accession_number: data.accession_number,
          trust_tier: data.trust_tier,
        });
        if (data.participants?.length) {
          console.log(chalk.bold('\nParticipants\n'));
          formatTable(data.participants, ['name', 'title', 'role']);
        }
        if (saved) printSaved(saved);
        if (cmdOpts.body && data.body_text) console.log(`\n${data.body_text}`);
      });
    }));

  // ── Media ──────────────────────────────────────────────────────────

  selectorCommand('audio', 'Call recording (signed URL, or --output to save it)')
    .option('-o, --output <file>', 'Save the recording (e.g. call.mp3)')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      const data = await apiGet<Row>({ path: `${BASE}/audio`, params: selectorParams(cmdOpts) });
      const saved = cmdOpts.output
        ? await downloadToFile(data.url, cmdOpts.output, { force: cmdOpts.force, spinnerText: 'Downloading audio...' })
        : undefined;
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · audio\n`));
        formatKeyValue({
          duration: formatMs(data.duration_seconds === null ? null : data.duration_seconds * 1000),
          bytes: data.bytes,
          codec: data.codec,
          capture_path: data.capture_path,
          ...(saved ? {} : { expires_at: data.expires_at, url: data.url }),
        });
        if (saved) printSaved(saved);
      });
    }));

  selectorCommand('slides', 'Slide deck (signed URL, or --output to save the PDF)')
    .option('--markdown', "Include each page's extracted text")
    .option('--pages <range>', 'Page or range, e.g. 3 or 1-5')
    .option('-o, --output <file>', 'Save the deck PDF (e.g. deck.pdf)')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      const data = await apiGet<{ event: Row; deck: Row | null; slides: Row[] }>({
        path: `${BASE}/slides`,
        params: { ...selectorParams(cmdOpts), include: cmdOpts.markdown ? 'markdown' : undefined, pages: cmdOpts.pages },
      });
      let saved: Saved | undefined;
      if (cmdOpts.output) {
        if (!data.deck?.url) throw new Error('No slide deck to save for this call');
        saved = await downloadToFile(data.deck.url, cmdOpts.output, { force: cmdOpts.force, spinnerText: 'Downloading deck...' });
      }
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · slides\n`));
        if (data.deck) {
          formatKeyValue({
            pages: data.deck.pages,
            origin: data.deck.origin,
            source_url: data.deck.source_url,
            trust_tier: data.deck.trust_tier,
            ...(saved ? {} : { expires_at: data.deck.expires_at, url: data.deck.url }),
          });
        }
        if (saved) printSaved(saved);
        console.log();
        formatTable(data.slides ?? [], ['page', 'title']);
        if (cmdOpts.markdown) {
          for (const slide of data.slides ?? []) {
            if (slide.markdown) console.log(`\n${chalk.bold(`Page ${slide.page}`)}\n${slide.markdown}`);
          }
        }
      });
    }));

  selectorCommand('documents', 'Investor documents of a call (CFO commentary, data sheets, letters, filings)')
    .option('--kind <list>', 'Kinds, comma-separated (cfo_commentary, financial_data, shareholder_letter, fact_sheet, company_transcript, sec_filing, infographic, other)')
    .option('--category <list>', `Document-tree categories, comma-separated (${DOCUMENT_TREE_CATEGORIES})`)
    .option('--group <path>', 'Document-tree folder or a parent of it, e.g. earnings/fy2027/q2 or earnings')
    .option('--body', 'Include the extracted text')
    .option('-l, --limit <n>', 'Max results (1-100)')
    .option('--offset <n>', 'Offset')
    .option('-o, --output <dir>', 'Save every document into this directory as <kind>-<document_id>.<ext>; one without a download URL (link-only sec_filing) is reported on stderr, exit 1 only when none could be saved')
    .option('--force', 'Overwrite existing files in --output')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      const data = await allDocuments(await apiGet<{ event: Row; documents: Row[]; next_url?: string }>({
        path: `${BASE}/documents`,
        params: {
          ...selectorParams(cmdOpts),
          kind: cmdOpts.kind,
          category: cmdOpts.category,
          group: cmdOpts.group,
          include: cmdOpts.body ? 'body' : undefined,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      }), opts.all);
      const saved: Row[] = [];
      const skipped: Row[] = [];
      if (cmdOpts.output) {
        const dir = await ensureDir(cmdOpts.output);
        for (const doc of data.documents) {
          if (!doc.url) {
            // Link-only rows (sec_filing) and failed downloads carry no signed URL: say so, never skip silently.
            skipped.push(doc);
            console.error(chalk.yellow(skippedDocumentWarning(doc)));
            continue;
          }
          const file = join(dir, `${doc.kind}-${doc.document_id}.${extensionFor(doc.content_type)}`);
          const { path, bytes } = await downloadToFile(doc.url, file, { force: cmdOpts.force, spinnerText: `Downloading ${doc.kind}...` });
          saved.push({ document_id: doc.document_id, kind: doc.kind, path, bytes });
        }
      }
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · documents\n`));
        formatTable(data.documents, ['kind', 'group', 'title', 'content_type', 'bytes', 'pages', 'trust_tier', 'origin', 'expires_at', 'document_id']);
        if (cmdOpts.output) {
          console.log(chalk.bold('\nSaved\n'));
          formatTable(saved, ['document_id', 'kind', 'path', 'bytes']);
        } else {
          const linked = data.documents.filter(doc => doc.url);
          if (linked.length) console.log(chalk.bold('\nURLs\n'));
          for (const doc of linked) console.log(`  ${doc.document_id}  ${doc.url}`);
        }
        if (cmdOpts.body) {
          for (const doc of data.documents.filter(doc => doc.body_text)) {
            console.log(`\n${chalk.bold(doc.title ?? doc.kind)}\n${doc.body_text}`);
          }
        }
        printPaginationHint(data.next_url);
      });
      if (cmdOpts.output) {
        // stderr, like the per-document warnings, so `--json` output stays parseable.
        if (skipped.length) console.error(chalk.yellow(`${saved.length} of ${data.documents.length} documents saved; ${skipped.length} skipped (no download URL)`));
        if (saved.length === 0 && data.documents.length > 0) {
          throw new Error(`None of the ${data.documents.length} documents could be downloaded`);
        }
      }
    }));

  // ── Company documents (IR library) ─────────────────────────────────

  earnings
    .command('company-documents')
    .description("A company's IR documents (annual reports, proxy, ESG, investor-day decks, letters, webcast pages)")
    .requiredOption('-i, --identifier <ticker>', 'Ticker or CIK')
    .option('--section <list>', 'IR sections, comma-separated (quarterly_results, events_archive, presentations_archive, annual_reports, proxy, sec_filings, press_releases, esg, governance, faq, other)')
    .option('--kind <list>', 'Kinds, comma-separated (annual_report, proxy_statement, esg_report, investor_day_deck, conference_presentation, shareholder_letter, fact_sheet, webcast, …)')
    .option('--year <n>', 'Year the document belongs to')
    .option('--period <period>', 'Period within the year (Q1-Q4, H1, H2, FY)')
    .option('--category <list>', `Document-tree categories, comma-separated (${DOCUMENT_TREE_CATEGORIES})`)
    .option('--group <path>', 'Document-tree folder or a parent of it, e.g. earnings/fy2027/q2, esg or shareholder/tax')
    .option('--fiscal-year <n>', 'Only the earnings folders of this fiscal year (earnings/fy<YYYY>/…)')
    .option('--fiscal-quarter <n>', 'Only the earnings folders of this fiscal quarter (1-4)')
    .option('--event-id <event_id>', 'Only the documents of this event (investor day, conference, AGM)')
    .option('-l, --limit <n>', 'Max results (1-100)')
    .option('--offset <n>', 'Offset')
    .option('-o, --output <dir>', 'Save every stored file into this directory as <year>-<kind>-<document_id>.<ext>; a link-only row (webcast) is reported on stderr, exit 1 only when none could be saved')
    .option('--force', 'Overwrite existing files in --output')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await allDocuments(await apiGet<{ company: Row; documents: Row[]; next_url?: string }>({
        path: `${BASE}/company-documents`,
        params: {
          identifier: cmdOpts.identifier,
          section: cmdOpts.section,
          kind: cmdOpts.kind,
          year: cmdOpts.year,
          period: cmdOpts.period,
          category: cmdOpts.category,
          group: cmdOpts.group,
          fiscal_year: cmdOpts.fiscalYear,
          fiscal_quarter: cmdOpts.fiscalQuarter,
          event_id: cmdOpts.eventId,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      }), opts.all);
      const saved: Row[] = [];
      const skipped: Row[] = [];
      if (cmdOpts.output) {
        const dir = await ensureDir(cmdOpts.output);
        for (const doc of data.documents) {
          if (!doc.url) {
            // Link-only rows (webcast replay pages) carry no signed URL: say so, never skip silently.
            skipped.push(doc);
            console.error(chalk.yellow(skippedDocumentWarning(doc)));
            continue;
          }
          const { path, bytes } = await downloadToFile(doc.url, join(dir, companyDocumentFileName(doc)), {
            force: cmdOpts.force,
            spinnerText: `Downloading ${doc.kind}...`,
          });
          saved.push({ document_id: doc.document_id, kind: doc.kind, path, bytes });
        }
      }
      output(data, opts, () => {
        console.log(chalk.bold(`\n${data.company?.symbol ?? cmdOpts.identifier} (${data.company?.cik ?? ''}) IR documents\n`));
        console.log(chalk.dim('Company-published material, shown as published.\n'));
        formatTable(data.documents, ['document_id', 'kind', 'group', 'section', 'year', 'period', 'title', 'pages']);
        if (cmdOpts.output) {
          console.log(chalk.bold('\nSaved\n'));
          formatTable(saved, ['document_id', 'kind', 'path', 'bytes']);
        }
        printPaginationHint(data.next_url);
      });
      if (cmdOpts.output) {
        if (skipped.length) console.error(chalk.yellow(`${saved.length} of ${data.documents.length} documents saved; ${skipped.length} skipped (no download URL)`));
        if (saved.length === 0 && data.documents.length > 0) {
          throw new Error(`None of the ${data.documents.length} documents could be downloaded`);
        }
      }
    }));

  earnings
    .command('document')
    .description('One company IR document (metadata and signed URLs, or --pages for its text)')
    .requiredOption('--document-id <document_id>', 'Document ID (from company-documents or document-search)')
    .option('--pages', 'Print the per-page text')
    .option('-o, --output <file>', 'Save the file (or, with --pages, the text)')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await apiGet<{ company: Row; document: Row }>({
        path: `${BASE}/company-documents/${encodeURIComponent(cmdOpts.documentId)}`,
        params: { include: cmdOpts.pages ? 'pages' : undefined },
      });
      const doc = data.document;
      let text: string | undefined;
      if (cmdOpts.pages) {
        // Inline up to 2 MB; else the signed pages file (a bearer URL: plain GET, no Authorization header).
        let pagesJson = doc.pages_json;
        if (pagesJson === undefined && doc.pages_url) {
          const response = await fetch(doc.pages_url);
          if (!response.ok) throw new Error(`Fetching the page text failed with status ${response.status}`);
          pagesJson = await response.json();
          // `--json` then carries the text too, as with the inline answer.
          doc.pages_json = pagesJson;
        }
        text = pagesText(pagesJson);
        if (!text) throw new Error('No text extracted for this document yet');
      }
      let saved: Saved | undefined;
      if (cmdOpts.output) {
        if (text !== undefined) {
          saved = await writeTextFile(cmdOpts.output, text, { force: cmdOpts.force });
        } else {
          if (!doc.url) throw new Error(`No stored file for this document; source: ${doc.source_url}`);
          saved = await downloadToFile(doc.url, cmdOpts.output, { force: cmdOpts.force, spinnerText: `Downloading ${doc.kind}...` });
        }
      }
      output(data, opts, () => {
        console.log(chalk.bold(`\n${doc.title ?? doc.kind} · ${data.company?.symbol ?? ''}\n`));
        // The metadata without the inline text; a saved file prints its path instead of the signed URLs.
        const hidden = new Set(saved ? ['pages_json', 'url', 'pages_url'] : ['pages_json']);
        formatKeyValue(Object.fromEntries(Object.entries(doc).filter(([key]) => !hidden.has(key))));
        if (saved) printSaved(saved);
        else if (text !== undefined) console.log(`\n${text}`);
      });
    }));

}
