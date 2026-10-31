/**
 * openapi.json → src/generated/cli-manifest.json, the committed manifest `invd` registers its generated commands
 * from (`src/spec-commands.ts`). `--check` exits 1 when the committed file is not what the bundled spec produces.
 *
 *   pnpm cli:manifest          rewrite the manifest
 *   pnpm cli:manifest:check    the drift gate
 *
 * The spec's `x-cli` is validated at its source (`invinite-data-api` `src/lib/cliMetadata.ts`); this builder only
 * refuses what the MANIFEST adds: one description per group, parameter types it can map, flag names that do not
 * collide with the program's own, an `--all` path for every paginated operation.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  MANIFEST_ITEM_TYPES,
  MANIFEST_METHODS,
  MANIFEST_PAGINATIONS,
  MANIFEST_PARAM_TYPES,
  MANIFEST_VIEWS,
  parseManifest,
  type Manifest,
  type ManifestOperation,
  type ManifestParam,
} from '../src/spec-manifest.js';
import { BODY_FLAGS, flagName, RESERVED_ALIASES, RESERVED_FLAGS } from '../src/spec-flags.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SPEC_PATH = resolve(REPO_ROOT, 'openapi.json');
export const DEFAULT_MANIFEST_PATH = resolve(REPO_ROOT, 'src/generated/cli-manifest.json');

const schemaSchema = z.object({
  type: z.unknown().optional(),
  items: z.object({ type: z.unknown().optional(), enum: z.array(z.unknown()).optional() }).passthrough().optional(),
  enum: z.array(z.unknown()).optional(),
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
    view: z.enum(MANIFEST_VIEWS).optional(),
    rowsPath: z.string().optional(),
    columns: z.array(z.string()).optional(),
    flags: z.record(z.string()).optional(),
    allItemsPath: z.union([z.string(), z.array(z.string())]).optional(),
    groupDescription: z.string().optional(),
    pagination: z.enum(MANIFEST_PAGINATIONS),
  }).passthrough(),
]);

const operationSchema = z.object({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parameters: z.array(z.union([refSchema, parameterSchema])).optional(),
  requestBody: z.object({ required: z.boolean().optional(), content: z.record(z.unknown()) }).passthrough().optional(),
  security: z.array(z.record(z.unknown())).optional(),
  'x-cli': cliSchema.optional(),
  'x-example-params': z.array(z.string()).optional(),
}).passthrough();

const specSchema = z.object({
  info: z.object({ version: z.string() }).passthrough(),
  tags: z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()).optional(),
  components: z.object({ parameters: z.record(parameterSchema).optional() }).passthrough().optional(),
  security: z.array(z.record(z.unknown())).optional(),
  paths: z.record(z.record(z.unknown())),
}).passthrough();

type Spec = z.infer<typeof specSchema>;
type SpecParameter = z.infer<typeof parameterSchema>;

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

function manifestParam(
  parameter: SpecParameter,
  alias: string | undefined,
  where: string,
  hasBody: boolean,
): ManifestParam {
  const at = `${where} parameter "${parameter.name}"`;
  if (parameter.in !== 'query' && parameter.in !== 'path') {
    throw new Error(`${at}: parameters "in: ${parameter.in}" cannot be a flag`);
  }
  const schema = parameter.schema ?? {};
  if (!isParamType(schema.type)) throw new Error(`${at}: unmappable type ${JSON.stringify(schema.type)}`);
  const flag = flagName(parameter.name);
  if (RESERVED_FLAGS.includes(flag) || (hasBody && BODY_FLAGS.includes(flag))) {
    throw new Error(`${at}: --${flag} collides with an invd flag of its own`);
  }
  if (alias !== undefined && RESERVED_ALIASES.includes(alias)) {
    throw new Error(`${at}: -${alias} collides with an invd flag of its own`);
  }
  const param: ManifestParam = {
    name: parameter.name,
    in: parameter.in,
    required: parameter.in === 'path' || parameter.required === true,
    type: schema.type,
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
  if (schema.default !== undefined) param.default = schema.default;
  if (parameter.example !== undefined) param.example = parameter.example;
  if (parameter.description) param.description = parameter.description;
  if (alias !== undefined) param.alias = alias;
  return param;
}

/** The pure transform; `specText` is hashed so a stale manifest is visible on its face. */
export function buildManifest(rawSpec: unknown, specText: string): Manifest {
  const spec = specSchema.parse(rawSpec);
  const tagDescriptions = new Map((spec.tags ?? []).map(tag => [tag.name, tag.description ?? '']));
  const operations: ManifestOperation[] = [];
  const groupFacts = new Map<string, { explicit: Set<string>; tags: Set<string> }>();

  for (const [path, item] of Object.entries(spec.paths)) {
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const [method, rawOperation] of Object.entries(item)) {
      if (!isMethod(method)) continue; // `parameters`, and the non-HTTP `ws`
      const where = `${method.toUpperCase()} ${path}`;
      const operation = operationSchema.parse(rawOperation);
      const cli = operation['x-cli'];
      if (!cli) throw new Error(`${where}: no x-cli`);
      if ('exclude' in cli) continue;
      if (!operation.operationId) throw new Error(`${where}: no operationId`);

      const parameters = [...shared, ...(operation.parameters ?? [])].map(raw => resolveParameter(spec, raw, where));
      const params = parameters.map(parameter =>
        manifestParam(parameter, cli.flags?.[parameter.name], where, operation.requestBody !== undefined),
      );

      const view = cli.view ?? 'json';
      const out: ManifestOperation = {
        operationId: operation.operationId,
        group: cli.group,
        action: cli.action,
        method,
        path,
        // The operation's own `security` wins over the document's; none at all = public.
        auth: (operation.security ?? spec.security ?? []).length > 0,
        summary: operation.summary ?? '',
        params,
        view,
        pagination: cli.pagination,
      };

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
        out.body = { required: operation.requestBody.required === true, contentType: 'application/json' };
        const media = operation.requestBody.content['application/json'];
        if (typeof media === 'object' && media !== null && 'example' in media) out.body.example = media.example;
      }
      if (cli.rowsPath !== undefined) out.rowsPath = cli.rowsPath;
      if (cli.columns) out.columns = cli.columns;

      const authored = typeof cli.allItemsPath === 'string' ? [cli.allItemsPath] : cli.allItemsPath;
      if (cli.pagination === 'perCompany') {
        if (!authored) throw new Error(`${where}: a perCompany operation needs x-cli.allItemsPath`);
        out.allItemsPath = authored;
      } else if (cli.pagination === 'top') {
        const paths = authored ?? (cli.rowsPath !== undefined ? [cli.rowsPath] : undefined);
        if (!paths) throw new Error(`${where}: a top-paginated operation needs x-cli.rowsPath or allItemsPath`);
        out.allItemsPath = paths;
      }
      operations.push(out);

      const facts = groupFacts.get(cli.group) ?? { explicit: new Set<string>(), tags: new Set<string>() };
      if (cli.groupDescription !== undefined) facts.explicit.add(cli.groupDescription);
      for (const tag of operation.tags ?? []) facts.tags.add(tag);
      groupFacts.set(cli.group, facts);
    }
  }

  const groups = [...groupFacts].map(([name, facts]) => {
    if (facts.explicit.size > 1) {
      throw new Error(`group "${name}": two descriptions (${[...facts.explicit].join(' | ')})`);
    }
    const [explicit] = facts.explicit;
    if (explicit !== undefined) return { name, description: explicit };
    const [tag, ...more] = facts.tags;
    if (tag === undefined || more.length > 0) {
      throw new Error(`group "${name}": spans ${facts.tags.size} tags and sets no x-cli.groupDescription`);
    }
    return { name, description: tagDescriptions.get(tag) ?? '' };
  });

  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  groups.sort((a, b) => byName(a.name, b.name));
  operations.sort((a, b) => byName(a.group, b.group) || byName(a.action, b.action));

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
