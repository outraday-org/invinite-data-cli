import { Command } from 'commander';

/** IDA's own wording (`eventSelectorSchema`) for an incomplete selector. */
export const SELECTOR_MESSAGE = 'Provide event_id, or identifier with year+quarter or date';

export interface SelectorOptions {
  event?: string;
  identifier?: string;
  year?: string;
  quarter?: string;
  date?: string;
}

/** Adds the event selector: `--event <uuid>`, or `-i` with `--year` + `--quarter` or `--date`. */
export function selectorOptions(cmd: Command): Command {
  return cmd
    .option('--event <event_id>', 'Event ID (wins over the other selectors)')
    .option('-i, --identifier <ticker>', 'Ticker or CIK (with --year + --quarter, or --date)')
    .option('--year <n>', 'Fiscal year of the call (with --quarter)')
    .option('--quarter <n>', 'Fiscal quarter of the call (with --year)')
    .option('--date <date>', 'New York calendar day of the call (YYYY-MM-DD)');
}

export function selectorParams(opts: SelectorOptions): Record<string, string | undefined> {
  return {
    event_id: opts.event,
    identifier: opts.identifier,
    year: opts.year,
    quarter: opts.quarter,
    date: opts.date,
  };
}

/** Throws (→ `withErrorHandling` exits 1) unless one selector form is complete. */
export function validateSelector(opts: SelectorOptions): void {
  if (opts.event) return;
  if (opts.identifier && ((opts.year && opts.quarter) || opts.date)) return;
  throw new Error(SELECTOR_MESSAGE);
}
