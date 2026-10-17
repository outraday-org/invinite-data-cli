import { Command, Option } from 'commander';
import chalk from 'chalk';
import { apiGetRaw } from '../client/api-client.js';
import { DASHBOARD_URL } from '../config/config-manager.js';
import { formatKeyValue } from '../formatters/table-formatter.js';
import { sparkline } from '../formatters/sparkline.js';
import { ApiError, withErrorHandling } from '../shared/errors.js';
import { createSpinner } from '../shared/spinner.js';

/** `GET /v1/account/usage` (invinite-data-api `src/routes/account/usage/types/routeSchemas.ts`). */
export interface AccountUsage {
  window_days: number;
  period: {
    tier: string;
    included_credits: number;
    used_credits: number;
    resets_at: string | null;
    prepaid_balance_usd: number;
  };
  daily: { date: string; requests: number; credits: number; errors: Record<ErrorClass, number> }[];
  by_family: { family: string; label: string; requests: number; credits: number }[];
  by_key: { caller: 'key' | 'oauth' | 'unknown'; label: string; key_hint: string | null; requests: number; credits: number }[];
  truncated: boolean;
}

const ERROR_CLASSES = ['402', '403', '429', '4xx', '5xx'] as const;
type ErrorClass = typeof ERROR_CLASSES[number];

const BREAKDOWN_LIMIT = 5;

const count = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const utcDateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
});

function breakdown(items: { name: string; credits: number }[]): string {
  if (items.length === 0) return 'none';
  const shown = items.slice(0, BREAKDOWN_LIMIT).map(item => `${item.name} ${count.format(item.credits)}`);
  const rest = items.length - BREAKDOWN_LIMIT;
  return shown.join(' · ') + (rest > 0 ? ` · +${rest} more` : '');
}

/** The dashboard's answer as label / value rows; pure, so the command and its tests share it. */
export function usageRows(usage: AccountUsage): Record<string, string> {
  const { period, daily } = usage;
  const tier = period.tier.charAt(0).toUpperCase() + period.tier.slice(1);
  const resets = period.resets_at ? `resets ${utcDateTime.format(new Date(period.resets_at))} UTC` : 'no reset date';
  const share = period.included_credits > 0
    ? ` (${Math.round((period.used_credits / period.included_credits) * 100)} %)`
    : '';
  const errors = ERROR_CLASSES
    .map(status => [status, daily.reduce((sum, day) => sum + (day.errors[status] ?? 0), 0)] as const)
    .filter(([, total]) => total > 0)
    .map(([status, total]) => `${status} ×${count.format(total)}`);
  const range = daily.length > 0 ? `, ${daily[0].date} → ${daily[daily.length - 1].date} UTC` : '';

  return {
    'Plan': `${tier} · ${count.format(period.included_credits)} credits included · ${resets}`,
    'Used': `${count.format(period.used_credits)} credits${share} · prepaid balance ${usd.format(period.prepaid_balance_usd)}`,
    'Daily': `${sparkline(daily.map(day => day.credits))}   (credits per day${range})`,
    'By family': breakdown(usage.by_family.map(item => ({ name: item.label, credits: item.credits }))),
    'By key': breakdown(usage.by_key.map(item => ({
      name: item.key_hint ? `${item.label} (${item.key_hint})` : item.label,
      credits: item.credits,
    }))),
    'Errors': errors.length > 0 ? errors.join(' · ') : 'none',
    'Details': `${DASHBOARD_URL}/usage`,
  };
}

export function registerUsageCommands(program: Command): void {
  program
    .command('usage')
    .description('Plan allowance, prepaid balance and usage by day, endpoint family and key (costs no credits)')
    .addOption(new Option('--days <n>', 'Window in UTC days').choices(['7', '30', '90']).default('30'))
    .action(withErrorHandling(async (cmdOpts: { days: string }) => {
      const parentOpts = program.opts();
      const spinner = createSpinner('Fetching usage...');
      let body: string;
      try {
        const response = await apiGetRaw({ path: '/v1/account/usage', params: { days: cmdOpts.days }, accept: 'application/json' });
        body = await response.text();
        spinner.succeed('Done');
      } catch (error) {
        spinner.fail('Failed');
        if (error instanceof ApiError && error.statusCode === 503) {
          throw new Error('Usage is temporarily unavailable — try again in a minute.');
        }
        throw error;
      }
      if (parentOpts.json) {
        // The route's JSON as received, byte for byte.
        process.stdout.write(body.endsWith('\n') ? body : `${body}\n`);
        return;
      }
      const usage = JSON.parse(body) as AccountUsage;
      formatKeyValue(usageRows(usage));
      if (usage.truncated) {
        console.log(chalk.dim('Breakdowns are capped at their item limit; the dashboard lists every key and family.'));
      }
    }, error => (error.statusCode === 401 ? 'Run: invd login' : undefined)));
}
