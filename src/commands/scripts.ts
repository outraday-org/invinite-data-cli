import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Command } from 'commander';
import { apiCall } from '../client/api-client.js';
import { UsageError, withErrorHandling } from '../shared/errors.js';

/** The API's limit on one source (`CreateScriptRequest.source`, `maxLength` 204800). */
export const MAX_SOURCE_BYTES = 204_800;
/** The API's limit on a script name (`CreateScriptRequest.name`, `maxLength` 100). */
const MAX_NAME_LENGTH = 100;

export interface ScriptDiagnostic {
  line: number;
  column: number;
  message: string;
  code: string;
  severity: 'error' | 'warning';
}

/** The fields of a `ScriptVersion` the upload prints. */
export interface UploadedVersion {
  id: string;
  script_id: string;
  version: number;
  status: 'ok' | 'error';
  diagnostics: ScriptDiagnostic[];
  alert_ids: string[];
}

export interface UploadResult {
  /** The script's name (only known for a new script). */
  name?: string;
  version: UploadedVersion;
  /** The response body as returned (`Script` for a new script, `ScriptVersion` for a new version). */
  body: unknown;
}

interface UploadFlags {
  name?: string;
  script?: string;
  description?: string;
  json?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `invd scripts upload <file>`: a subcommand of the generated `scripts` group (registered after the spec commands).
 * Not one call plus one view: it reads a local file into the request body and turns a `status: error` version (still
 * a 201) into exit 1 with the compiler's diagnostics. `pnpm reference:export` reads the command's API paths (the
 * `path:` literals) and method from the code after this registration.
 */
export function registerScriptsUploadCommand(program: Command): void {
  const group = program.commands.find(command => command.name() === 'scripts');
  if (!group) throw new Error('invd scripts upload needs the scripts group of the manifest');
  group
    .command('upload')
    .description('Upload a chartlang file: a new script (version 1), or with --script the next version of one; prints the compile status and diagnostics')
    .argument('<file>', 'The chartlang (TypeScript) source file, e.g. ema-cross.chart (≤ 200 KB)')
    .option('-n, --name <name>', 'Name of the new script (default: the file name without its extension)')
    .option('--description <text>', 'Description of the new script')
    .option('--script <scr-id>', 'Add the next version to this script (scr_…) instead of creating a new one')
    .option('--json', 'Print the API response as JSON (a Script, or a ScriptVersion with --script)')
    .addHelpText('before', [
      'Examples:',
      '  $ invd scripts upload ema-cross.chart',
      '  $ invd scripts upload ema-cross.chart --script scr_01JD2Q4X7Y8Z9A0B1C2D3E4F5G',
      '',
    ].join('\n'))
    .addHelpText('after', [
      '',
      'A compile error is exit 1 after the diagnostics (file:line:column severity message). The version id (scv_…) is',
      'the script_version_id of a `script` alert; its alert ids are the condition.alert_ids it can name.',
      '',
    ].join('\n'))
    .action(withErrorHandling(async (file: string, _raw: Record<string, unknown>, command: Command) => {
      const flags = command.opts<UploadFlags>();
      if (flags.script !== undefined && (flags.name !== undefined || flags.description !== undefined)) {
        throw new UsageError('--name and --description name a new script; --script adds a version to an existing one');
      }
      const source = await readSource(file);
      const result = flags.script === undefined
        ? await createScript({ name: flags.name ?? defaultScriptName(file), description: flags.description, source })
        : await createScriptVersion(flags.script, source);
      if (flags.json) process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
      else for (const line of formatUpload(result, file)) process.stdout.write(`${line}\n`);
      const errors = result.version.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
      if (result.version.status === 'error') {
        throw new Error(`${file} did not compile (${errors || 'unknown'} error${errors === 1 ? '' : 's'}); version ${result.version.version} is stored but no alert can use it`);
      }
    }));
}

/** `POST /v1/scripts`: the script and its version 1, compiled server-side. */
export async function createScript(body: { name: string; description?: string; source: string }): Promise<UploadResult> {
  const response = await apiCall({ path: '/v1/scripts', method: 'POST', body });
  const script = response.body;
  if (!isRecord(script) || !isRecord(script.latest_version)) throw new Error('The API answered without the uploaded version (latest_version)');
  return { name: typeof script.name === 'string' ? script.name : body.name, version: toVersion(script.latest_version), body: script };
}

/** `POST /v1/scripts/{id}/versions`: the next version of a script. */
export async function createScriptVersion(id: string, source: string): Promise<UploadResult> {
  const response = await apiCall({ path: `/v1/scripts/${encodeURIComponent(id)}/versions`, method: 'POST', body: { source } });
  if (!isRecord(response.body)) throw new Error('The API answered without the uploaded version');
  return { version: toVersion(response.body), body: response.body };
}

function toVersion(value: Record<string, unknown>): UploadedVersion {
  const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics.filter(isRecord) : [];
  return {
    id: String(value.id ?? ''),
    script_id: String(value.script_id ?? ''),
    version: Number(value.version ?? 0),
    status: value.status === 'ok' ? 'ok' : 'error',
    diagnostics: diagnostics.map(diagnostic => ({
      line: Number(diagnostic.line ?? 0),
      column: Number(diagnostic.column ?? 0),
      message: String(diagnostic.message ?? ''),
      code: String(diagnostic.code ?? ''),
      severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
    })),
    alert_ids: Array.isArray(value.alert_ids) ? value.alert_ids.map(String) : [],
  };
}

/** The file's text; refuses an empty file and one over the API's limit before any request. */
export async function readSource(file: string): Promise<string> {
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    throw new Error(code === 'ENOENT' ? `${file}: no such file` : `${file}: cannot be read (${code || String(error)})`);
  }
  if (!source.trim()) throw new UsageError(`${file} is empty`);
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > MAX_SOURCE_BYTES) throw new UsageError(`${file} is ${bytes} bytes; a script source may be at most ${MAX_SOURCE_BYTES} (200 KB)`);
  return source;
}

/** The file name without its extension (`strategies/ema-cross.chart` → `ema-cross`), cut to the API's 100 characters. */
export function defaultScriptName(file: string): string {
  const name = basename(file, extname(file)) || basename(file);
  return name.slice(0, MAX_NAME_LENGTH);
}

/** The printed result: one summary line, the alert ids, then one `file:line:column severity message (code)` per diagnostic. */
export function formatUpload(result: UploadResult, file: string): string[] {
  const { version } = result;
  const named = result.name === undefined ? '' : ` "${result.name}"`;
  const lines = [`${version.script_id}${named} version ${version.version} (${version.id}): ${version.status === 'ok' ? 'compiled' : 'compile error'}`];
  if (version.status === 'ok' && version.alert_ids.length) lines.push(`alert ids: ${version.alert_ids.join(', ')}`);
  for (const diagnostic of version.diagnostics) {
    lines.push(`${file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.message}${diagnostic.code ? ` (${diagnostic.code})` : ''}`);
  }
  return lines;
}
