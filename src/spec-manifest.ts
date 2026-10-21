import { z } from 'zod';

/**
 * The compact, committed form of the Data API spec that `invd` registers its generated commands from
 * (`src/generated/cli-manifest.json`, written by `scripts/build-cli-manifest.ts` from `openapi.json`'s `x-cli`).
 * One schema for the builder's output, the startup loader and the dispatcher.
 */

export const MANIFEST_PARAM_TYPES = ['string', 'integer', 'number', 'boolean', 'array'] as const;
export const MANIFEST_ITEM_TYPES = ['string', 'integer', 'number'] as const;
export const MANIFEST_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export const MANIFEST_VIEWS = ['table', 'keyValue', 'json'] as const;
export const MANIFEST_PAGINATIONS = ['none', 'top', 'perCompany'] as const;

const manifestParamSchema = z.object({
  name: z.string().min(1),
  in: z.enum(['query', 'path']),
  required: z.boolean(),
  type: z.enum(MANIFEST_PARAM_TYPES),
  /** Arrays only: the item type; the value is sent as a repeated parameter. */
  items: z.enum(MANIFEST_ITEM_TYPES).optional(),
  /** Allowed values, stringified; on an array they apply to each item. */
  enum: z.array(z.string()).optional(),
  /** Shown in help, never sent — the API applies its own default. */
  default: z.unknown().optional(),
  description: z.string().optional(),
  /** One-letter short flag (`-q`). */
  alias: z.string().length(1).optional(),
}).strict();

const manifestOperationSchema = z.object({
  operationId: z.string().min(1),
  group: z.string().min(1),
  /** `""` = the group itself is the command (`invd health`). */
  action: z.string(),
  method: z.enum(MANIFEST_METHODS),
  path: z.string().startsWith('/'),
  summary: z.string(),
  params: z.array(manifestParamSchema),
  body: z.object({ required: z.boolean(), contentType: z.literal('application/json') }).strict().optional(),
  view: z.enum(MANIFEST_VIEWS),
  /** Dotted path to the table's rows, or to the ONE object a `keyValue` view shows (absent = the response root). */
  rowsPath: z.string().optional(),
  columns: z.array(z.string()).optional(),
  pagination: z.enum(MANIFEST_PAGINATIONS),
  /**
   * The arrays `--all` concatenates: top-level paths for `top` (default: `[rowsPath]`), paths under `companies[]`
   * for `perCompany`. Absent on `none`.
   */
  allItemsPath: z.array(z.string()).min(1).optional(),
}).strict();

export const manifestSchema = z.object({
  specVersion: z.string(),
  specSha256: z.string().regex(/^[0-9a-f]{64}$/),
  groups: z.array(z.object({ name: z.string().min(1), description: z.string() }).strict()),
  operations: z.array(manifestOperationSchema),
}).strict();

export type ManifestParam = z.infer<typeof manifestParamSchema>;
export type ManifestOperation = z.infer<typeof manifestOperationSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/** Parses a loaded manifest; a corrupt file fails by name rather than registering half a CLI. */
export function parseManifest(raw: unknown, source = 'src/generated/cli-manifest.json'): Manifest {
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid command manifest ${source}: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
  }
  return result.data;
}
