import { Command } from 'commander';
import chalk from 'chalk';
import { apiGet, apiRequest } from '../client/api-client.js';
import { withErrorHandling } from '../shared/errors.js';
import { output } from '../shared/output.js';
import { splitList } from '../shared/options.js';
import { setJsonMode } from '../shared/spinner.js';
import { formatKeyValue, formatTable } from '../formatters/table-formatter.js';
import { planHint } from './earnings.js';

const BASE = '/v1/earnings-calls/webhooks';

/** IDA's `WEBHOOK_EVENT_NAMES` (docs/webhooks.md); the API's 400 stays the final word. */
export const WEBHOOK_EVENTS = [
  'earnings_call.scheduled',
  'earnings_call.rescheduled',
  'earnings_call.started',
  'earnings_call.ended',
  'earnings_call.transcript_provisional',
  'earnings_call.transcript_ready',
  'earnings_call.transcript_corrected',
  'earnings_call.assets_ready',
  'earnings_call.guidance_flash',
  'ping',
] as const;

const SUBSCRIPTION_COLUMNS = ['id', 'url', 'events', 'ciks', 'active', 'consecutive_failures', 'secret_hint', 'created_at'];

const DELIVERY_COLUMNS = ['delivery_id', 'event', 'attempt', 'status', 'response_status', 'duration_ms', 'at', 'next_attempt_at'];

type Row = Record<string, any>;

/** `--events`: each name must be one of `WEBHOOK_EVENTS`. */
export function parseEvents(value: string): string[] {
  const events = splitList(value);
  const unknown = events.filter(event => !(WEBHOOK_EVENTS as readonly string[]).includes(event));
  if (events.length === 0 || unknown.length > 0) {
    const named = unknown.length ? `Unknown event(s): ${unknown.join(', ')}. ` : '';
    throw new Error(`${named}--events takes a comma-separated list of: ${WEBHOOK_EVENTS.join(', ')}`);
  }
  return events;
}

function subscriptionRow(sub: Row): Row {
  return { ...sub, ciks: sub.filters?.ciks?.length ? sub.filters.ciks : 'all' };
}

const idPath = (id: string, suffix = '') => `${BASE}/${encodeURIComponent(id)}${suffix}`;

export function registerWebhooksCommands(program: Command): void {
  const webhooks = program
    .command('webhooks')
    .description('Earnings-call webhook subscriptions (PRO): signed POSTs of the call lifecycle');

  const globalOpts = () => {
    const opts = program.opts();
    if (opts.json) setJsonMode(true);
    return opts;
  };

  const run = (fn: (...args: any[]) => Promise<void>) => withErrorHandling(fn, planHint);

  webhooks
    .command('list')
    .description("Your team's webhook subscriptions (secrets are never shown)")
    .action(run(async () => {
      const opts = globalOpts();
      const data = await apiGet<{ data: Row[] }>({ path: BASE });
      output(data, opts, () => {
        console.log(chalk.bold('\nWebhook subscriptions\n'));
        formatTable(data.data.map(subscriptionRow), SUBSCRIPTION_COLUMNS);
      });
    }));

  webhooks
    .command('create')
    .description('Create a subscription (max 10 per team); prints the signing secret once')
    .requiredOption('--url <url>', 'https endpoint (port 443, public addresses only)')
    .requiredOption('--events <list>', `Comma-separated events: ${WEBHOOK_EVENTS.join(', ')}`)
    .option('--ciks <list>', 'Only these companies, comma-separated CIKs (max 10; default every company)')
    .option('--keywords <list>', 'Comma-separated keywords (reserved for keyword alerts)')
    .action(run(async (cmdOpts) => {
      const opts = globalOpts();
      const events = parseEvents(cmdOpts.events);
      const ciks = splitList(cmdOpts.ciks);
      const keywords = splitList(cmdOpts.keywords);
      const filters = ciks.length || keywords.length
        ? { ...(ciks.length ? { ciks } : {}), ...(keywords.length ? { keywords } : {}) }
        : undefined;
      const data = await apiRequest<Row>({
        method: 'POST',
        path: BASE,
        body: { url: cmdOpts.url, events, ...(filters ? { filters } : {}) },
      });
      output(data, opts, () => {
        const { secret, ...sub } = data;
        console.log(chalk.bold('\nWebhook created\n'));
        formatKeyValue(subscriptionRow(sub));
        console.log(chalk.yellow('\nSigning secret — shown only this once; store it now:'));
        console.log(secret);
      });
    }));

  webhooks
    .command('delete')
    .description('Delete a subscription')
    .argument('<id>', 'Subscription ID')
    .action(run(async (id: string) => {
      const opts = globalOpts();
      await apiRequest({ method: 'DELETE', path: idPath(id) });
      output({ id, deleted: true }, opts, () => {
        console.log(chalk.green(`Deleted webhook ${id}`));
      });
    }));

  webhooks
    .command('rotate-secret')
    .description('New signing secret (shown once); the old one stays valid for 5 minutes')
    .argument('<id>', 'Subscription ID')
    .action(run(async (id: string) => {
      const opts = globalOpts();
      const data = await apiRequest<{ secret: string; previous_secret_expires_at: string }>({
        method: 'POST',
        path: idPath(id, '/rotate-secret'),
      });
      output(data, opts, () => {
        console.log(chalk.yellow('\nNew signing secret — shown only this once; store it now:'));
        console.log(data.secret);
        console.log(chalk.dim(`\nThe previous secret stays valid until ${data.previous_secret_expires_at}.`));
      });
    }));

  webhooks
    .command('test')
    .description('Send a signed ping delivery to the subscription')
    .argument('<id>', 'Subscription ID')
    .action(run(async (id: string) => {
      const opts = globalOpts();
      const data = await apiRequest<{ delivery_id: string; event: string }>({
        method: 'POST',
        path: idPath(id, '/test'),
      });
      output(data, opts, () => {
        console.log(chalk.green(`Queued ${data.event} delivery ${data.delivery_id}`));
        console.log(chalk.dim(`See its result with: invd webhooks deliveries ${id}`));
      });
    }));

  webhooks
    .command('deliveries')
    .description('The last 100 delivery attempts, newest first (kept 7 days)')
    .argument('<id>', 'Subscription ID')
    .action(run(async (id: string) => {
      const opts = globalOpts();
      const data = await apiGet<{ data: Row[] }>({ path: idPath(id, '/deliveries') });
      output(data, opts, () => {
        console.log(chalk.bold(`\nDeliveries of ${id}\n`));
        formatTable(data.data, DELIVERY_COLUMNS);
      });
    }));
}
