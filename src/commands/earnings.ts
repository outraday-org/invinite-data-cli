import { Command, Option } from 'commander';
import { join } from 'node:path';
import chalk from 'chalk';
import { apiGet } from '../client/api-client.js';
import { downloadToFile, ensureDir, extensionFor, writeTextFile } from '../client/download.js';
import { fetchAllPages } from '../client/pagination.js';
import { ApiError, withErrorHandling } from '../shared/errors.js';
import { output } from '../shared/output.js';
import { splitList } from '../shared/options.js';
import { setJsonMode } from '../shared/spinner.js';
import { formatJson } from '../formatters/json-formatter.js';
import { formatKeyValue, formatTable, printPaginationHint } from '../formatters/table-formatter.js';
import { flattenRows } from '../formatters/flatten.js';
import { formatMs } from '../formatters/time.js';
import { selectorOptions, selectorParams, validateSelector, type SelectorOptions } from './earnings-selector.js';

const BASE = '/v1/earnings-calls';

const EVENT_COLUMNS = [
  'scheduled_at', 'symbol', 'company_name', 'fiscal_year', 'fiscal_quarter', 'session',
  'date_status', 'capture_status', 'has_transcript', 'has_audio', 'has_slides', 'event_id',
];

const SEARCH_TEXT_MAX = 120;

/** IDA's `event_type` filter values (`EVENT_TYPE_FILTERS`): one stored type, or `all`. */
const EVENT_TYPE_FILTERS = ['earnings_call', 'investor_day', 'conference', 'agm', 'other', 'all'];

type Row = Record<string, any>;

interface Saved {
  path: string;
  bytes: number;
}

/** One dim line after a 403 whose message names the plan the route needs. */
export function planHint(error: ApiError): string | undefined {
  if (error.statusCode !== 403) return undefined;
  const tier = /requires (?:the )?(\w+) plan/i.exec(error.message)?.[1];
  return tier ? `This route needs the ${tier} plan; see invd earnings --help` : undefined;
}

const run = (fn: (...args: any[]) => Promise<void>) => withErrorHandling(fn, planHint);

/** `--all`: follows `next_url` and concatenates the page arrays under `key`. */
async function paginate<T extends { next_url?: string }>(data: T, key: keyof T, all?: boolean): Promise<T> {
  if (!all || !data.next_url) return data;
  return fetchAllPages(data,
    d => d.next_url,
    (acc, page) => ({
      ...page,
      [key]: [...((acc[key] as unknown[] | undefined) ?? []), ...((page[key] as unknown[] | undefined) ?? [])],
    }) as T,
  );
}

function eventLine(event: Row | null | undefined): string {
  if (!event) return '';
  const day = event.conference_date ?? event.scheduled_at ?? '';
  return [event.symbol ?? event.cik, event.company_name, day].filter(Boolean).join(' · ');
}

function printSaved(saved: Saved): void {
  console.log(chalk.green(`Saved ${saved.path} (${saved.bytes.toLocaleString('en-US')} bytes)`));
}

/** `*_ms` numbers → `m:ss` for key / value output. */
function humanizeMs(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, key.endsWith('_ms') && typeof value === 'number' ? formatMs(value) : value]));
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

export function registerEarningsCommands(program: Command): void {
  const earnings = program
    .command('earnings')
    .description('Earnings calls: calendar, transcripts, audio, slides, guidance, Q&A, search');

  const globalOpts = () => {
    const opts = program.opts();
    if (opts.json) setJsonMode(true);
    return opts;
  };

  const selectorCommand = (name: string, description: string) =>
    selectorOptions(earnings.command(name).description(description));

  // ── Calendar / events ──────────────────────────────────────────────

  earnings
    .command('calendar')
    .description('Upcoming and recent earnings calls across companies')
    .option('--from <date>', 'First New York day (YYYY-MM-DD, default today)')
    .option('--to <date>', 'Last New York day (YYYY-MM-DD, default from + 14 days, at most 92)')
    .option('--status <list>', 'Date statuses, comma-separated (estimated, unconfirmed, confirmed, postponed, cancelled)')
    .addOption(new Option('--session <session>', 'Session').choices(['bmo', 'amc', 'intraday']))
    .option('--exchange <exchange>', 'Exchange')
    .addOption(new Option('--event-type <type>', 'Event type (default earnings_call; all = every type)').choices(EVENT_TYPE_FILTERS))
    .addOption(new Option('-s, --sort <dir>', 'Sort direction').choices(['asc', 'desc']))
    .option('-l, --limit <n>', 'Max results (1-500)')
    .option('--offset <n>', 'Offset')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await paginate(await apiGet<{ from: string; to: string; events: Row[]; next_url?: string }>({
        path: `${BASE}/calendar`,
        params: {
          from: cmdOpts.from,
          to: cmdOpts.to,
          // IDA's `status` is an array parameter: one `status=` per value, never one comma string.
          status: splitList(cmdOpts.status),
          session: cmdOpts.session,
          exchange: cmdOpts.exchange,
          event_type: cmdOpts.eventType,
          sort: cmdOpts.sort,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      }), 'events', opts.all);
      output(data, opts, () => {
        console.log(chalk.bold(`\nEarnings calendar ${data.from} … ${data.to}\n`));
        formatTable(data.events, EVENT_COLUMNS);
        printPaginationHint(data.next_url);
      });
    }));

  earnings
    .command('events')
    .description("A company's earnings calls")
    .requiredOption('-i, --identifier <ticker>', 'Ticker or CIK')
    .option('--from <date>', 'Calls on or after this New York day (YYYY-MM-DD)')
    .option('--to <date>', 'Calls on or before this New York day (YYYY-MM-DD)')
    .addOption(new Option('--event-type <type>', 'Event type (default all)').choices(EVENT_TYPE_FILTERS))
    .option('--observations', 'Include the date / time observations per call')
    .addOption(new Option('-s, --sort <dir>', 'Sort direction').choices(['asc', 'desc']))
    .option('-l, --limit <n>', 'Max results (1-200)')
    .option('--offset <n>', 'Offset')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await paginate(await apiGet<{ symbol: string; cik: string; covered: boolean; events: Row[]; next_url?: string }>({
        path: `${BASE}/events`,
        params: {
          identifier: cmdOpts.identifier,
          from: cmdOpts.from,
          to: cmdOpts.to,
          event_type: cmdOpts.eventType,
          include: cmdOpts.observations ? 'observations' : undefined,
          sort: cmdOpts.sort,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      }), 'events', opts.all);
      output(data, opts, () => {
        console.log(chalk.bold(`\n${data.symbol} (${data.cik}) Earnings Calls\n`));
        if (!data.covered) console.log(chalk.yellow('Not covered by the earnings-calls pipeline.\n'));
        formatTable(data.events, EVENT_COLUMNS);
        printPaginationHint(data.next_url);
      });
    }));

  earnings
    .command('live')
    .description('Calls being captured right now')
    .action(run(async () => {
      const opts = globalOpts();
      const data = await apiGet<{ as_of: string; events: Row[] }>({ path: `${BASE}/live` });
      output(data, opts, () => {
        console.log(chalk.bold(`\nLive earnings calls (as of ${data.as_of})\n`));
        formatTable(data.events, [...EVENT_COLUMNS, 'live_audio']);
      });
    }));

  earnings
    .command('event')
    .description('One earnings call with its date / time observations')
    .argument('<event_id>', 'Event ID')
    .action(run(async (eventId: string) => {
      const opts = globalOpts();
      const data = await apiGet<Row>({ path: `${BASE}/event/${encodeURIComponent(eventId)}` });
      output(data, opts, () => {
        const { observations, ...event } = data;
        console.log(chalk.bold(`\n${eventLine(event)}\n`));
        formatKeyValue(event);
        if (observations?.length) {
          console.log(chalk.bold('\nObservations\n'));
          formatTable(observations, ['observed_source', 'observed_at', 'starts_at', 'tz', 'status_hint', 'announcement_kind']);
        }
      });
    }));

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
      validateSelector(cmdOpts);
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

  selectorCommand('versions', 'Published transcript versions of a call')
    .action(run(async (cmdOpts: SelectorOptions) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<{ event_id: string; current_version: number; versions: Row[] }>({
        path: `${BASE}/transcript/versions`,
        params: selectorParams(cmdOpts),
      });
      output(data, opts, () => {
        console.log(chalk.bold(`\nTranscript versions (current: ${data.current_version})\n`));
        formatTable(data.versions, ['version', 'version_kind', 'published_at', 'word_count', 'change_note', 'corrected_by']);
      });
    }));

  selectorCommand('transcript-diff', 'Word diff between two transcript versions')
    .requiredOption('--from <n>', 'Older version')
    .option('--to <n>', 'Newer version (default: the current one)')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<{ from: number; to: number; changes: Row[]; truncated: boolean; stats: Row }>({
        path: `${BASE}/transcript/diff`,
        params: { ...selectorParams(cmdOpts), from: cmdOpts.from, to: cmdOpts.to },
      });
      output(data, opts, () => {
        console.log(chalk.bold(`\nTranscript diff v${data.from} → v${data.to}\n`));
        formatTable(data.changes.map(c => ({ ...c, at_ms: formatMs(c.at_ms) })), ['op', 'at_ms', 'text']);
        console.log(`\n+${data.stats.added_words} / -${data.stats.removed_words} words${data.truncated ? chalk.yellow(' (truncated)') : ''}`);
      });
    }));

  selectorCommand('qa', 'Q&A pairs of a call')
    .option('-l, --limit <n>', 'Max pairs (1-200)')
    .option('--offset <n>', 'Offset')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await paginate(await apiGet<{ event_id: string; pairs: Row[]; next_url?: string }>({
        path: `${BASE}/qa`,
        params: { ...selectorParams(cmdOpts), limit: cmdOpts.limit, offset: cmdOpts.offset },
      }), 'pairs', opts.all);
      output(data, opts, () => {
        if (data.pairs.length === 0) console.log(chalk.yellow('No results.'));
        for (const pair of data.pairs) {
          const analyst = pair.analyst ?? {};
          const firm = analyst.firm ? ` (${analyst.firm})` : '';
          const followUp = pair.is_follow_up ? chalk.dim(' follow-up') : '';
          console.log(chalk.bold(`\n#${pair.seq} ${speakerName(analyst)}${firm}`) + followUp + chalk.dim(` [${formatMs(pair.question_start_ms)}]`));
          console.log(`  Q: ${pair.question}`);
          const answeredBy = (pair.answers ?? []).map(speakerName).join(', ');
          console.log(`    A${answeredBy ? ` (${answeredBy})` : ''}: ${pair.answer}`);
        }
        printPaginationHint(data.next_url);
      });
    }));

  selectorCommand('participants', 'Speakers of a call')
    .option('--evidence', 'Include the quotes each name was resolved from')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<{ participants: Row[]; participation_events: Row[] }>({
        path: `${BASE}/participants`,
        params: { ...selectorParams(cmdOpts), include: cmdOpts.evidence ? 'evidence' : undefined },
      });
      output(data, opts, () => {
        console.log(chalk.bold('\nParticipants\n'));
        formatTable(data.participants, ['speaker_label', 'name', 'title', 'firm', 'role', 'confidence', 'resolved_by']);
        if (cmdOpts.evidence) {
          for (const p of data.participants.filter(p => p.evidence?.length)) {
            console.log(chalk.bold(`\n${speakerName(p)}`));
            for (const e of p.evidence) console.log(`  [${formatMs(e.start_ms)}] "${e.quote}"`);
          }
        }
        if (data.participation_events?.length) {
          console.log(chalk.bold('\nParticipation flags\n'));
          formatTable(data.participation_events, ['kind', 'person_id', 'event_id']);
        }
      });
    }));

  // ── People ─────────────────────────────────────────────────────────

  earnings
    .command('analysts')
    .description("Analysts on a company's calls")
    .requiredOption('-i, --identifier <ticker>', 'Ticker or CIK')
    .option('-l, --limit <n>', 'Max results (1-100)')
    .option('--offset <n>', 'Offset')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await paginate(await apiGet<{ symbol: string; cik: string; analysts: Row[]; next_url?: string }>({
        path: `${BASE}/analysts`,
        params: { identifier: cmdOpts.identifier, limit: cmdOpts.limit, offset: cmdOpts.offset },
      }), 'analysts', opts.all);
      output(data, opts, () => {
        console.log(chalk.bold(`\n${data.symbol} (${data.cik}) Analysts\n`));
        formatTable(data.analysts, ['name', 'firm', 'appearances', 'questions', 'first_seen', 'last_seen', 'person_id']);
        printPaginationHint(data.next_url);
      });
    }));

  earnings
    .command('person')
    .description("One person's call appearances")
    .argument('<person_id>', 'Person ID')
    .option('-l, --limit <n>', 'Max appearances (1-200)')
    .option('--offset <n>', 'Offset')
    .action(run(async (personId: string, cmdOpts) => {
      const opts = globalOpts();
      const data = await paginate(await apiGet<Row & { appearances: Row[]; next_url?: string }>({
        path: `${BASE}/people/${encodeURIComponent(personId)}`,
        params: { limit: cmdOpts.limit, offset: cmdOpts.offset },
      }), 'appearances', opts.all);
      output(data, opts, () => {
        console.log(chalk.bold(`\n${data.name ?? data.person_id}\n`));
        formatKeyValue({
          kind: data.kind,
          current_firm: data.current_firm,
          current_title: data.current_title,
          appearance_count: data.appearance_count,
          aliases: data.aliases,
        });
        console.log(chalk.bold('\nAppearances\n'));
        formatTable(data.appearances, [
          'scheduled_at', 'symbol', 'company_name', 'fiscal_year', 'fiscal_quarter',
          'role', 'title', 'firm', 'word_count', 'question_count', 'event_id',
        ]);
        printPaginationHint(data.next_url);
      });
    }));

  // ── Press release / extractions / guidance ─────────────────────────

  selectorCommand('press-release', 'Results press release of a call')
    .option('--body', 'Include the release text')
    .option('-o, --output <file>', 'Save the release text to a file')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
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

  selectorCommand('extractions', 'Guidance or KPI extractions of a call')
    .addOption(new Option('--kind <kind>', 'guidance (default) or kpi').choices(['guidance', 'kpi']))
    .addOption(new Option('--review <filter>', 'Guidance review filter').choices(['approved', 'auto', 'all']))
    .option('-l, --limit <n>', 'Max items (1-500)')
    .option('--offset <n>', 'Offset')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const first = await apiGet<{ event: Row; kind: 'guidance' | 'kpi'; guidance?: Row[]; kpis?: Row[]; next_url?: string }>({
        path: `${BASE}/extractions`,
        params: {
          ...selectorParams(cmdOpts),
          kind: cmdOpts.kind,
          review: cmdOpts.review,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      });
      const data = await paginate(first, first.kind === 'kpi' ? 'kpis' : 'guidance', opts.all);
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · ${data.kind === 'kpi' ? 'KPIs' : 'Guidance'}\n`));
        if (data.kind === 'kpi') {
          const columns = ['metric_normalized', 'value_text', 'period_label', 'speaker.name', 'origin', 'filing_link.form', 'filing_link.matched_value'];
          formatTable(flattenRows(data.kpis ?? [], columns), columns);
        } else {
          formatTable(data.guidance ?? [], [
            'metric_normalized', 'period_label', 'low', 'high', 'midpoint', 'unit',
            'basis', 'direction', 'confidence', 'review_status',
          ]);
        }
        printPaginationHint(data.next_url);
      });
    }));

  earnings
    .command('guidance-history')
    .description("A company's guidance for one metric across calls")
    .requiredOption('-i, --identifier <ticker>', 'Ticker or CIK')
    .requiredOption('--metric <metric>', 'Normalized metric (e.g. revenue, eps_non_gaap, segment:iphone)')
    .addOption(new Option('--period-kind <kind>', 'Period kind').choices(['quarter', 'fiscal_year', 'half', 'other']))
    .addOption(new Option('--basis <basis>', 'Basis').choices(['gaap', 'non_gaap', 'unknown']))
    .option('-l, --limit <n>', 'Max series entries (1-40)')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await apiGet<{ symbol: string; cik: string; metric_normalized: string; series: Row[] }>({
        path: `${BASE}/guidance/history`,
        params: {
          identifier: cmdOpts.identifier,
          metric: cmdOpts.metric,
          period_kind: cmdOpts.periodKind,
          basis: cmdOpts.basis,
          limit: cmdOpts.limit,
        },
      });
      output(data, opts, () => {
        console.log(chalk.bold(`\n${data.symbol} (${data.cik}) ${data.metric_normalized} guidance history\n`));
        const columns = ['conference_date', 'period_label', 'low', 'high', 'midpoint', 'direction', 'change_vs_prior.midpoint_delta'];
        formatTable(flattenRows(data.series, columns), columns);
      });
    }));

  // ── Derived ────────────────────────────────────────────────────────

  selectorCommand('diff', 'What changed against the prior call')
    .addOption(new Option('--vs <base>', 'Comparison base').choices(['prior']))
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<Row>({
        path: `${BASE}/diff`,
        params: { ...selectorParams(cmdOpts), vs: cmdOpts.vs },
      });
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} vs ${data.prior_event?.conference_date ?? 'prior call'}\n`));
        formatKeyValue({
          prior_event_id: data.prior_event?.event_id,
          similarity: data.similarity,
          tone_shift: data.tone_shift,
          hedging_level: data.hedging?.level,
          hedging_change: data.hedging?.change,
          uncertainty_level: data.uncertainty?.level,
          uncertainty_change: data.uncertainty?.change,
          numeric_specificity_level: data.numeric_specificity?.level,
          numeric_specificity_change: data.numeric_specificity?.change,
          slide_page_delta: data.slide_diff?.page_delta,
          slide_new_titles: data.slide_diff?.new_titles,
          slide_dropped_titles: data.slide_diff?.dropped_titles,
        });
        for (const [label, topics] of [['New topics', data.new_topics], ['Dropped topics', data.dropped_topics]] as const) {
          if (!topics?.length) continue;
          console.log(chalk.bold(`\n${label}\n`));
          formatTable(topics.map((t: Row) => ({ ...t, start_ms: formatMs(t.start_ms) })), ['topic', 'start_ms', 'evidence']);
        }
        if (data.summary) console.log(`\n${data.summary}`);
      });
    }));

  selectorCommand('metrics', 'Call structure metrics (length, Q&A share, questions, …)')
    .action(run(async (cmdOpts: SelectorOptions) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<Row>({ path: `${BASE}/metrics`, params: selectorParams(cmdOpts) });
      output(data, opts, () => {
        const { event, ...metrics } = data;
        console.log(chalk.bold(`\n${eventLine(event)} · metrics\n`));
        formatKeyValue(humanizeMs(metrics));
      });
    }));

  selectorCommand('prosody', 'Speech timing / pitch / energy per speaker')
    .addOption(new Option('--section <section>', 'Section').choices(['all', 'prepared', 'qa']))
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<{ event: Row; section: string; speakers: Row[] }>({
        path: `${BASE}/prosody`,
        params: { ...selectorParams(cmdOpts), section: cmdOpts.section },
      });
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · prosody (${data.section})\n`));
        const columns = [
          'speaker.name', 'speaker.role', 'section', 'speech_rate_wpm', 'pause_count', 'pause_mean_ms',
          'filler_rate', 'time_to_answer_mean_ms', 'pitch_mean_hz', 'energy_mean_db', 'spoken_ms',
          'word_count', 'acoustic_available',
        ];
        formatTable(flattenRows(data.speakers, columns).map(row => ({ ...row, spoken_ms: formatMs(row.spoken_ms as number) })), columns);
      });
    }));

  selectorCommand('price-attribution', 'Minute-level price moves during a call next to what was said (coincidence, not cause)')
    .action(run(async (cmdOpts: SelectorOptions) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<Row>({ path: `${BASE}/price-attribution`, params: selectorParams(cmdOpts) });
      output(data, opts, () => {
        const { event, buckets, top_minutes: topMinutes, ...summary } = data;
        console.log(chalk.bold(`\n${eventLine(event)} · price moves during the call\n`));
        console.log(chalk.dim('Temporal coincidence, not attribution of cause; pre-market bars are sparse.\n'));
        formatKeyValue(humanizeMs(summary));
        const columns = ['bucket', 'return_bps', 'cumulative_return_bps', 'said'];
        const said = (row: Row) => {
          const text = (row.utterance_refs ?? [])
            .map((ref: Row) => `[${formatMs(ref.start_ms)}] ${ref.text}`)
            .join(' ');
          return text.length > SEARCH_TEXT_MAX ? `${text.slice(0, SEARCH_TEXT_MAX - 1)}…` : text;
        };
        if (topMinutes?.length) {
          console.log(chalk.bold('\nTop minutes\n'));
          formatTable(topMinutes.map((row: Row) => ({ ...row, said: said(row) })), ['bucket', 'return_bps', 'said']);
        }
        if (buckets?.length) {
          console.log(chalk.bold('\nMinutes\n'));
          formatTable(buckets.map((row: Row) => ({ ...row, said: said(row) })), columns);
        }
      });
    }));

  // ── Media ──────────────────────────────────────────────────────────

  selectorCommand('audio', 'Call recording (signed URL, or --output to save it)')
    .option('-o, --output <file>', 'Save the recording (e.g. call.mp3)')
    .option('--force', 'Overwrite an existing --output file')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
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
      validateSelector(cmdOpts);
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
    .option('--body', 'Include the extracted text')
    .option('-l, --limit <n>', 'Max results (1-100)')
    .option('--offset <n>', 'Offset')
    .option('-o, --output <dir>', 'Save every document into this directory as <kind>-<document_id>.<ext>; one without a download URL (link-only sec_filing) is reported on stderr, exit 1 only when none could be saved')
    .option('--force', 'Overwrite existing files in --output')
    .action(run(async (cmdOpts: SelectorOptions & Row) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await paginate(await apiGet<{ event: Row; documents: Row[]; next_url?: string }>({
        path: `${BASE}/documents`,
        params: {
          ...selectorParams(cmdOpts),
          kind: cmdOpts.kind,
          include: cmdOpts.body ? 'body' : undefined,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      }), 'documents', opts.all);
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
        formatTable(data.documents, ['kind', 'title', 'content_type', 'bytes', 'pages', 'trust_tier', 'origin', 'expires_at', 'document_id']);
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

  // ── Search / live stream ───────────────────────────────────────────

  earnings
    .command('search')
    .description('Semantic search over call transcripts and slides')
    .requiredOption('-q, --query <text>', 'Search text')
    .option('--event <event_id>', 'Only this call')
    .option('-i, --identifier <ticker>', 'Only this company')
    .option('--from <date>', 'First New York call day (YYYY-MM-DD)')
    .option('--to <date>', 'Last New York call day (YYYY-MM-DD)')
    .addOption(new Option('--type <type>', 'Passage type').choices(['transcript', 'qa', 'preparedRemarks', 'presentation']))
    .option('-l, --limit <n>', 'Max passages (1-8)')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const data = await apiGet<{ query: string; hits: Row[] }>({
        path: `${BASE}/search`,
        params: {
          q: cmdOpts.query,
          event_id: cmdOpts.event,
          identifier: cmdOpts.identifier,
          from: cmdOpts.from,
          to: cmdOpts.to,
          type: cmdOpts.type,
          limit: cmdOpts.limit,
        },
      });
      output(data, opts, () => {
        console.log(chalk.bold(`\nSearch: ${data.query}\n`));
        const columns = ['score', 'type', 'symbol', 'conference_date', 'speaker.name', 'start_ms', 'text', 'audio'];
        formatTable(flattenRows(data.hits, columns).map((row, i) => {
          const text = String(row.text ?? '');
          return {
            ...row,
            start_ms: formatMs(row.start_ms as number),
            text: text.length > SEARCH_TEXT_MAX ? `${text.slice(0, SEARCH_TEXT_MAX - 1)}…` : text,
            audio: Boolean(data.hits[i].audio_url),
          };
        }), columns);
      });
    }));

  selectorCommand('stream', 'Live audio stream URL of a call in progress (HLS)')
    .action(run(async (cmdOpts: SelectorOptions) => {
      const opts = globalOpts();
      validateSelector(cmdOpts);
      const data = await apiGet<Row>({ path: `${BASE}/live/stream`, params: selectorParams(cmdOpts) });
      output(data, opts, () => {
        console.log(chalk.bold(`\n${eventLine(data.event)} · live stream\n`));
        formatKeyValue({
          status: data.status,
          url: data.url,
          expires_at: data.expires_at,
          call_t0: data.call_t0,
          segment_seconds: data.segment_seconds,
        });
        if (data.url) console.log(chalk.dim(`\nPlay with: ffplay "${data.url}"  or  vlc "${data.url}"`));
      });
    }));
}
