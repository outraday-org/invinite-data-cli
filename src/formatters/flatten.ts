/** Reads a dotted path (`speaker.name`) from a nested row; `undefined` when any step is missing. */
export function pick(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const key of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Rows keyed by the given (possibly dotted) columns, ready for `formatTable(rows, columns)`. */
export function flattenRows(rows: unknown[], columns: string[]): Record<string, unknown>[] {
  return rows.map(row => Object.fromEntries(columns.map(col => [col, pick(row, col)])));
}
