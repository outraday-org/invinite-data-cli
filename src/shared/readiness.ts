import chalk from 'chalk';

/**
 * The typed state of a `/v1/sec/*` answer (`api_schema` + `readiness`, the search `coverage`), told apart from a
 * genuine result: a 202 `pending` or a `partial` page, and a search whose coverage is not `complete`, may hold zero
 * rows that are NOT "nothing exists". One generic rule over the response, never per command.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

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
  }
  return notes;
}

/** Prints `readinessNotes` dimmed on stderr (stdout keeps only the answer). */
export function printReadinessNotes(data: unknown): void {
  for (const note of readinessNotes(data)) console.error(chalk.yellow(note));
}
