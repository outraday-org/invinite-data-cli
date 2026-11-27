import { type Manifest } from '../spec-manifest.js';
import { Command } from 'commander';
import { apiCall, type RequestOptions } from '../client/api-client.js';
import { PAGE_RETRY, pageRetryDelayMs, rowsOf } from '../client/pagination.js';
import { ApiError, UsageError, withErrorHandling } from '../shared/errors.js';
import { onInterrupt } from '../shared/signals.js';

/** The largest page the feed serves: a backlog is read in as few requests as possible. */
const PAGE_LIMIT = '200';
export const DEFAULT_INTERVAL_SECONDS = 2;

export interface TailOptions {
  /** Continue after this event id (printed); without it the backlog is skipped unless `fromStart`. */
  after?: string;
  /** Print the whole retained log first (without `after`). */
  fromStart?: boolean;
  alertId?: string;
  type?: string;
  externalUserId?: string;
  intervalSeconds: number;
}

export interface TailDeps {
  /** One NDJSON line (stdout). */
  write: (line: string) => void;
  /** A status line (stderr). */
  note: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Asked before each wait: `true` ends the loop (tests; the CLI runs until interrupted). */
  stop?: () => boolean;
  /** Told the newest event id after each page, so an interrupt can print the resume flag. */
  onProgress?: (lastEventId: string | undefined) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRetryable = (error: unknown): error is ApiError =>
  error instanceof ApiError && (error.statusCode === 429 || error.statusCode === 503);

interface TailFlags {
  after?: string;
  fromStart?: boolean;
  alertId?: string;
  type?: string;
  externalUserId?: string;
  interval?: string;
}

/**
 * `invd alert-events tail`: a subcommand of the generated `alert-events` group (registered after the spec commands).
 * Not one call plus one view: it polls the pull feed until interrupted and prints NDJSON. Registered above the loop:
 * `pnpm reference:export` reads the command's API path (the `path:` literal) from the code after this registration.
 */
export function registerAlertEventsTailCommand(program: Command, manifest: Manifest): void {
  const EVENT_TYPES = manifest.operations.find(operation => operation.operationId === 'getAlertEvent')?.discriminatorValues ?? [];
  if (!EVENT_TYPES.length) throw new Error('Alert event types are missing from the manifest');
  const group = program.commands.find(command => command.name() === 'alert-events');
  if (!group) throw new Error('invd alert-events tail needs the alert-events group of the manifest');
  group
    .command('tail')
    .description('Follow the alert event log live: polls the pull feed and prints each new event as one JSON line')
    .option('--after <event-id>', 'Continue after this event id (prints everything newer)')
    .option('--from-start', 'Print the whole retained log first (default: only events newer than now)')
    .option('--alert-id <id>', 'Only the events of this alert')
    .option('--type <type>', `Only events of this type (${EVENT_TYPES.join(', ')})`)
    .option('--external-user-id <id>', 'Only the events of this end user\'s alerts')
    .option('--interval <seconds>', `Seconds between polls (default ${DEFAULT_INTERVAL_SECONDS}, min 1); every poll is one metered request`)
    .addHelpText('before', [
      'Examples:',
      '  $ invd alert-events tail',
      '  $ invd alert-events tail --after evt_123 --type alert.fired',
      '',
    ].join('\n'))
    .addHelpText('after', '\nStop with Ctrl-C; it prints the --after flag that resumes where you stopped.\n')
    .action(withErrorHandling(async (_raw: Record<string, unknown>, command: Command) => {
      const flags = command.opts<TailFlags>();
      if (flags.after !== undefined && flags.fromStart) throw new UsageError('--after and --from-start exclude each other');
      if (flags.type !== undefined && !(EVENT_TYPES as readonly string[]).includes(flags.type)) {
        throw new UsageError(`--type must be one of ${EVENT_TYPES.join(', ')} (got ${flags.type})`);
      }
      const intervalSeconds = parseInterval(flags.interval);
      let lastEventId = flags.after;
      const unregister = onInterrupt(() => {
        if (lastEventId) console.error(`Stopped — resume with --after ${lastEventId}`);
      });
      try {
        await tailAlertEvents(
          { after: flags.after, fromStart: flags.fromStart, alertId: flags.alertId, type: flags.type, externalUserId: flags.externalUserId, intervalSeconds },
          {
            write: line => { process.stdout.write(`${line}\n`); },
            note: line => { console.error(line); },
            sleep: ms => new Promise<void>(done => setTimeout(done, ms)),
            onProgress: id => { lastEventId = id; },
          },
        );
      } finally {
        unregister();
      }
    }));
}

/** One feed page after `after`, a refused 429 / 503 retried like an `--all` page (`PAGE_RETRY`). */
async function fetchPage(request: RequestOptions, sleep: TailDeps['sleep']): Promise<unknown> {
  for (let retry = 0; ; retry += 1) {
    try {
      return (await apiCall(request)).body;
    } catch (error) {
      if (!isRetryable(error) || retry >= PAGE_RETRY.retries) throw error;
      await sleep(pageRetryDelayMs(error, retry));
    }
  }
}

/**
 * Follows the alert event log: requests `GET /v1/alert-events?after=<last id>` (200 rows a page), prints every new
 * event as one JSON line, reads on at once while `has_more`, else waits `intervalSeconds`. Without `after` it first
 * reads to the end of the log without printing (the backlog; `fromStart` prints it), so only new events appear.
 * Runs until interrupted (or `deps.stop`). Every request is one metered call.
 */
export async function tailAlertEvents(options: TailOptions, deps: TailDeps): Promise<void> {
  let after = options.after;
  let printing = after !== undefined || options.fromStart === true;
  let skipped = 0;
  const filters = { alert_id: options.alertId, type: options.type, external_user_id: options.externalUserId };
  for (;;) {
    const body = await fetchPage(
      { path: '/v1/alert-events', method: 'GET', query: { ...filters, after, limit: PAGE_LIMIT }, silent: true },
      deps.sleep,
    );
    const rows = rowsOf(body);
    for (const row of rows) {
      if (printing) deps.write(JSON.stringify(row));
      else skipped += 1;
      if (isRecord(row) && typeof row.id === 'string') after = row.id;
    }
    deps.onProgress?.(after);
    if (isRecord(body) && body.has_more === true && rows.length > 0) continue;
    if (!printing) {
      printing = true;
      deps.note(after
        ? `Following new events after ${after} (${skipped} earlier skipped; --from-start prints them)`
        : 'Following new events (the log is empty so far)');
    }
    if (deps.stop?.()) return;
    await deps.sleep(options.intervalSeconds * 1000);
  }
}

/** `--interval <seconds>`: a number of at least 1. */
export function parseInterval(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INTERVAL_SECONDS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 1) throw new UsageError(`--interval expects a number of seconds of at least 1 (got ${raw})`);
  return seconds;
}
