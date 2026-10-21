import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import { z } from 'zod';
import { apiGet, apiRequest } from './client/api-client.js';
import { fetchAllCompanyPages, fetchAllTopPages } from './client/pagination.js';
import { flattenRows, pick } from './formatters/flatten.js';
import { formatJson } from './formatters/json-formatter.js';
import { formatKeyValue, formatTable, printPaginationHint } from './formatters/table-formatter.js';
import { withErrorHandling } from './shared/errors.js';
import { splitList } from './shared/options.js';
import { output } from './shared/output.js';
import { setJsonMode } from './shared/spinner.js';
import { flagName } from './spec-flags.js';
import type { Manifest, ManifestOperation, ManifestParam } from './spec-manifest.js';

/**
 * Registers every manifest operation as `invd <group> <action>` (`action: ""` → `invd <group>`): one flag per
 * parameter (path parameters included, never positional), values validated before any request, the request through
 * `apiGet` / `apiRequest`, `--all` by the operation's pagination, and the operation's view as the human output.
 * Groups in `skipGroups` are left to their hand-written commands.
 */
export function registerSpecCommands(
  program: Command,
  manifest: Manifest,
  options: { skipGroups?: Iterable<string> } = {},
): void {
  const skip = new Set(options.skipGroups ?? []);
  for (const group of manifest.groups) {
    if (skip.has(group.name)) continue;
    const operations = manifest.operations.filter(operation => operation.group === group.name);
    const groupCommand = program.command(group.name).description(group.description);
    for (const operation of operations) {
      const command = operation.action === ''
        ? groupCommand
        : groupCommand.command(operation.action).description(operation.summary);
      defineOperationCommand(command, operation);
    }
  }
}

type WireValue = string | string[] | undefined;

interface ParamBinding {
  param: ManifestParam;
  option: Option;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function paramOption(param: ManifestParam): Option {
  const long = `--${flagName(param.name)}`;
  const value = param.type === 'boolean' ? '' : param.type === 'array' ? ' <list>' : ' <value>';
  const notes: string[] = [];
  if (param.type === 'array') {
    notes.push(param.enum ? `comma-separated: ${param.enum.join(', ')}` : 'comma-separated');
  }
  if (param.default !== undefined) notes.push(`default: ${JSON.stringify(param.default)}`);
  const description = [param.description ?? '', notes.length ? `(${notes.join('; ')})` : '']
    .filter(Boolean).join(' ');
  const option = new Option(`${param.alias ? `-${param.alias}, ` : ''}${long}${value}`, description);
  if (param.required) option.makeOptionMandatory();
  if (param.enum && param.type !== 'array') option.choices(param.enum);
  return option;
}

const itemSchema = (type: ManifestParam['items'], values: string[] | undefined): z.ZodType<string> => {
  if (values && values.length > 0) return z.string().refine(value => values.includes(value));
  if (type === 'integer') return z.string().regex(/^-?\d+$/);
  if (type === 'number') return z.string().refine(value => value.trim() !== '' && Number.isFinite(Number(value)));
  return z.string();
};

/** The zod check of one parameter's raw flag value, yielding what goes on the wire. */
function paramSchema(param: ManifestParam): z.ZodType<WireValue, z.ZodTypeDef, unknown> {
  if (param.type === 'boolean') return z.boolean().transform(value => String(value));
  if (param.type === 'array') {
    return z.string().transform(value => splitList(value)).pipe(z.array(itemSchema(param.items, param.enum)).min(1));
  }
  if (param.type === 'integer' || param.type === 'number') {
    return z.string().pipe(itemSchema(param.type, undefined)).transform(value => String(Number(value)));
  }
  return z.string();
}

function expectation(param: ManifestParam): string {
  if (param.type === 'array') {
    const item = param.enum ? `one of ${param.enum.join(', ')}` : param.items === 'string' ? 'a value' : `an ${param.items}`;
    return `a comma-separated list, each item ${item}`;
  }
  if (param.type === 'integer') return 'an integer';
  if (param.type === 'number') return 'a number';
  if (param.type === 'boolean') return 'no value';
  return 'a value';
}

/** Every given flag validated and converted; refuses by flag name, before any request. */
function wireValues(bindings: ParamBinding[], opts: Record<string, unknown>): Map<string, WireValue> {
  const values = new Map<string, WireValue>();
  for (const { param, option } of bindings) {
    const raw = opts[option.attributeName()];
    if (raw === undefined) continue;
    const parsed = paramSchema(param).safeParse(raw);
    if (!parsed.success) {
      throw new Error(`--${flagName(param.name)} expects ${expectation(param)} (got ${JSON.stringify(raw)})`);
    }
    values.set(param.name, parsed.data);
  }
  return values;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

/** `--body <json>` or `--body-file <path|->` → the parsed JSON body; `undefined` when neither was given. */
async function requestBody(operation: ManifestOperation, opts: Record<string, unknown>): Promise<unknown> {
  const inline = typeof opts.body === 'string' ? opts.body : undefined;
  const file = typeof opts.bodyFile === 'string' ? opts.bodyFile : undefined;
  if (inline !== undefined && file !== undefined) throw new Error('Pass --body or --body-file, not both');
  if (inline === undefined && file === undefined) {
    if (operation.body?.required) throw new Error('This command needs a JSON body: --body <json> or --body-file <path|->');
    return undefined;
  }
  const [flag, text] = inline !== undefined
    ? ['--body', inline]
    : [`--body-file ${file}`, file === '-' ? await readStdin() : await readFile(file ?? '', 'utf8')];
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${flag} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function nextUrlOf(operation: ManifestOperation, data: unknown): string | undefined {
  const path = operation.pagination === 'top' ? 'next_url'
    : operation.pagination === 'perCompany' ? 'companies.0.next_url' : undefined;
  const found = path ? pick(data, path) : undefined;
  return typeof found === 'string' && found !== '' ? found : undefined;
}

function renderView(operation: ManifestOperation, data: unknown): void {
  if (operation.view === 'table') {
    const found = operation.rowsPath ? pick(data, operation.rowsPath) : data;
    const rows = Array.isArray(found) ? found : [];
    formatTable(operation.columns ? flattenRows(rows, operation.columns) : rows.filter(isRecord), operation.columns);
    printPaginationHint(nextUrlOf(operation, data));
    return;
  }
  if (operation.view === 'keyValue') {
    const target = operation.rowsPath ? pick(data, operation.rowsPath) : data;
    if (!isRecord(target)) {
      formatTable([]);
      return;
    }
    formatKeyValue(operation.columns ? flattenRows([target], operation.columns)[0] : target);
    return;
  }
  formatJson(data);
}

function defineOperationCommand(command: Command, operation: ManifestOperation): void {
  const bindings = operation.params.map(param => ({ param, option: paramOption(param) }));
  for (const { option } of bindings) command.addOption(option);
  if (operation.body) {
    command.option('--body <json>', `JSON request body${operation.body.required ? ' (this or --body-file is required)' : ''}`);
    command.option('--body-file <path>', 'Read the JSON request body from a file (- = stdin)');
  }

  command.action(withErrorHandling(async (_opts: unknown, invoked: Command) => {
    const globals = invoked.optsWithGlobals();
    const json = globals.json === true;
    if (json) setJsonMode(true);
    if (globals.all === true && operation.pagination === 'none') {
      throw new Error(`invd ${[operation.group, operation.action].filter(Boolean).join(' ')} does not paginate; --all has nothing to fetch`);
    }

    const values = wireValues(bindings, invoked.opts());
    const body = operation.body ? await requestBody(operation, invoked.opts()) : undefined;
    const path = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
      const value = values.get(name);
      return encodeURIComponent(typeof value === 'string' ? value : '');
    });
    const params: Record<string, string | string[] | undefined> = {};
    for (const param of operation.params) {
      if (param.in === 'query') params[param.name] = values.get(param.name);
    }

    let data: unknown = operation.method === 'get'
      ? await apiGet<unknown>({ path, params })
      : await apiRequest<unknown>({
        method: operation.method === 'post' ? 'POST'
          : operation.method === 'put' ? 'PUT'
            : operation.method === 'patch' ? 'PATCH' : 'DELETE',
        path,
        params,
        ...(body !== undefined ? { body } : {}),
      });

    if (globals.all === true) {
      const itemsPaths = operation.allItemsPath ?? [];
      data = operation.pagination === 'top'
        ? await fetchAllTopPages(data, itemsPaths)
        : await fetchAllCompanyPages(data, itemsPaths);
    }

    if (data === undefined) {
      // A 204: nothing to show but that it worked.
      if (!json) console.log('Done.');
      return;
    }
    output(data, { json }, () => renderView(operation, data));
  }));
}
