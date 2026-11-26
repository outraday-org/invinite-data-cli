import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import { apiCall, buildUrl, type HttpMethod, type QueryValue, type RequestOptions } from './client/api-client.js';
import { DownloadStatusError, exists, safeFileName, saveVerified } from './client/download.js';
import { nextCursorOf, rowsOf, walkPages } from './client/pagination.js';
import { getSetting } from './config/config-manager.js';
import { exampleLines } from './examples.js';
import { JOB_WAITS, waitForJob } from './job-wait.js';
import { pick } from './formatters/flatten.js';
import { runJq } from './output/jq.js';
import { addOutputOptions, resolveOutput, type OutputFlags } from './output/options.js';
import {
  bodyRows,
  csvColumns,
  csvHeader,
  csvRow,
  emit,
  humanText,
  renderBody,
  shapeBody,
  type OutputSettings,
  type ShapeInfo,
} from './output/render.js';
import { JobEndedError, PartialResultError, UsageError, withErrorHandling } from './shared/errors.js';
import { splitList } from './shared/options.js';
import { confirmOrRefuse, readStdin } from './shared/prompt.js';
import { onInterrupt, resumeOnInterrupt } from './shared/signals.js';
import { GLOBAL_PARAM_FLAGS } from './spec-flags.js';
import {
  commandName,
  exampleValue,
  type Manifest,
  type ManifestBodyField,
  type ManifestOperation,
  type ManifestParam,
} from './spec-manifest.js';

/**
 * Registers the manifest's operations: `invd <group> <action>` (a group's `list` is its default, so
 * `invd filings AAPL` lists), one positional for the natural key, one flag per parameter, the output / paging /
 * metering flags, and `invd financials` as ONE command over its six operations (`--basis` × `--view`).
 */
export function registerSpecCommands(program: Command, manifest: Manifest): void {
  const listEvents = manifest.operations.find(operation => operation.operationId === 'listEvents');
  const byId = new Map(manifest.operations.map(operation => [operation.operationId, operation]));
  const waits = new Map<string, JobWaitPlan>();
  for (const [operationId, wait] of Object.entries(JOB_WAITS)) {
    const status = byId.get(wait.status);
    const download = byId.get(wait.download);
    if (byId.has(operationId) && status && download) waits.set(operationId, { status, download, id: wait.id });
  }
  for (const group of manifest.groups) {
    const operations = manifest.operations.filter(operation => operation.group === group.name);
    const groupCommand = program.command(group.name).description(group.description);
    const multi = operations.filter(operation => operation.action === '');
    if (multi.length > 0) {
      defineSelectorCommand(groupCommand, multi, { listEvents, waits });
      continue;
    }
    for (const operation of operations) {
      const command = groupCommand
        .command(operation.action, operation.action === 'list' ? { isDefault: true } : {})
        .description(operation.summary);
      defineOperationCommand(command, operation, { listEvents, waits });
    }
  }
}

/** `--wait` on an operation that starts a job (`JOB_WAITS`): the job's read and download operations. */
interface JobWaitPlan {
  status: ManifestOperation;
  download: ManifestOperation;
  id: string;
}

interface Context {
  listEvents?: ManifestOperation;
  waits?: ReadonlyMap<string, JobWaitPlan>;
}

type Opts = Record<string, unknown> & OutputFlags;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const HTTP_METHOD: Record<ManifestOperation['method'], HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE',
};

/** Commander's attribute name of a long flag (`filed-at-gte` → `filedAtGte`). */
const attributeName = (flag: string) => flag.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

/** Parameters the CLI fills when the flag is absent (spec proposal D10: `period` default on the financials). */
const IMPLIED: Record<string, (values: Map<string, QueryValue>) => string> = {
  period: values => (['1', '2', '3'].includes(String(values.get('fiscal_quarter'))) ? 'quarterly' : 'annual'),
};
const IMPLIED_NOTE: Record<string, string> = { period: 'quarterly with --fiscal-quarter 1–3, else annual' };
const impliedFor = (operation: ManifestOperation): string[] =>
  operation.select ? operation.params.filter(param => param.name in IMPLIED && param.required).map(param => param.name) : [];

function describeParam(param: Pick<ManifestParam, 'description' | 'default' | 'example' | 'type' | 'enum' | 'pattern'>): string {
  const notes: string[] = [];
  if (param.type === 'array') notes.push(param.enum ? `comma-separated: ${param.enum.join(', ')}` : 'comma-separated');
  if (param.default !== undefined) notes.push(`default: ${JSON.stringify(param.default)}`);
  if (param.example !== undefined) notes.push(`e.g. ${exampleValue(param.example)}`);
  return [param.description ?? '', notes.length ? `(${notes.join('; ')})` : ''].filter(Boolean).join(' ');
}

/** The options of one parameter: `--flag <value>`, or `--flag` / `--no-flag` for a boolean. */
function paramOptions(param: ManifestParam, required: boolean): Option[] {
  const short = param.alias ? `-${param.alias}, ` : '';
  if (param.type === 'boolean') {
    return [
      new Option(`${short}--${param.flag}`, `${describeParam(param)} (sends true)`),
      new Option(`--no-${param.flag}`, `Sends ${param.name}=false`),
    ];
  }
  const option = new Option(`${short}--${param.flag} <${param.type === 'array' ? 'list' : 'value'}>`, describeParam(param));
  if (required) option.makeOptionMandatory();
  if (param.enum && param.type !== 'array') option.choices(param.enum);
  return [option];
}

function bodyOptions(field: ManifestBodyField): Option[] {
  const short = field.alias ? `-${field.alias}, ` : '';
  const description = `${field.description ?? ''} (body ${field.path.join('.')})`.trim();
  if (field.type === 'boolean') {
    return [new Option(`${short}--${field.flag}`, `${description}: true`), new Option(`--no-${field.flag}`, `${description}: false`)];
  }
  return [new Option(`${short}--${field.flag} <${field.type === 'array' ? 'list' : 'value'}>`, description)];
}

function expectation(param: Pick<ManifestParam, 'type' | 'items' | 'enum' | 'pattern'>): string {
  if (param.type === 'array') return `a comma-separated list${param.enum ? ` of ${param.enum.join(', ')}` : ''}`;
  if (param.enum) return `one of ${param.enum.join(', ')}`;
  if (param.type === 'integer') return 'an integer';
  if (param.type === 'number') return 'a number';
  if (param.pattern) return `a value matching ${param.pattern}`;
  return 'a value';
}

/** One flag value validated and converted to what goes on the wire; refuses by flag name (exit 2). */
export function wireValue(param: ManifestParam, raw: unknown): QueryValue {
  const fail = () => new UsageError(`--${param.flag} expects ${expectation(param)} (got ${JSON.stringify(raw)})`);
  if (param.type === 'boolean') {
    if (typeof raw !== 'boolean') throw fail();
    return String(raw);
  }
  const text = String(raw);
  if (param.type === 'array') {
    const items = splitList(text);
    const itemOk = (item: string) =>
      (param.enum ? param.enum.includes(item) : true)
      && (param.items === 'integer' ? /^-?\d+$/.test(item) : true)
      && (param.items === 'number' ? Number.isFinite(Number(item)) : true);
    if (items.length === 0 || !items.every(itemOk)) throw fail();
    return items;
  }
  if (param.type === 'integer' && !/^-?\d+$/.test(text)) throw fail();
  if (param.type === 'number' && (text.trim() === '' || !Number.isFinite(Number(text)))) throw fail();
  if (param.enum && !param.enum.includes(text)) throw fail();
  if (param.pattern && !new RegExp(param.pattern, 'u').test(text)) throw fail();
  return param.type === 'integer' || param.type === 'number' ? String(Number(text)) : text;
}

/** `2026Q3`, `2026 Q3`, `FY2026Q3` → fiscal year and quarter. */
export function parseFiscalPeriod(text: string): { fiscalYear: string; fiscalQuarter: string } | undefined {
  const match = /^(?:FY)?(\d{4})\s*-?\s*Q([1-4])$/i.exec(text.trim());
  return match?.[1] && match[2] ? { fiscalYear: match[1], fiscalQuarter: match[2] } : undefined;
}

const helpExamples = (lines: readonly string[]) => `Examples:\n${lines.map(line => `  $ ${line}`).join('\n')}\n`;

function helpFooter(operations: readonly ManifestOperation[]): string {
  const [first] = operations;
  if (!first) return '';
  const cost = operations.length === 1
    ? `Cost: ${first.credits} credit${first.credits === 1 ? '' : 's'} per response · plan: ${first.tier}`
    : `Cost per response: ${operations.map(operation => `${Object.values(operation.select ?? {}).join('/')} ${operation.credits} (${operation.tier})`).join(', ')}`;
  const fields = first.fields.length ? `\nFields (--json a,b): ${first.fields.join(', ')}` : '';
  return `\n${cost}${fields}\n`;
}

function addPositionals(command: Command, operation: ManifestOperation): void {
  const positional = operation.positional;
  if (!positional) return;
  const param = operation.params.find(candidate => candidate.name === positional.name);
  const description = param?.description ?? positional.name;
  if (positional.name === 'event_id') {
    command.argument('<event_id>', `${description}; or a company followed by a fiscal period (NVDA 2026Q3)`);
    command.argument('[fiscal_period]', 'With a company in place of the event id: the fiscal period (2026Q3), resolved through GET /v1/events');
    return;
  }
  if (operation.group === 'macro' && positional.name === 'series') {
    command.argument('[series]', description).option('--series <id>', description).allowExcessArguments(false);
    return;
  }
  const name = positional.variadic ? `${positional.name}...` : positional.name;
  const note = positional.variadic === 'comma' ? ' (one or more; sent as a comma list)' : '';
  command.argument(positional.required ? `<${name}>` : `[${name}]`, `${description}${note}`);
  // One value only (a member id, ONE held symbol since invd 8.0): a second word is a usage error, never dropped.
  if (!positional.variadic) command.allowExcessArguments(false);
}

function addParamOptions(command: Command, operation: ManifestOperation, params: readonly ManifestParam[]): void {
  const implied = impliedFor(operation);
  for (const param of params) {
    if (param.name === operation.positional?.name || GLOBAL_PARAM_FLAGS.includes(param.flag)) continue;
    const options = paramOptions(param, param.required && !implied.includes(param.name));
    if (implied.includes(param.name) && options[0]) {
      options[0].description = `${options[0].description} — absent: ${IMPLIED_NOTE[param.name] ?? 'filled by invd'}`;
    }
    for (const option of options) command.addOption(option);
  }
}

function addCommandOptions(command: Command, operation: ManifestOperation, context: Context): void {
  if (operation.body) {
    for (const field of operation.body.fields) for (const option of bodyOptions(field)) command.addOption(option);
    command.option('--body <json>', 'The whole JSON request body (flags above override its fields)');
    command.option('--body-file <path>', 'Read the JSON request body from a file (- = stdin)');
  }
  const wait = context.waits?.get(operation.operationId);
  if (wait) {
    command.option('--wait', 'Check the job every 10 s (backing off to 60 s) until it is ready, failed or expired (Ctrl-C stops waiting, the job keeps running)');
  }
  if (operation.download !== undefined || wait) {
    const when = wait ? 'With --wait: save the finished job\'s file' : 'Save the file this response points to';
    command.option('--save <file>', `${when} (size and SHA-256 verified)`);
    if (operation.downloadNamed || wait?.download.downloadNamed) {
      command.option('--out <dir>', `${when} into this directory under the answer's file name`);
    }
    command.option('--force', `With --save${operation.downloadNamed || wait ? ' / --out' : ''}: replace an existing file`);
  }
  if (operation.signedDownload) {
    command.option('--print-url', 'Print the short-lived download URL and download nothing (never store or share it)');
  }
  addOutputOptions(command, { list: operation.list, fieldsParam: operation.params.some(param => param.name === 'fields') });
}

function defineOperationCommand(command: Command, operation: ManifestOperation, context: Context): void {
  addPositionals(command, operation);
  addParamOptions(command, operation, operation.params);
  addCommandOptions(command, operation, context);
  command.addHelpText('before', helpExamples(exampleLines(operation)));
  command.addHelpText('after', helpFooter([operation]));
  command.action(withErrorHandling(async (...args: unknown[]) => {
    const invoked = args[args.length - 1] as Command;
    await runOperation(operation, invoked.processedArgs, invoked.opts<Opts>(), context);
  }));
}

/** `invd financials`: one command, the operation picked by the selector flags (`--basis`, `--view`). */
function defineSelectorCommand(command: Command, operations: ManifestOperation[], context: Context): void {
  const keys = [...new Set(operations.flatMap(operation => Object.keys(operation.select ?? {})))];
  const choices = (key: string) => [...new Set(operations.map(operation => operation.select?.[key] ?? ''))];
  // The first operation of each key's first value is the default (standardized, summary).
  const primary = operations.find(operation => keys.every(key => operation.select?.[key] === defaultChoice(key, choices(key)))) ?? operations[0];
  if (!primary) return;
  const params = new Map<string, ManifestParam>();
  for (const operation of operations) for (const param of operation.params) if (!params.has(param.name)) params.set(param.name, param);

  addPositionals(command, primary);
  for (const key of keys) {
    command.addOption(new Option(`--${key} <${key}>`, `Which ${key}`).choices(choices(key)).default(defaultChoice(key, choices(key))));
  }
  addParamOptions(command, primary, [...params.values()]);
  addCommandOptions(command, primary, context);
  const [first] = exampleLines(primary, { implied: impliedFor(primary) });
  const detailed = operations.find(operation => operation.select?.view === 'detailed' && operation.select?.basis === primary.select?.basis);
  const [, second] = exampleLines(detailed ?? primary, { implied: impliedFor(primary), extra: detailed ? ['--view detailed'] : [] });
  command.addHelpText('before', helpExamples([first, second]));
  command.addHelpText('after', helpFooter(operations));
  command.action(withErrorHandling(async (...args: unknown[]) => {
    const invoked = args[args.length - 1] as Command;
    const opts = invoked.opts<Opts>();
    const operation = operations.find(candidate => keys.every(key => candidate.select?.[key] === opts[key]));
    if (!operation) throw new UsageError(`No operation for ${keys.map(key => `--${key} ${String(opts[key])}`).join(' ')}`);
    const foreign = [...params.values()].filter(param =>
      !operation.params.some(own => own.name === param.name) && opts[attributeName(param.flag)] !== undefined);
    if (foreign.length > 0) {
      const where = operations.filter(candidate => candidate.params.some(own => own.name === foreign[0]?.name))
        .map(candidate => keys.map(key => `--${key} ${candidate.select?.[key]}`).join(' '));
      const bases = [...new Set(where.map(spelling => spelling.split(' --view')[0]))];
      throw new UsageError(`--${foreign[0]?.flag} applies to ${(bases.length === 1 ? bases : where).join(' | ')} only`);
    }
    await runOperation(operation, invoked.processedArgs, opts, context);
  }));
}

const defaultChoice = (key: string, values: string[]): string =>
  ({ basis: 'standardized', view: 'summary' } as Record<string, string>)[key] ?? values[0] ?? '';

interface Plan {
  request: RequestOptions;
  /** A lookup that must run first (`<company> <period>` → the event id). */
  lookup?: { request: RequestOptions; company: string; period: string; credits: number };
}

/** The request this command line describes, validated; nothing is sent. */
async function planRequest(operation: ManifestOperation, positionals: unknown[], opts: Opts, context: Context): Promise<Plan> {
  const values = new Map<string, QueryValue>();
  const positional = operation.positional;
  let lookup: Plan['lookup'];
  if (positional) {
    const [first, second] = positionals;
    if (positional.name === 'event_id' && typeof second === 'string' && second !== '') {
      const period = parseFiscalPeriod(second);
      if (!period) throw new UsageError(`${second} is not a fiscal period (expected e.g. 2026Q3)`);
      lookup = {
        request: {
          path: '/v1/events',
          query: { company: String(first), fiscal_year: period.fiscalYear, fiscal_quarter: period.fiscalQuarter, limit: '1' },
        },
        company: String(first),
        period: second,
        credits: context.listEvents?.credits ?? 1,
      };
    } else if (Array.isArray(first)) {
      if (first.length > 0) values.set(positional.name, first.map(String).join(positional.variadic === 'space' ? ' ' : ','));
    } else if (first !== undefined) {
      values.set(positional.name, String(first));
    }
  }
  if (operation.group === 'macro' && positional?.name === 'series') {
    const arg = values.get('series');
    const flag = opts.series;
    if (arg !== undefined && flag !== undefined && arg !== flag) throw new UsageError('The positional series and --series must name the same series');
    const id = arg ?? flag;
    const param = operation.params.find(p => p.name === 'series');
    if (typeof id !== 'string' || !id) throw new UsageError('Supply a series ID or --series <id>');
    if (param?.enum && !param.enum.includes(id)) throw new UsageError(`Unknown series for this family: ${id}. List IDs with invd macro series.`);
    values.set('series', id);
  }
  for (const param of operation.params) {
    if (param.name === positional?.name) continue;
    const raw = GLOBAL_PARAM_FLAGS.includes(param.flag) ? opts[param.flag] : opts[attributeName(param.flag)];
    if (raw === undefined) continue;
    values.set(param.name, wireValue(param, raw));
  }
  for (const name of impliedFor(operation)) {
    if (values.has(name)) continue;
    const value = IMPLIED[name]?.(values);
    if (value === undefined) continue;
    values.set(name, value);
    console.error(chalk.dim(`--${name} ${value} assumed (pass --${name} to choose)`));
  }

  const query: Record<string, QueryValue> = {};
  const headers: Record<string, string> = {};
  for (const param of operation.params) {
    const value = values.get(param.name);
    if (param.in === 'query') query[param.name] = value;
    if (param.in === 'header' && typeof value === 'string') headers[param.name] = value;
  }
  const path = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    if (lookup && name === 'event_id') return '{event_id}';
    const value = values.get(name);
    if (typeof value !== 'string' || value === '') throw new UsageError(`Missing ${name}`);
    return encodeURIComponent(value);
  });
  const body = operation.body ? await requestBody(operation, opts) : undefined;
  return {
    request: {
      path,
      method: HTTP_METHOD[operation.method],
      query,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
      auth: operation.auth,
    },
    ...(lookup ? { lookup } : {}),
  };
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const child = isRecord(target[head]) ? target[head] : {};
  target[head] = child;
  setPath(child, rest, value);
}

/** `--body` / `--body-file` (JSON), then each body flag over it; `undefined` when nothing was given. */
async function requestBody(operation: ManifestOperation, opts: Opts): Promise<unknown> {
  const inline = typeof opts.body === 'string' ? opts.body : undefined;
  const file = typeof opts.bodyFile === 'string' ? opts.bodyFile : undefined;
  if (inline !== undefined && file !== undefined) throw new UsageError('Pass --body or --body-file, not both');
  let body: unknown;
  if (inline !== undefined || file !== undefined) {
    const [flag, text] = inline !== undefined
      ? ['--body', inline]
      : [`--body-file ${file}`, file === '-' ? await readStdin() : await readFile(file ?? '', 'utf8')];
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new UsageError(`${flag} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const field of operation.body?.fields ?? []) {
    const raw = opts[attributeName(field.flag)];
    if (raw === undefined) continue;
    if (body !== undefined && !isRecord(body)) throw new UsageError('--body must be a JSON object to combine with field flags');
    body ??= {};
    const value = field.type === 'array' ? splitList(String(raw)) : field.type === 'integer' || field.type === 'number' ? Number(raw) : raw;
    setPath(body as Record<string, unknown>, field.path, value);
  }
  if (body === undefined && operation.body?.required) {
    const flags = operation.body.fields.map(field => `--${field.flag}`);
    throw new UsageError(`This command needs a request body: ${flags.length ? `${flags.join(', ')}, or ` : ''}--body / --body-file`);
  }
  return body;
}

const describeRequest = (request: RequestOptions) =>
  `${request.method ?? 'GET'} ${buildUrl(request.path, request.query).replace('%7Bevent_id%7D', '<event_id>')}`;

function printPlan(operation: ManifestOperation, plan: Plan, opts: Opts, all: boolean): void {
  const asJson = opts.json !== undefined || opts.jq !== undefined || opts.output === 'json' || opts.output === 'jsonl';
  const steps = [
    ...(plan.lookup ? [{ step: 'resolve', request: describeRequest(plan.lookup.request), operation: 'listEvents', credits: plan.lookup.credits }] : []),
    {
      step: 'request',
      request: describeRequest(plan.request),
      operation: operation.operationId,
      tier: operation.tier,
      credits: operation.credits,
      ...(plan.request.body !== undefined ? { body: plan.request.body } : {}),
    },
  ];
  const perPage = operation.credits;
  const lookupCredits = plan.lookup?.credits ?? 0;
  const estimate = all
    ? `${lookupCredits ? `${lookupCredits} + ` : ''}${perPage} × pages (the page count is known only during the walk)`
    : String(lookupCredits + perPage);
  if (asJson) {
    emit(JSON.stringify({ dry_run: true, steps, all, credits_estimate: estimate }, null, opts.output === 'jsonl' ? undefined : 2));
    return;
  }
  const lines = steps.map(step => `${step.step}: ${step.request}\n  ${step.operation}${'tier' in step ? ` (${step.tier})` : ''} · ${step.credits} credit(s) per response${'body' in step ? `\n  body: ${JSON.stringify(step.body)}` : ''}`);
  lines.push(`credits: ${estimate}${perPage > 0 ? ' (+1 per started 1,000 rows beyond the first 1,000 of a response)' : ''}`);
  lines.push('dry run: no request was sent');
  emit(lines.join('\n'));
}

/** The yellow stderr line of a `meta.coverage` that is not complete (v2 readiness: a 200 with `state`). */
export function coverageNote(body: unknown): string | undefined {
  const coverage = pick(body, 'meta.coverage');
  if (!isRecord(coverage) || typeof coverage.state !== 'string' || coverage.state === 'complete') return undefined;
  const through = typeof coverage.through === 'string' ? ` through ${coverage.through}` : '';
  const retry = typeof coverage.retry_after_s === 'number' ? `; retry in ${coverage.retry_after_s}s` : '';
  const meaning = coverage.state === 'pending' ? 'not available yet — no rows is not "nothing exists"' : 'the answer is incomplete';
  return `coverage: ${coverage.state}${through} — ${meaning}${retry}`;
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  issuer_daily: 'issuer file (daily)',
  issuer_monthly: 'issuer file (monthly)',
  nport: 'SEC N-PORT report',
};

/**
 * Every `meta.reason` of the contract as words: the composition / weights enum of `invd funds holdings|weights`
 * (`tests/unit/spec-commands.test.ts` reads it from `openapi.json`, so a new enum value cannot go unlabelled) and the
 * holder lists' store reasons (`invd holders`, a free string in the contract).
 */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  single_asset_trust: 'the fund holds one asset; there is no holdings list',
  source_stale: 'the issuer file is more than 5 trading days old',
  issuer_source_unavailable: 'the issuer file is unavailable; answered from the fund\'s N-PORT report',
  weights_unavailable: 'no weights for this source',
  no_composition: 'no composition in any source yet (coverage pending)',
  no_etf_holders: 'no ETF issuer file holds it',
  fund_cusip_unknown: 'the fund\'s own CUSIP is not known yet, so its holders cannot be told apart from its trust\'s other funds',
  etn_cusip_unknown: 'the note\'s own CUSIP is not known yet',
  // A company export's `coverage.reason` (`invd bulk export-status`, Data API 12.2).
  before_postgres_window: 'the earlier part of the range is only in the raw SEC bulk files (invd bulk files --kind raw)',
  capped_window: 'a period date range read releases filed up to one year after its end',
};

/** A company export's `coverage.scope` (N-PORT exports read the served scope, the N-PORT bulk files hold every fund). */
export const SCOPE_LABELS: Readonly<Record<string, string>> = {
  listed_funds_full_unlisted_funds_holders_only:
    'N-PORT: listed funds with every holding, unlisted funds as holders only (the nport bulk files hold every fund)',
};

/**
 * The stderr line of a single answer whose `coverage` object states why it was cut (`reason`) or what it spans
 * (`scope`): a company export (`invd bulk export-status`, `export --wait`). `undefined` for a complete one.
 */
export function jobCoverageNote(body: unknown): string | undefined {
  const coverage = isRecord(body) ? body.coverage : undefined;
  if (!isRecord(coverage)) return undefined;
  const parts = [
    ...(typeof coverage.reason === 'string' ? [REASON_LABELS[coverage.reason] ?? coverage.reason] : []),
    ...(typeof coverage.scope === 'string' ? [SCOPE_LABELS[coverage.scope] ?? coverage.scope] : []),
  ];
  return parts.length > 0 ? `coverage: ${parts.join(' · ')}` : undefined;
}

/**
 * The header line of an answer that states where its rows come from (`meta.source` + `meta.as_of`, e.g. an ETF's
 * composition from the issuer's daily file or the fund's N-PORT report) and the reason of a deliberate empty answer
 * (`meta.reason`). Printed above the table on stderr; machine output keeps both in its rows / `meta`.
 */
export function sourceNote(body: unknown): string | undefined {
  const source = pick(body, 'meta.source');
  const asOf = pick(body, 'meta.as_of');
  const reason = pick(body, 'meta.reason');
  const parts = [
    ...(typeof source === 'string' ? [`source: ${SOURCE_LABELS[source] ?? source}`] : []),
    ...(typeof asOf === 'string' ? [`as of ${asOf}`] : []),
    ...(typeof reason === 'string' ? [REASON_LABELS[reason] ?? reason] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

async function resolveLookup(plan: Plan): Promise<Plan> {
  if (!plan.lookup) return plan;
  const { body } = await apiCall({ ...plan.lookup.request, silent: true });
  const row = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined;
  const eventId = isRecord(row) && typeof row.event_id === 'string' ? row.event_id : undefined;
  if (!eventId) throw new Error(`No event for ${plan.lookup.company} ${plan.lookup.period} (GET /v1/events)`);
  console.error(chalk.dim(`resolved ${plan.lookup.company} ${plan.lookup.period} → event ${eventId} (GET /v1/events, ${plan.lookup.credits} credit)`));
  return { request: { ...plan.request, path: plan.request.path.replace('{event_id}', encodeURIComponent(eventId)) } };
}

/** Where `--save` / `--out` put the file. */
interface SaveTarget {
  file?: string;
  dir?: string;
  force: boolean;
}

/** The answer's download object (`operation.download`: `""` = the answer itself). */
const downloadTarget = (operation: ManifestOperation, body: unknown): unknown =>
  (operation.download === '' ? body : pick(body, operation.download ?? ''));

/** What the rendered answer shows in place of a signed download URL. */
export const hiddenUrl = (expiresAt: unknown): string =>
  `<hidden: valid until ${typeof expiresAt === 'string' && expiresAt !== '' ? expiresAt : 'it expires'}; use --save, --out or --print-url>`;

/**
 * The answer as it is rendered: a signed download URL (`operation.signedDownload`, the bulk data downloads) replaced
 * by `hiddenUrl`, in every output format, so a terminal log or a captured `--json` never holds the credential. A
 * permanent public URL (transcript PDF, audio, news PDF, investor document) is printed as before.
 */
export function withHiddenUrl(operation: ManifestOperation, body: unknown): unknown {
  if (!operation.signedDownload) return body;
  const target = downloadTarget(operation, body);
  if (!isRecord(target) || typeof target.url !== 'string') return body;
  const hidden = { ...target, url: hiddenUrl(target.expires_at) };
  if (operation.download === '' || operation.download === undefined || !isRecord(body)) return hidden;
  return { ...body, [operation.download]: hidden };
}

/** `--save` / `--out` / `--print-url` of one command line, refused when they contradict each other (exit 2). */
function saveTargetOf(opts: Opts, all: boolean): SaveTarget | undefined {
  const file = typeof opts.save === 'string' ? opts.save : undefined;
  const dir = typeof opts.out === 'string' ? opts.out : undefined;
  if (file !== undefined && dir !== undefined) throw new UsageError('Pass --save <file> or --out <dir>, not both');
  if (opts.printUrl === true && (file !== undefined || dir !== undefined)) {
    throw new UsageError('--print-url downloads nothing; it cannot be combined with --save or --out');
  }
  if (all && (file !== undefined || dir !== undefined)) {
    throw new UsageError(`${file !== undefined ? '--save' : '--out'} saves one response; it cannot be combined with --all`);
  }
  return file !== undefined || dir !== undefined ? { file, dir, force: opts.force === true } : undefined;
}

async function saveOnce(operation: ManifestOperation, body: unknown, target: SaveTarget): Promise<void> {
  const found = downloadTarget(operation, body);
  const url = isRecord(found) ? found.url : undefined;
  if (typeof url !== 'string' || url === '') {
    throw new Error(`Nothing to save: ${operation.download ? `${operation.download}.url` : 'url'} is empty in this response`);
  }
  const record = found as Record<string, unknown>;
  let file = target.file;
  if (file === undefined) {
    const name = typeof record.filename === 'string' ? safeFileName(record.filename, '') : '';
    if (name === '') throw new Error('This response names no file name for --out; save it with --save <file>');
    file = join(target.dir ?? '.', name);
  }
  const saved = await saveVerified(signal => fetch(url, { signal }), file, {
    force: target.force,
    expected: {
      ...(typeof record.sha256 === 'string' ? { sha256: record.sha256 } : {}),
      ...(typeof record.bytes === 'number' ? { bytes: record.bytes } : {}),
      ...(typeof record.content_type === 'string' ? { contentTypes: [record.content_type.split(';')[0]?.trim().toLowerCase() ?? ''] } : {}),
    },
  });
  console.error(chalk.green(`${saved.skipped ? 'Already saved' : 'Saved'} ${saved.path} (${saved.bytes} bytes, sha256 ${saved.sha256})`));
}

/**
 * Saves the file a response points to and returns the response that was saved from. A signed URL the file host
 * refuses with 403 (it expired) is asked for once more through `refetch` (the API counts that as another download);
 * a second 403 fails with a sentence. Any other failure is thrown as it is.
 */
async function saveDownload(
  operation: ManifestOperation,
  body: unknown,
  target: SaveTarget,
  refetch: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await saveOnce(operation, body, target);
    return body;
  } catch (error) {
    if (!(operation.signedDownload && error instanceof DownloadStatusError && error.status === 403)) throw error;
  }
  console.error(chalk.yellow('The download URL was refused (it expired); asking for a new one, which counts as another download'));
  const fresh = await refetch();
  try {
    await saveOnce(operation, fresh, target);
    return fresh;
  } catch (error) {
    if (error instanceof DownloadStatusError && error.status === 403) {
      throw new Error('The file host refused the new download URL as well; nothing was saved. Run the command again later.');
    }
    throw error;
  }
}

/** `--print-url`: the signed URL alone on stdout, nothing downloaded. */
function printUrl(operation: ManifestOperation, body: unknown): void {
  const found = downloadTarget(operation, body);
  const url = isRecord(found) ? found.url : undefined;
  if (typeof url !== 'string' || url === '') throw new Error('Nothing to print: this response holds no download URL');
  emit(url);
}

/**
 * `--all`: every page streamed in the chosen format; a failure after written rows exits 7 with the resume cursor,
 * Ctrl-C prints the cursor and exits 130 (`resumeOnInterrupt`).
 */
async function streamAll(request: RequestOptions, first: Awaited<ReturnType<typeof apiCall>>, shape: ShapeInfo, settings: OutputSettings): Promise<void> {
  let written = 0;
  let cursor: string | undefined;
  let columns: string[] | undefined;
  const collected: unknown[] = [];
  const unregister = resumeOnInterrupt(() => ({ written, cursor }));
  const header = sourceNote(first.body);
  if (header && (settings.format === 'table' || settings.format === 'plain') && !settings.jq) console.error(chalk.cyan(header));
  try {
    for await (const page of walkPages(request, first)) {
      const note = coverageNote(page.body);
      if (note) console.error(chalk.yellow(note));
      if (settings.jq) {
        emit(runJq(settings.jq, page.body).join('\n'));
        written += rowsOf(page.body).length || 1;
      } else {
        const rows = bodyRows(shapeBody(page.body, shape, settings), shape);
        if (settings.format === 'csv') {
          columns ??= settings.select ?? settings.prune ?? settings.order ?? csvColumns(rows);
          if (written === 0) emit(csvHeader(columns));
          emit(rows.map(row => csvRow(row, columns ?? [])).join('\n'));
        } else if (settings.format === 'table' || settings.format === 'plain') {
          collected.push(...bodyRows(page.body, shape));
        } else {
          emit(rows.map(row => JSON.stringify(row)).join('\n'));
        }
        written += rows.length;
      }
      cursor = nextCursorOf(page.body);
    }
  } catch (error) {
    if (written > 0) throw new PartialResultError(error, written, cursor);
    throw error;
  } finally {
    unregister();
  }
  if (settings.format === 'table' || settings.format === 'plain') {
    emit(humanText({ data: collected }, shape, settings), { human: true });
  }
}

async function runOperation(operation: ManifestOperation, positionals: unknown[], opts: Opts, context: Context): Promise<void> {
  const fieldsParam = operation.params.some(param => param.name === 'fields');
  const settings = resolveOutput(opts, { knownFields: operation.fields, fieldsParam, list: operation.list });
  const all = opts.all === true;
  const target = saveTargetOf(opts, all);
  const wait = context.waits?.get(operation.operationId);
  if (wait && target && opts.wait !== true) {
    throw new UsageError(`${target.file !== undefined ? '--save' : '--out'} saves the finished job's file: add --wait`);
  }
  // Refused before the job is created, not after minutes of waiting.
  if (wait && target?.file !== undefined && !target.force && await exists(target.file)) {
    throw new UsageError(`${target.file} already exists (use --force to overwrite)`);
  }
  let plan = await planRequest(operation, positionals, opts, context);
  if (opts.dryRun) {
    printPlan(operation, plan, opts, all);
    return;
  }
  if (operation.method === 'delete') {
    await confirmOrRefuse(`${describeRequest(plan.request)} deletes this resource.`, opts);
  }
  const threshold = Number(getSetting('confirm_credits').value);
  if (all && Number.isFinite(threshold) && operation.credits >= threshold && threshold > 0) {
    await confirmOrRefuse(`invd ${commandName(operation)} --all costs ${operation.credits} credits per page and may walk many pages. Continue?`, opts);
  }
  plan = await resolveLookup(plan);
  const columns = operation.group === 'macro' && operation.columns?.includes('reference_date')
    ? [...operation.columns, operation.action.startsWith('inflation') ? 'change_1m_pct' : 'change_prior']
    : operation.columns;
  const shape: ShapeInfo = { list: operation.list, view: operation.view, ...(columns ? { columns } : {}) };
  const first = await apiCall(plan.request);
  if (all) {
    await streamAll(plan.request, first, shape, settings);
    return;
  }
  const note = coverageNote(first.body);
  if (note) console.error(chalk.yellow(note));
  const header = sourceNote(first.body);
  if (header && (settings.format === 'table' || settings.format === 'plain') && !settings.jq) console.error(chalk.cyan(header));
  if (first.body === undefined) {
    if (settings.format === 'table' || settings.format === 'plain') console.error(chalk.green('Done.'));
    return;
  }
  if (wait && opts.wait === true) {
    await finishJob(operation, wait, first.body, target, settings);
    return;
  }
  if (opts.printUrl === true) {
    printUrl(operation, first.body);
    return;
  }
  const human = !settings.jq && (settings.format === 'table' || settings.format === 'plain');
  let body: unknown = first.body;
  if (target) body = await saveDownload(operation, body, target, async () => (await apiCall(plan.request)).body);
  const coverage = operation.list ? undefined : jobCoverageNote(body);
  if (coverage && human) console.error(chalk.yellow(coverage));
  emit(renderBody(withHiddenUrl(operation, body), shape, settings), { human });
  const cursor = operation.list ? nextCursorOf(first.body) : undefined;
  if (cursor && human) {
    console.error(chalk.dim(`More rows: --all for every page, or --cursor ${cursor} (same flags) for the next one.`));
  }
}

/**
 * `--wait` (`JOB_WAITS`): reads the job until it is ready, failed or expired, prints it in its read operation's view,
 * then downloads a ready job's file with `--save` / `--out`. A failed or expired job exits 1 after it is printed.
 */
async function finishJob(
  operation: ManifestOperation,
  wait: JobWaitPlan,
  created: unknown,
  target: SaveTarget | undefined,
  settings: OutputSettings,
): Promise<void> {
  const id = isRecord(created) ? created[wait.id] : undefined;
  if (typeof id !== 'string' || id === '') throw new Error(`The response names no ${wait.id}; nothing to wait for`);
  const read = (step: ManifestOperation) => async () => (await apiCall({
    path: step.path.replace(`{${wait.id}}`, encodeURIComponent(id)),
    method: 'GET',
    auth: step.auth,
    silent: true,
  })).body;
  const follow = `invd ${commandName(wait.status)} ${id}`;
  const fetchFile = `invd ${commandName(wait.download)} ${id} ${wait.download.downloadNamed ? '--out <dir>' : '--save <file>'}`;
  const resumeHint = (status: string) => `${id} is ${status} and keeps running; follow it with ${follow}, then ${fetchFile}`;
  // On stderr in every format (the spinner is silent under --json and without a terminal): the handle on the job.
  console.error(chalk.dim(`${commandName(operation)}: ${id} created; waiting (Ctrl-C stops waiting, the job keeps running)`));
  let job: unknown;
  try {
    job = await waitForJob(created, { id, read: read(wait.status), resumeHint: status => `Stopped waiting; ${resumeHint(status)}` });
  } catch (error) {
    console.error(chalk.yellow(`Stopped waiting; ${resumeHint('not finished yet')}`));
    throw error;
  }
  const status = isRecord(job) && typeof job.status === 'string' ? job.status : 'unknown';
  const human = !settings.jq && (settings.format === 'table' || settings.format === 'plain');
  const coverage = jobCoverageNote(job);
  if (coverage && human) console.error(chalk.yellow(coverage));
  const shape: ShapeInfo = { list: false, view: wait.status.view, ...(wait.status.columns ? { columns: wait.status.columns } : {}) };
  emit(renderBody(job, shape, settings), { human });
  if (status === 'ready' && target) {
    const retry = `${id} is ready; download it with ${fetchFile}`;
    const unregister = onInterrupt(() => console.error(retry));
    try {
      await saveDownload(wait.download, await read(wait.download)(), target, read(wait.download));
    } catch (error) {
      console.error(chalk.yellow(retry));
      throw error;
    } finally {
      unregister();
    }
  }
  if (status === 'failed') {
    const code = isRecord(job) && typeof job.error_code === 'string' ? ` (${job.error_code})` : '';
    throw new JobEndedError(`${id} failed${code}; nothing to download (create a new one with invd ${commandName(operation)})`, status);
  }
  if (status === 'expired') {
    throw new JobEndedError(`${id} expired and its file was deleted (create a new one with invd ${commandName(operation)})`, status);
  }
  if (status !== 'ready') throw new JobEndedError(`${id} answered the unknown status ${status}; follow it with ${follow}`, status);
}
