import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import { apiCall, buildUrl, type HttpMethod, type QueryValue, type RequestOptions } from './client/api-client.js';
import { saveVerified } from './client/download.js';
import { nextCursorOf, rowsOf, walkPages } from './client/pagination.js';
import { getSetting } from './config/config-manager.js';
import { exampleLines } from './examples.js';
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
import { PartialResultError, UsageError, withErrorHandling } from './shared/errors.js';
import { splitList } from './shared/options.js';
import { confirmOrRefuse, readStdin } from './shared/prompt.js';
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
  for (const group of manifest.groups) {
    const operations = manifest.operations.filter(operation => operation.group === group.name);
    const groupCommand = program.command(group.name).description(group.description);
    const multi = operations.filter(operation => operation.action === '');
    if (multi.length > 0) {
      defineSelectorCommand(groupCommand, multi, { listEvents });
      continue;
    }
    for (const operation of operations) {
      const command = groupCommand
        .command(operation.action, operation.action === 'list' ? { isDefault: true } : {})
        .description(operation.summary);
      defineOperationCommand(command, operation, { listEvents });
    }
  }
}

interface Context {
  listEvents?: ManifestOperation;
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
  const name = positional.variadic ? `${positional.name}...` : positional.name;
  const note = positional.variadic === 'comma' ? ' (one or more; sent as a comma list)' : '';
  command.argument(positional.required ? `<${name}>` : `[${name}]`, `${description}${note}`);
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

function addCommandOptions(command: Command, operation: ManifestOperation): void {
  if (operation.body) {
    for (const field of operation.body.fields) for (const option of bodyOptions(field)) command.addOption(option);
    command.option('--body <json>', 'The whole JSON request body (flags above override its fields)');
    command.option('--body-file <path>', 'Read the JSON request body from a file (- = stdin)');
  }
  if (operation.download !== undefined) {
    command.option('--save <file>', 'Save the file this response points to (size and SHA-256 verified)');
    command.option('--force', 'With --save: replace an existing file');
  }
  addOutputOptions(command, { list: operation.list, fieldsParam: operation.params.some(param => param.name === 'fields') });
}

function defineOperationCommand(command: Command, operation: ManifestOperation, context: Context): void {
  addPositionals(command, operation);
  addParamOptions(command, operation, operation.params);
  addCommandOptions(command, operation);
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
  addCommandOptions(command, primary);
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

async function resolveLookup(plan: Plan): Promise<Plan> {
  if (!plan.lookup) return plan;
  const { body } = await apiCall({ ...plan.lookup.request, silent: true });
  const row = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined;
  const eventId = isRecord(row) && typeof row.event_id === 'string' ? row.event_id : undefined;
  if (!eventId) throw new Error(`No event for ${plan.lookup.company} ${plan.lookup.period} (GET /v1/events)`);
  console.error(chalk.dim(`resolved ${plan.lookup.company} ${plan.lookup.period} → event ${eventId} (GET /v1/events, ${plan.lookup.credits} credit)`));
  return { request: { ...plan.request, path: plan.request.path.replace('{event_id}', encodeURIComponent(eventId)) } };
}

async function saveDownload(operation: ManifestOperation, body: unknown, file: string, force: boolean): Promise<void> {
  const target = operation.download === '' ? body : pick(body, operation.download ?? '');
  const url = isRecord(target) ? target.url : undefined;
  if (typeof url !== 'string' || url === '') {
    throw new Error(`Nothing to save: ${operation.download ? `${operation.download}.url` : 'url'} is empty in this response`);
  }
  const record = target as Record<string, unknown>;
  const saved = await saveVerified(signal => fetch(url, { signal }), file, {
    force,
    expected: {
      ...(typeof record.sha256 === 'string' ? { sha256: record.sha256 } : {}),
      ...(typeof record.bytes === 'number' ? { bytes: record.bytes } : {}),
      ...(typeof record.content_type === 'string' ? { contentTypes: [record.content_type.split(';')[0]?.trim().toLowerCase() ?? ''] } : {}),
    },
  });
  console.error(chalk.green(`${saved.skipped ? 'Already saved' : 'Saved'} ${saved.path} (${saved.bytes} bytes, sha256 ${saved.sha256})`));
}

/** `--all`: every page streamed in the chosen format; a failure after written rows exits 3 with the resume cursor. */
async function streamAll(request: RequestOptions, first: Awaited<ReturnType<typeof apiCall>>, shape: ShapeInfo, settings: OutputSettings): Promise<void> {
  let written = 0;
  let cursor: string | undefined;
  let columns: string[] | undefined;
  const collected: unknown[] = [];
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
  }
  if (settings.format === 'table' || settings.format === 'plain') {
    emit(humanText({ data: collected }, shape, settings), { human: true });
  }
}

async function runOperation(operation: ManifestOperation, positionals: unknown[], opts: Opts, context: Context): Promise<void> {
  const fieldsParam = operation.params.some(param => param.name === 'fields');
  const settings = resolveOutput(opts, { knownFields: operation.fields, fieldsParam, list: operation.list });
  const all = opts.all === true;
  if (opts.save !== undefined && all) throw new UsageError('--save saves one response; it cannot be combined with --all');
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
  const shape: ShapeInfo = { list: operation.list, view: operation.view, ...(operation.columns ? { columns: operation.columns } : {}) };
  const first = await apiCall(plan.request);
  if (all) {
    await streamAll(plan.request, first, shape, settings);
    return;
  }
  const note = coverageNote(first.body);
  if (note) console.error(chalk.yellow(note));
  if (first.body === undefined) {
    if (settings.format === 'table' || settings.format === 'plain') console.error(chalk.green('Done.'));
    return;
  }
  if (typeof opts.save === 'string') await saveDownload(operation, first.body, opts.save, opts.force === true);
  const human = !settings.jq && (settings.format === 'table' || settings.format === 'plain');
  emit(renderBody(first.body, shape, settings), { human });
  const cursor = operation.list ? nextCursorOf(first.body) : undefined;
  if (cursor && human) {
    console.error(chalk.dim(`More rows: --all for every page, or --cursor ${cursor} (same flags) for the next one.`));
  }
}
