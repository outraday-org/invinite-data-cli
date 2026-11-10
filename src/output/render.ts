import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { getSetting } from '../config/config-manager.js';
import { pick } from '../formatters/flatten.js';
import { UsageError } from '../shared/errors.js';
import { runJq } from './jq.js';

/**
 * Every generated command prints through here: data to stdout (`table` on a terminal, `plain` tab-separated when
 * piped, or `json` / `jsonl` / `csv` on request), progress / cost / coverage notes to stderr (callers), long human
 * output through `INVD_PAGER` / `PAGER` on a terminal.
 */
export const OUTPUT_FORMATS = ['table', 'plain', 'json', 'jsonl', 'csv'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface OutputSettings {
  format: OutputFormat;
  /** `--json a,b`: the fields each row (or the object) keeps. */
  select?: string[];
  /** `--fields a,b` on an operation without a `fields` parameter: pruned client-side like `select`. */
  prune?: string[];
  /** `--fields a,b` the API prunes (`fields=`): only the column order of table / plain / CSV output. */
  order?: string[];
  jq?: string;
}

export interface ShapeInfo {
  list: boolean;
  view: 'table' | 'keyValue' | 'json';
  columns?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `NO_COLOR` turns colour off unless `FORCE_COLOR` asks for it (chalk reads `FORCE_COLOR` itself). */
export function applyColorEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NO_COLOR && !env.FORCE_COLOR) chalk.level = 0;
}

/** A row reduced to `fields` (dotted paths kept as their dotted key). */
export function selectFields(row: unknown, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, pick(row, field) ?? null]));
}

/** Fails on a `--json` field the operation's rows do not have, listing the ones they do. */
export function checkFields(fields: readonly string[], known: readonly string[], flag = '--json'): void {
  if (known.length === 0) return;
  const unknown = fields.filter(field => !known.includes(field.split('.')[0] ?? field));
  if (unknown.length > 0) {
    throw new UsageError(`${flag}: unknown field ${unknown.join(', ')}. Fields: ${known.join(', ')}`);
  }
}

/** The body with `select` / `prune` applied to its rows (a list keeps its envelope) or to the object. */
export function shapeBody(body: unknown, shape: ShapeInfo, settings: OutputSettings): unknown {
  const fields = settings.select ?? settings.prune;
  if (!fields || !isRecord(body)) return body;
  if (shape.list && Array.isArray(body.data)) return { ...body, data: body.data.map(row => selectFields(row, fields)) };
  return selectFields(body, fields);
}

function cell(value: unknown, column?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (column && /(^|_)(year|quarter)$/.test(column)) return String(value);
    if (Number.isInteger(value) && Math.abs(value) >= 1000) return value.toLocaleString('en-US');
    if (!Number.isInteger(value)) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(item => (isRecord(item) ? JSON.stringify(item) : String(item))).join(', ');
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

const plainCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/[\t\n]/g, ' ');
};

export function tableText(rows: Record<string, unknown>[], columns?: readonly string[]): string {
  if (rows.length === 0) return chalk.yellow('No results.');
  const cols = columns && columns.length > 0 ? [...columns] : Object.keys(rows[0] ?? {});
  const widths = cols.map(col => Math.max(col.length, ...rows.map(row => cell(row[col], col).length)));
  const lines = [
    cols.map((col, i) => chalk.bold(col.padEnd(widths[i] ?? 0))).join('  '),
    cols.map((_col, i) => '─'.repeat(widths[i] ?? 0)).join('  '),
    ...rows.map(row => cols.map((col, i) => cell(row[col], col).padEnd(widths[i] ?? 0)).join('  ').trimEnd()),
  ];
  return lines.join('\n');
}

export function plainText(rows: Record<string, unknown>[], columns?: readonly string[]): string {
  const cols = columns && columns.length > 0 ? [...columns] : Object.keys(rows[0] ?? {});
  return [cols.join('\t'), ...rows.map(row => cols.map(col => plainCell(row[col])).join('\t'))].join('\n');
}

export function keyValueText(row: Record<string, unknown>): string {
  const width = Math.max(0, ...Object.keys(row).map(key => key.length));
  return Object.entries(row).map(([key, value]) => `  ${chalk.bold(key.padEnd(width))}  ${cell(value, key)}`).join('\n');
}

const csvCell = (value: unknown): string => {
  const text = plainCell(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The CSV columns of some rows: every key, first-seen order. */
export const csvColumns = (rows: unknown[]): string[] =>
  [...new Set(rows.flatMap(row => (isRecord(row) ? Object.keys(row) : [])))];

export const csvHeader = (columns: readonly string[]): string => columns.map(csvCell).join(',');
export const csvRow = (row: unknown, columns: readonly string[]): string =>
  columns.map(column => csvCell(isRecord(row) ? row[column] : undefined)).join(',');

/** The rows a body contributes to JSONL / CSV: a list's `data[]`, else the object itself. */
export const bodyRows = (body: unknown, shape: ShapeInfo): unknown[] =>
  shape.list && isRecord(body) && Array.isArray(body.data) ? body.data : body === undefined ? [] : [body];

const tableRows = (rows: unknown[], columns?: readonly string[]): Record<string, unknown>[] =>
  rows.map(row => (columns ? selectFields(row, columns) : isRecord(row) ? row : { value: row }));

/** The human view of one body: the operation's columns as a table / key-value list, else indented JSON. */
export function humanText(body: unknown, shape: ShapeInfo, settings: OutputSettings): string {
  const fields = settings.select ?? settings.prune;
  const columns = fields ?? settings.order ?? shape.columns;
  const plain = settings.format === 'plain';
  if (shape.list) {
    const rows = tableRows(bodyRows(body, shape), columns);
    return plain ? plainText(rows, columns) : tableText(rows, columns);
  }
  if (isRecord(body) && (shape.view === 'keyValue' || fields)) {
    const row = columns ? selectFields(body, columns) : body;
    return plain ? plainText([row], Object.keys(row)) : keyValueText(row);
  }
  return JSON.stringify(body, null, 2);
}

/** The whole text of one (non-streamed) body in the chosen format. */
export function renderBody(body: unknown, shape: ShapeInfo, settings: OutputSettings): string {
  if (settings.jq) return runJq(settings.jq, body).join('\n');
  const shaped = shapeBody(body, shape, settings);
  switch (settings.format) {
    case 'json':
      return JSON.stringify(shaped, null, 2);
    case 'jsonl':
      return bodyRows(shaped, shape).map(row => JSON.stringify(row)).join('\n');
    case 'csv': {
      const rows = bodyRows(shaped, shape);
      const columns = settings.select ?? settings.prune ?? settings.order ?? csvColumns(rows);
      return [csvHeader(columns), ...rows.map(row => csvRow(row, columns))].join('\n');
    }
    default:
      return humanText(body, shape, settings);
  }
}

/** The pager command for human output: `INVD_PAGER` / config `pager`, else `PAGER`; `''` / `cat` = none. */
export function pagerCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = getSetting('pager').value || env.PAGER || '';
  return configured && configured !== 'cat' ? configured : undefined;
}

/**
 * Writes `text` to stdout; human output longer than the terminal goes through the pager when stdout is a
 * terminal and a pager is set.
 */
export function emit(text: string, opts: { human?: boolean } = {}): void {
  if (text === '') return;
  const pager = opts.human && process.stdout.isTTY ? pagerCommand() : undefined;
  if (pager && text.split('\n').length > (process.stdout.rows || 24)) {
    const result = spawnSync(pager, { shell: true, input: `${text}\n`, stdio: ['pipe', 'inherit', 'inherit'] });
    if (!result.error) return;
  }
  console.log(text);
}

/** The format when none was asked for: the `output` setting, else `table` on a terminal and `plain` in a pipe. */
export function defaultFormat(): OutputFormat {
  const configured = getSetting('output').value;
  if ((OUTPUT_FORMATS as readonly string[]).includes(configured)) return configured as OutputFormat;
  return process.stdout.isTTY ? 'table' : 'plain';
}
