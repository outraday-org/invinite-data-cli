/**
 * openapi.json → src/generated/cli-manifest.json, the committed manifest `invd` registers its generated commands
 * from (`src/spec-commands.ts`). `--check` exits 1 when the committed file is not what the bundled spec produces.
 *
 *   pnpm cli:manifest          rewrite the manifest
 *   pnpm cli:manifest:check    the drift gate
 *
 * Only the `/v1` operations become commands (`/health` and `/status*` stay hand-written; since invd 5.0 the contract
 * designed as v2 is served under `/v1`). The spec's `x-cli` is validated at its source (`invinite-data-api`
 * conventions lint); this builder derives what the §7 `x-cli` no longer states — list-ness from the response envelope, the view from the shape,
 * body flags from the request schema, the download object — and refuses what the MANIFEST would get wrong: flag
 * names that collide with the program's own, an unmappable parameter type, one command spelled twice.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  MANIFEST_ITEM_TYPES,
  MANIFEST_METHODS,
  MANIFEST_PARAM_TYPES,
  commandName,
  parseManifest,
  type Manifest,
  type ManifestBodyField,
  type ManifestOperation,
  type ManifestParam,
} from '../src/spec-manifest.js';
import {
  COMMAND_FLAGS,
  GLOBAL_PARAM_FLAGS,
  RESERVED_ALIASES,
  RESERVED_FLAGS,
  SELECT_FLAGS,
  flagName,
} from '../src/spec-flags.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SPEC_PATH = resolve(REPO_ROOT, 'openapi.json');
export const DEFAULT_MANIFEST_PATH = resolve(REPO_ROOT, 'src/generated/cli-manifest.json');

/**
 * The `--help` line of a group whose operations span several spec tags or share their tag with another group (the
 * v2 `x-cli` has no `groupDescription`; proposed upstream as decision D7 of task 10). Any other group takes its
 * tag's description.
 */
export const GROUP_DESCRIPTIONS: Readonly<Record<string, string>> = {
  companies: 'Listed companies: list, profile, fiscal periods, dividends and splits',
  events: 'Earnings calls and other corporate events: transcripts, Q&A, media and call analytics',
  filers: 'Every SEC filer (13F managers, pre-IPO issuers, former registrants), listed or not',
  market: 'US market holidays',
  metrics: 'Ratios, growth, CAGR, and the explanation of one standardized fact',
  people: 'Executives and analysts, and who took part in which event',
  search: 'Full-text search over SEC filings, transcripts, investor documents and news',
  segments: 'Segment values (revenue by product, geography …); list-detailed adds lineage (PRO)',
};

/**
 * Spec aliases `invd` cannot honour because commander owns the letter (`-h` is help). Listed one by one so a new
 * collision still fails the build; proposed upstream as decision D8 of task 10 (`x-cli.flags.horizon: "H"`).
 */
export const DROPPED_ALIASES: Readonly<Record<string, string>> = { 'GET /v1/metrics/cagr horizon': 'h' };

/** The parameter a positional joins several words into: company lists with `,`, search text with a space. */
const VARIADIC: Readonly<Record<string, 'comma' | 'space'>> = { company: 'comma', q: 'space' };

const schemaSchema = z.object({
  type: z.unknown().optional(),
  items: z.object({ type: z.unknown().optional(), enum: z.array(z.unknown()).optional() }).passthrough().optional(),
  enum: z.array(z.unknown()).optional(),
  pattern: z.string().optional(),
  default: z.unknown().optional(),
}).passthrough();

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: schemaSchema.optional(),
  example: z.unknown().optional(),
}).passthrough();

const refSchema = z.object({ $ref: z.string() });

const cliSchema = z.union([
  z.object({ exclude: z.string() }).passthrough(),
  z.object({
    group: z.string(),
    action: z.string(),
    positional: z.string().optional(),
    columns: z.array(z.string()).optional(),
    flags: z.record(z.string()).optional(),
    command: z.string().optional(),
    select: z.record(z.string()).optional(),
  }).passthrough(),
]);

const operationSchema = z.object({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parameters: z.array(z.union([refSchema, parameterSchema])).optional(),
  requestBody: z.object({ required: z.boolean().optional(), content: z.record(z.unknown()) }).passthrough().optional(),
  responses: z.record(z.unknown()).optional(),
  security: z.array(z.record(z.unknown())).optional(),
  'x-cli': cliSchema.optional(),
  'x-credits': z.number().optional(),
  'x-tier': z.string().optional(),
  'x-example-params': z.array(z.string()).optional(),
}).passthrough();

const specSchema = z.object({
  info: z.object({ version: z.string() }).passthrough(),
  tags: z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()).optional(),
  components: z.object({
    parameters: z.record(parameterSchema).optional(),
    schemas: z.record(z.unknown()).optional(),
  }).passthrough().optional(),
  security: z.array(z.record(z.unknown())).optional(),
  paths: z.record(z.record(z.unknown())),
}).passthrough();

type Spec = z.infer<typeof specSchema>;
type SpecParameter = z.infer<typeof parameterSchema>;
type JsonSchema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isMethod = (value: string): value is ManifestOperation['method'] =>
  MANIFEST_METHODS.some(method => method === value);
const isParamType = (value: unknown): value is ManifestParam['type'] =>
  MANIFEST_PARAM_TYPES.some(type => type === value);
const isItemType = (value: unknown): value is NonNullable<ManifestParam['items']> =>
  MANIFEST_ITEM_TYPES.some(type => type === value);

function resolveParameter(spec: Spec, raw: unknown, where: string): SpecParameter {
  const ref = refSchema.safeParse(raw);
  if (ref.success) {
    const name = ref.data.$ref.replace(/^#\/components\/parameters\//, '');
    const target = spec.components?.parameters?.[name];
    if (!target) throw new Error(`${where}: unresolvable parameter $ref ${ref.data.$ref}`);
    return target;
  }
  return parameterSchema.parse(raw);
}

/** A schema with its `$ref`s followed and an `allOf` merged (properties only); `{}` when unresolvable. */
function resolveSchema(spec: Spec, raw: unknown, depth = 0): JsonSchema {
  if (!isRecord(raw) || depth > 20) return {};
  if (typeof raw.$ref === 'string') {
    const target = spec.components?.schemas?.[raw.$ref.replace(/^#\/components\/schemas\//, '')];
    return resolveSchema(spec, target, depth + 1);
  }
  if (Array.isArray(raw.allOf)) {
    const parts = raw.allOf.map(part => resolveSchema(spec, part, depth + 1));
    const properties = Object.assign({}, ...parts.map(part => (isRecord(part.properties) ? part.properties : {})));
    return { ...raw, type: 'object', properties };
  }
  return raw;
}

const propertiesOf = (spec: Spec, schema: JsonSchema): Record<string, JsonSchema> => {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, resolveSchema(spec, value)]));
};

function successSchema(spec: Spec, operation: z.infer<typeof operationSchema>): JsonSchema | undefined {
  const responses = operation.responses ?? {};
  const response = [responses['200'], responses['201']].find(isRecord);
  const content = response && isRecord(response.content) ? response.content['application/json'] : undefined;
  return isRecord(content) ? resolveSchema(spec, content.schema) : undefined;
}

/** A file the API states: an object with `url` and its `bytes` or `sha256`. */
const isDownloadObject = (spec: Spec, schema: JsonSchema): boolean => {
  const properties = propertiesOf(spec, schema);
  return 'url' in properties && ('bytes' in properties || 'sha256' in properties);
};

function downloadPath(spec: Spec, schema: JsonSchema): string | undefined {
  if (isDownloadObject(spec, schema)) return '';
  for (const [key, child] of Object.entries(propertiesOf(spec, schema))) {
    if (isDownloadObject(spec, child)) return key;
  }
  return undefined;
}

function manifestParam(
  parameter: SpecParameter,
  alias: string | undefined,
  where: string,
  reserved: readonly string[],
): ManifestParam {
  const at = `${where} parameter "${parameter.name}"`;
  if (parameter.in !== 'query' && parameter.in !== 'path' && parameter.in !== 'header') {
    throw new Error(`${at}: parameters "in: ${parameter.in}" cannot be a flag`);
  }
  const schema = parameter.schema ?? {};
  if (!isParamType(schema.type)) throw new Error(`${at}: unmappable type ${JSON.stringify(schema.type)}`);
  const flag = flagName(parameter.name);
  if (!GLOBAL_PARAM_FLAGS.includes(flag) && reserved.includes(flag)) {
    throw new Error(`${at}: --${flag} collides with an invd flag of its own`);
  }
  if (alias !== undefined && RESERVED_ALIASES.includes(alias) && DROPPED_ALIASES[`${where} ${parameter.name}`] !== alias) {
    throw new Error(`${at}: -${alias} collides with an invd flag of its own`);
  }
  const param: ManifestParam = {
    name: parameter.name,
    in: parameter.in,
    required: parameter.in === 'path' || parameter.required === true,
    type: schema.type,
    flag,
  };
  let values = schema.enum;
  if (schema.type === 'array') {
    if (!isItemType(schema.items?.type)) {
      throw new Error(`${at}: unmappable array item type ${JSON.stringify(schema.items?.type)}`);
    }
    param.items = schema.items.type;
    values = schema.items.enum;
  }
  if (values) param.enum = values.map(value => String(value));
  if (schema.pattern !== undefined) param.pattern = schema.pattern;
  if (schema.default !== undefined) param.default = schema.default;
  if (parameter.example !== undefined) param.example = parameter.example;
  if (parameter.description) param.description = parameter.description;
  if (alias !== undefined && !RESERVED_ALIASES.includes(alias)) param.alias = alias;
  return param;
}

/** Flags for a JSON body's scalar and list properties, one object level deep (`filters.ciks` → `--ciks`). */
function bodyFields(
  spec: Spec,
  schema: JsonSchema,
  aliases: Record<string, string>,
  taken: Set<string>,
  where: string,
): ManifestBodyField[] {
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const fields: ManifestBodyField[] = [];
  const add = (path: string[], property: JsonSchema, isRequired: boolean) => {
    if (!isParamType(property.type)) return;
    const items = isRecord(property.items) ? property.items.type : undefined;
    if (property.type === 'array' && !isItemType(items)) return;
    const name = path[path.length - 1] ?? '';
    const flag = flagName(name);
    if (taken.has(flag) || RESERVED_FLAGS.includes(flag) || COMMAND_FLAGS.includes(flag)) {
      throw new Error(`${where} body property "${path.join('.')}": --${flag} collides with another flag`);
    }
    taken.add(flag);
    const field: ManifestBodyField = { path, type: property.type, required: isRequired, flag };
    if (property.type === 'array' && isItemType(items)) field.items = items;
    if (typeof property.description === 'string') field.description = property.description;
    const alias = aliases[name];
    if (alias !== undefined) field.alias = alias;
    fields.push(field);
  };
  for (const [key, property] of Object.entries(propertiesOf(spec, schema))) {
    if (property.type === 'object') {
      for (const [inner, innerProperty] of Object.entries(propertiesOf(spec, property))) {
        add([key, inner], innerProperty, false);
      }
    } else {
      add([key], property, required.has(key));
    }
  }
  return fields;
}

/** The pure transform; `specText` is hashed so a stale manifest is visible on its face. */
export function buildManifest(rawSpec: unknown, specText: string): Manifest {
  const spec = specSchema.parse(rawSpec);
  const tagDescriptions = new Map((spec.tags ?? []).map(tag => [tag.name, tag.description ?? '']));
  const operations: ManifestOperation[] = [];
  const groupTags = new Map<string, Set<string>>();
  const commands = new Map<string, string>();

  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith('/v1/')) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const [method, rawOperation] of Object.entries(item)) {
      if (!isMethod(method)) continue; // `parameters`, and the non-HTTP `ws`
      const where = `${method.toUpperCase()} ${path}`;
      const operation = operationSchema.parse(rawOperation);
      const cli = operation['x-cli'];
      if (!cli) throw new Error(`${where}: no x-cli`);
      if ('exclude' in cli) continue;
      if (!operation.operationId) throw new Error(`${where}: no operationId`);
      if (operation['x-credits'] === undefined || operation['x-tier'] === undefined) {
        throw new Error(`${where}: x-credits / x-tier missing`);
      }

      const multi = cli.command !== undefined;
      const group = cli.command ?? cli.group;
      const action = multi ? '' : cli.action;
      const reserved = [...RESERVED_FLAGS, ...COMMAND_FLAGS, ...(multi ? SELECT_FLAGS : [])];
      const parameters = [...shared, ...(operation.parameters ?? [])].map(raw => resolveParameter(spec, raw, where));
      const params = parameters.map(parameter => manifestParam(parameter, cli.flags?.[parameter.name], where, reserved));

      const success = successSchema(spec, operation);
      const successProps = success ? propertiesOf(spec, success) : {};
      const list = 'next_cursor' in successProps && 'data' in successProps;
      const row = list ? resolveSchema(spec, successProps.data?.items) : (success ?? {});
      const fields = Object.keys(propertiesOf(spec, row));

      const out: ManifestOperation = {
        operationId: operation.operationId,
        group,
        action,
        method,
        path,
        // The operation's own `security` wins over the document's; none at all = public.
        auth: (operation.security ?? spec.security ?? []).length > 0,
        summary: operation.summary ?? '',
        credits: operation['x-credits'],
        tier: operation['x-tier'],
        params,
        list,
        view: cli.columns ? (list ? 'table' : 'keyValue') : 'json',
        fields,
      };

      if (cli.positional !== undefined) {
        const param = params.find(candidate => candidate.name === cli.positional);
        if (!param) throw new Error(`${where}: x-cli.positional names no parameter: ${cli.positional}`);
        out.positional = { name: param.name, required: param.required };
        const variadic = param.in === 'query' ? VARIADIC[param.name] : undefined;
        if (variadic) out.positional.variadic = variadic;
      }
      if (cli.select) out.select = cli.select;

      const exampleParams = operation['x-example-params'];
      if (exampleParams && exampleParams.length > 0) {
        const unknown = exampleParams.filter(name => !params.some(param => param.name === name));
        if (unknown.length > 0) throw new Error(`${where}: x-example-params names no parameter: ${unknown.join(', ')}`);
        out.exampleParams = exampleParams;
      }

      if (operation.requestBody) {
        const types = Object.keys(operation.requestBody.content);
        if (types.length !== 1 || types[0] !== 'application/json') {
          throw new Error(`${where}: request body ${types.join(', ')} is not application/json`);
        }
        const media = operation.requestBody.content['application/json'];
        const schema = isRecord(media) ? resolveSchema(spec, media.schema) : {};
        const taken = new Set(params.map(param => param.flag));
        out.body = {
          required: operation.requestBody.required === true,
          contentType: 'application/json',
          fields: bodyFields(spec, schema, cli.flags ?? {}, taken, where),
        };
        if (isRecord(media) && 'example' in media) out.body.example = media.example;
      }
      if (cli.columns) out.columns = cli.columns;
      const download = success && method === 'get' && !list ? downloadPath(spec, success) : undefined;
      if (download !== undefined) out.download = download;

      // One spelling per command; the operations of a multi-operation command differ by their `select`.
      const key = `${commandName(out)} ${JSON.stringify(out.select ?? null)}`;
      const previous = commands.get(key);
      if (previous) throw new Error(`${where}: invd ${commandName(out)} is also ${previous}`);
      commands.set(key, where);

      operations.push(out);
      const tags = groupTags.get(group) ?? new Set<string>();
      for (const tag of operation.tags ?? []) tags.add(tag);
      groupTags.set(group, tags);
    }
  }

  const groups = [...groupTags].map(([name, tags]) => {
    const explicit = GROUP_DESCRIPTIONS[name];
    if (explicit !== undefined) return { name, description: explicit };
    const [tag, ...more] = tags;
    if (tag === undefined || more.length > 0) {
      throw new Error(`group "${name}": spans ${tags.size} tags and has no GROUP_DESCRIPTIONS entry`);
    }
    const sharedWith = [...groupTags].filter(([other, otherTags]) => other !== name && !(other in GROUP_DESCRIPTIONS) && otherTags.has(tag)).map(([other]) => other);
    if (sharedWith.length > 0) {
      throw new Error(`group "${name}": shares tag "${tag}" with ${sharedWith.join(', ')} and has no GROUP_DESCRIPTIONS entry`);
    }
    return { name, description: tagDescriptions.get(tag) ?? '' };
  });

  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  groups.sort((a, b) => byName(a.name, b.name));
  operations.sort((a, b) => byName(a.group, b.group) || byName(a.action, b.action) || byName(a.operationId, b.operationId));

  return parseManifest({
    specVersion: spec.info.version,
    specSha256: createHash('sha256').update(specText).digest('hex'),
    groups,
    operations,
  }, 'built from openapi.json');
}

export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Writes (or, with `check`, compares) the manifest; returns the exit code. */
export function runBuildCliManifest(options: { specPath: string; manifestPath: string; check: boolean }): number {
  const specText = readFileSync(options.specPath, 'utf8');
  const next = serializeManifest(buildManifest(JSON.parse(specText), specText));
  if (options.check) {
    let current = '';
    try {
      current = readFileSync(options.manifestPath, 'utf8');
    } catch {
      // missing → stale
    }
    if (current === next) {
      console.log(`cli manifest up to date (${options.manifestPath})`);
      return 0;
    }
    console.error(`cli manifest is stale: ${options.manifestPath} differs from what ${options.specPath} produces — run pnpm cli:manifest`);
    return 1;
  }
  mkdirSync(dirname(options.manifestPath), { recursive: true });
  writeFileSync(options.manifestPath, next);
  console.log(`wrote ${options.manifestPath}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runBuildCliManifest({
      specPath: DEFAULT_SPEC_PATH,
      manifestPath: DEFAULT_MANIFEST_PATH,
      check: process.argv.includes('--check'),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
