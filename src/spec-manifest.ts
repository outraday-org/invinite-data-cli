import { z } from 'zod';

/**
 * The compact, committed form of the Data API v2 spec that `invd` registers its generated commands from
 * (`src/generated/cli-manifest.json`, written by `scripts/build-cli-manifest.ts` from `openapi.json`'s `x-cli`).
 * One schema for the builder's output, the startup loader and the dispatcher.
 */

export const MANIFEST_PARAM_TYPES = ['string', 'integer', 'number', 'boolean', 'array'] as const;
export const MANIFEST_ITEM_TYPES = ['string', 'integer', 'number'] as const;
export const MANIFEST_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export const MANIFEST_VIEWS = ['table', 'keyValue', 'json'] as const;

const manifestParamSchema = z.object({
  name: z.string().min(1),
  in: z.enum(['query', 'path', 'header']),
  required: z.boolean(),
  type: z.enum(MANIFEST_PARAM_TYPES),
  /** Arrays only: the item type; the value is sent as a repeated parameter. */
  items: z.enum(MANIFEST_ITEM_TYPES).optional(),
  /** Allowed values, stringified; on an array they apply to each item. */
  enum: z.array(z.string()).optional(),
  /** The spec's `pattern` (comma lists like `income-statement,balance-sheet` are patterns, not arrays). */
  pattern: z.string().optional(),
  /** Shown in help, never sent — the API applies its own default. */
  default: z.unknown().optional(),
  /** The spec's `example`: shown in help and in the examples, never sent. */
  example: z.unknown().optional(),
  description: z.string().optional(),
  /** One-letter short flag (`-q`). */
  alias: z.string().length(1).optional(),
  /** The long flag without dashes (`filed_at.gte` → `filed-at-gte`). */
  flag: z.string().min(1),
}).strict();

const bodyFieldSchema = z.object({
  /** The property's path in the JSON body (`["filters", "ciks"]`). */
  path: z.array(z.string().min(1)).min(1),
  type: z.enum(MANIFEST_PARAM_TYPES),
  items: z.enum(MANIFEST_ITEM_TYPES).optional(),
  required: z.boolean(),
  description: z.string().optional(),
  alias: z.string().length(1).optional(),
  flag: z.string().min(1),
}).strict();

const manifestOperationSchema = z.object({
  operationId: z.string().min(1),
  group: z.string().min(1),
  /** `""` = the group itself is the command (`invd financials`, the `x-cli.command` operations). */
  action: z.string(),
  method: z.enum(MANIFEST_METHODS),
  path: z.string().startsWith('/'),
  /** `false` = the operation needs no API key: no key is resolved or sent. */
  auth: z.boolean(),
  summary: z.string(),
  /** The spec's `x-credits`: the base cost of one response (`--dry-run`, the `--all` confirmation). */
  credits: z.number().nonnegative(),
  /** The spec's `x-tier` (free, lite, standard, pro). */
  tier: z.string(),
  params: z.array(manifestParamSchema),
  /** The parameter the first positional fills: a company list (`AAPL MSFT` → `company=AAPL,MSFT`), a member id, `q`. */
  positional: z.object({
    name: z.string().min(1),
    required: z.boolean(),
    /** Several words: joined with `,` (a company list) or ` ` (a search text). */
    variadic: z.enum(['comma', 'space']).optional(),
  }).strict().optional(),
  /** One command over several operations (`invd financials`): the `--basis` / `--view` values that pick this one. */
  select: z.record(z.string()).optional(),
  /** The spec's `x-example-params`: the OPTIONAL params an example invocation passes beside the required ones. */
  exampleParams: z.array(z.string().min(1)).min(1).optional(),
  body: z.object({
    required: z.boolean(),
    contentType: z.literal('application/json'),
    /** The spec's request-body `example`. */
    example: z.unknown().optional(),
    /** Flags for the body's scalar / list properties (`--url`, `--events a,b`, `--ciks` → `filters.ciks`). */
    fields: z.array(bodyFieldSchema),
  }).strict().optional(),
  /** A cursor-paginated list (`{data, has_more, next_cursor, meta}`): `--all`, `--cursor`, JSONL / CSV rows. */
  list: z.boolean(),
  view: z.enum(MANIFEST_VIEWS),
  columns: z.array(z.string()).optional(),
  /** The JSON fields of one row (a list's `data[]` item, else the object): `--json a,b` and `--help`. */
  fields: z.array(z.string()),
  /**
   * Where the response carries a downloadable file (`{url, sha256?, bytes?, content_type?}`): `""` = the response
   * root, else a dotted path (`pdf`, `deck`). Present = the command takes `--save <file>`.
   */
  download: z.string().optional(),
}).strict();

export const manifestSchema = z.object({
  specVersion: z.string(),
  specSha256: z.string().regex(/^[0-9a-f]{64}$/),
  groups: z.array(z.object({ name: z.string().min(1), description: z.string() }).strict()),
  operations: z.array(manifestOperationSchema),
}).strict();

export type ManifestParam = z.infer<typeof manifestParamSchema>;
export type ManifestBodyField = z.infer<typeof bodyFieldSchema>;
export type ManifestOperation = z.infer<typeof manifestOperationSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/** A param's spec example as its flag takes it: an array comma-joined, anything else as its text. */
export const exampleValue = (example: unknown): string =>
  Array.isArray(example) ? example.map(item => String(item)).join(',') : String(example);

/** `invd <group> <action>` without the program name (`financials`, `companies get`). */
export const commandName = (operation: Pick<ManifestOperation, 'group' | 'action'>): string =>
  [operation.group, operation.action].filter(Boolean).join(' ');

/** Parses a loaded manifest; a corrupt file fails by name rather than registering half a CLI. */
export function parseManifest(raw: unknown, source = 'src/generated/cli-manifest.json'): Manifest {
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid command manifest ${source}: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
  }
  return result.data;
}
