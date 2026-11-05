import chalk from 'chalk';

export function formatTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log(chalk.yellow('No results.'));
    return;
  }

  const cols = columns || Object.keys(rows[0]);
  const widths: Record<string, number> = {};

  for (const col of cols) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = formatValue(row[col], col);
      widths[col] = Math.max(widths[col], val.length);
    }
  }

  // Header
  const header = cols.map(c => chalk.bold(c.padEnd(widths[c]))).join('  ');
  console.log(header);
  console.log(cols.map(c => '─'.repeat(widths[c])).join('  '));

  // Rows
  for (const row of rows) {
    const line = cols.map(c => formatValue(row[c], c).padEnd(widths[c])).join('  ');
    console.log(line);
  }
}

function formatValue(val: unknown, columnName?: string): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') return formatNumber(val, columnName);
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

const YEAR_LIKE_COLUMNS = new Set(['fiscal_year', 'calendar_year']);

function formatNumber(n: number, columnName?: string): string {
  // Don't add thousand separators to year-like values
  if (columnName && YEAR_LIKE_COLUMNS.has(columnName)) {
    return String(n);
  }
  if (Number.isInteger(n) && Math.abs(n) >= 1000) {
    return n.toLocaleString('en-US');
  }
  if (!Number.isInteger(n)) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return String(n);
}

export function formatKeyValue(data: Record<string, unknown>): void {
  const maxKeyLen = Math.max(...Object.keys(data).map(k => k.length));
  for (const [key, value] of Object.entries(data)) {
    const label = chalk.bold(key.padEnd(maxKeyLen));
    console.log(`  ${label}  ${formatValue(value)}`);
  }
}

/** One dim line under a table that has a next page: a cursor-paged route names its `--cursor`, else offset/limit. */
export function printPaginationHint(nextUrl?: string): void {
  if (!nextUrl) return;
  let cursor: string | null = null;
  try {
    cursor = new URL(nextUrl).searchParams.get('cursor');
  } catch {
    // not a URL: the offset hint
  }
  console.log(chalk.dim(cursor
    ? `\nMore results available. Use --all to fetch all pages, or --cursor ${cursor} (same filters) for the next one.`
    : '\nMore results available. Use --all to fetch all pages, or --offset/--limit to paginate.'));
}
