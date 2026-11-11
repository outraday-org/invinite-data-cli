import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Command } from 'commander';
import { apiCall, buildUrl, type HttpMethod, type RequestOptions } from '../client/api-client.js';
import { getBaseUrl } from '../config/config-manager.js';
import { nextCursorOf, rowsOf, walkPages } from '../client/pagination.js';
import { runJq } from '../output/jq.js';
import { emit } from '../output/render.js';
import { PartialResultError, UsageError, withErrorHandling } from '../shared/errors.js';
import { confirmOrRefuse, readStdin } from '../shared/prompt.js';
import { setJsonMode } from '../shared/spinner.js';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** `-F key=value`: `true` / `false` / `null` and numbers typed, `@file` read from a file, anything else a string. */
async function typedValue(raw: string): Promise<unknown> {
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('@')) return (await readFile(raw.slice(1), 'utf8')).replace(/\n$/, '');
  return raw;
}

/** A scheme (`https:`) or a protocol-relative `//host`: an absolute URL, not a path. */
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The path (+ query) `invd api` sends to the configured API. An absolute URL is accepted only on the API's own
 * origin (its path is used); any other host is refused — the request carries the API key.
 */
export function apiPathOf(rawPath: string, baseUrl = getBaseUrl()): string {
  if (!ABSOLUTE_URL.test(rawPath)) return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const base = new URL(baseUrl);
  let target: URL;
  try {
    target = new URL(rawPath, base);
  } catch {
    throw new UsageError(`${rawPath} is not a URL or an API path`);
  }
  if (target.origin !== base.origin) {
    throw new UsageError(`invd api only calls ${base.origin} (the request carries your API key); refusing ${target.origin}. Pass a path such as /v1/companies/AAPL`);
  }
  const prefix = base.pathname.replace(/\/+$/, '');
  const path = prefix && target.pathname.startsWith(`${prefix}/`) ? target.pathname.slice(prefix.length) : target.pathname;
  return `${path}${target.search}`;
}

function splitPair(pair: string, separator: string, flag: string): [string, string] {
  const index = pair.indexOf(separator);
  if (index <= 0) throw new UsageError(`${flag} expects key${separator}value (got ${pair})`);
  return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
}

interface ApiOpts {
  field?: string[];
  rawField?: string[];
  header?: string[];
  input?: string;
  paginate?: boolean;
  jq?: string;
  dryRun?: boolean;
  yes?: boolean;
  showCost?: boolean;
}

/** The request `invd api [METHOD] <path> [-F k=v] [-f k=v] [-H 'Name: value'] [--input file]` describes. */
export async function apiRequestFrom(first: string, second: string | undefined, opts: ApiOpts): Promise<RequestOptions> {
  const upper = first.toUpperCase();
  const [method, rawPath] = second !== undefined
    ? [upper as HttpMethod, second]
    : METHODS.includes(upper as HttpMethod) ? [upper as HttpMethod, ''] : ['GET' as HttpMethod, first];
  if (!METHODS.includes(method)) throw new UsageError(`${first} is not an HTTP method (${METHODS.join(', ')})`);
  if (!rawPath) throw new UsageError('invd api needs a path, e.g. invd api /v1/companies/AAPL');
  const url = new URL(apiPathOf(rawPath), 'http://placeholder');
  const query: Record<string, string[]> = {};
  url.searchParams.forEach((value, key) => { (query[key] ??= []).push(value); });

  const fields: Array<[string, unknown]> = [];
  for (const pair of opts.field ?? []) {
    const [key, value] = splitPair(pair, '=', '-F');
    fields.push([key, await typedValue(value)]);
  }
  for (const pair of opts.rawField ?? []) fields.push(splitPair(pair, '=', '-f'));
  const headers: Record<string, string> = {};
  for (const pair of opts.header ?? []) {
    const [name, value] = splitPair(pair, ':', '-H');
    headers[name] = value;
  }

  let body: unknown;
  if (opts.input !== undefined) {
    const text = opts.input === '-' ? await readStdin() : await readFile(opts.input, 'utf8');
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new UsageError(`--input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (method === 'GET' || method === 'DELETE') {
    for (const [key, value] of fields) (query[key] ??= []).push(String(value));
  } else if (fields.length > 0) {
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
      throw new UsageError('--input must hold a JSON object to combine with -F / -f');
    }
    body = { ...(body as Record<string, unknown> | undefined), ...Object.fromEntries(fields) };
  }
  return {
    path: url.pathname,
    method,
    query,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

function print(body: unknown, jq: string | undefined): void {
  if (body === undefined) return;
  emit(jq ? runJq(jq, body).join('\n') : typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

/**
 * `invd api`: any operation of the spec, raw. `--paginate` follows `next_cursor` / `Link rel="next"` and prints
 * every page (each through `--jq`), so `invd api /v1/filings?company=AAPL --paginate --jq '.data[].accession'`
 * streams accessions.
 */
export function registerApiCommand(program: Command): void {
  program
    .command('api')
    .description('Call any API path directly (the escape hatch for anything the command tree lacks)')
    .argument('<method-or-path>', 'GET (default), POST, PATCH, DELETE … or the path')
    .argument('[path]', 'The path when a method is given, e.g. /v1/filings?company=AAPL')
    .option('-F, --field <key=value>', 'A parameter (query on GET / DELETE, JSON body field otherwise); typed: numbers, true / false, null, @file', collect, [])
    .option('-f, --raw-field <key=value>', 'Like -F, always a string', collect, [])
    .option('-H, --header <name:value>', 'An extra request header', collect, [])
    .option('--input <file>', 'The JSON request body from a file (- = stdin)')
    .option('--paginate', 'Follow next_cursor / Link rel="next" and print every page')
    .option('--jq <expr>', 'Filter each response with a jq expression (strings print raw)')
    .option('--dry-run', 'Print the request; send nothing')
    .option('--yes', 'Do not ask before a DELETE')
    .option('--no-input', 'Never prompt')
    .option('--show-cost', 'Print the credits this command cost to stderr')
    .addHelpText('before', [
      'Examples:',
      '  $ invd api /v1/companies/AAPL',
      "  $ invd api GET /v1/filings?company=AAPL --paginate --jq '.data[].accession'",
      '',
    ].join('\n'))
    .addHelpText('after', '\nPaths: invd completion <shell> completes every /v1 path of the spec after `invd api`.\n')
    .action(withErrorHandling(async (first: string, second: string | undefined, _raw: Record<string, unknown>, command: Command) => {
      const opts = command.opts<Omit<ApiOpts, 'input'> & { input?: string | boolean }>();
      // commander keeps --input <file> and --no-input in one attribute: a string is the file, false the switch.
      const input = typeof opts.input === 'string' ? opts.input : undefined;
      const request = await apiRequestFrom(first, second, { ...opts, input });
      if (opts.jq) setJsonMode(true);
      if (opts.dryRun) {
        emit(`${request.method} ${buildUrl(request.path, request.query)}${request.body !== undefined ? `\nbody: ${JSON.stringify(request.body)}` : ''}\ndry run: no request was sent`);
        return;
      }
      if (request.method === 'DELETE') {
        await confirmOrRefuse(`${request.method} ${request.path} deletes this resource.`, { yes: opts.yes, input: opts.input !== false });
      }
      const first_ = await apiCall(request);
      if (!opts.paginate) {
        print(first_.body, opts.jq);
        if (first_.body === undefined) console.error(chalk.green(`${first_.status} (no body)`));
        return;
      }
      let written = 0;
      let cursor: string | undefined;
      try {
        for await (const page of walkPages(request, first_)) {
          print(page.body, opts.jq);
          written += rowsOf(page.body).length || 1;
          cursor = nextCursorOf(page.body);
        }
      } catch (error) {
        if (written > 0) throw new PartialResultError(error, written, cursor);
        throw error;
      }
    }));
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
