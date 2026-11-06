import chalk from 'chalk';

/**
 * The typed state of a `/v1/sec/*` answer (`api_schema` + `readiness`, the search `coverage`), told apart from a
 * genuine result: a 202 `pending` or a `partial` page, and a search whose coverage is not `complete`, may hold zero
 * rows that are NOT "nothing exists". One generic rule over the response, never per command.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** How the capped passages were picked, from `coverage.matches.order` (an unknown order is printed as sent). */
function examinedOrder(matches: Record<string, unknown>): string {
  const order = text(matches.order);
  if (order === 'newest_first') {
    const complete = text(matches.complete_since)
      ? `every match filed since ${text(matches.complete_since)}`
      : 'even the newest week has more matches';
    const band = text(matches.window_from) ? `older ones from ${text(matches.window_from)} on` : 'older ones';
    return `newest first: ${complete}, then ${band} in index order`;
  }
  if (order === 'index_order' || order === undefined) return 'index order';
  return `order ${order}`;
}

/** The lines a person should read beside the output; empty for a ready, complete answer or a non-SEC body. */
export function readinessNotes(data: unknown): string[] {
  if (!isRecord(data) || !isRecord(data.readiness) || typeof data.api_schema !== 'string') return [];
  const notes: string[] = [];
  const { status, reason, recoverable } = data.readiness;
  if (status === 'pending') {
    notes.push(`readiness: pending${text(reason) ? ` (${text(reason)})` : ''} — not available yet, retry later (not billed)`);
  } else if (typeof status === 'string' && status !== 'ready') {
    const retry = recoverable === true ? '; the backend can still obtain the rest' : '';
    notes.push(`readiness: ${status}${text(reason) ? ` (${text(reason)})` : ''} — the answer is incomplete${retry}`);
  }
  const coverage = data.coverage;
  if (isRecord(coverage) && typeof coverage.completeness === 'string' && coverage.completeness !== 'complete') {
    const reasons = Array.isArray(coverage.reasons) ? coverage.reasons.filter(item => typeof item === 'string') : [];
    notes.push(
      `coverage: ${coverage.completeness}${reasons.length ? ` (${reasons.join(', ')})` : ''} — `
      + 'no hits here is not proof that nothing matches',
    );
    // An unfiltered search over the selectivity cap (`coverage.matches.capped`): what was examined and how to narrow.
    const matches = coverage.matches;
    if (isRecord(matches) && matches.capped === true) {
      const span = text(matches.filed_from) && text(matches.filed_to)
        ? `, filed ${text(matches.filed_from)} to ${text(matches.filed_to)}`
        : '';
      notes.push(
        `matches: ranked among ${String(matches.examined)} examined of at least ${String(matches.total_at_least)} `
        + `matching passages (${examinedOrder(matches)}${span})`,
      );
    }
    if (text(coverage.hint)) notes.push(`hint: ${text(coverage.hint)}`);
  }
  return notes;
}

/** Prints `readinessNotes` dimmed on stderr (stdout keeps only the answer). */
export function printReadinessNotes(data: unknown): void {
  for (const note of readinessNotes(data)) console.error(chalk.yellow(note));
}
