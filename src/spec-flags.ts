/** A parameter's flag: `company_name` → `company-name`, `filed_at.gte` → `filed-at-gte`, `Idempotency-Key` → `idempotency-key`. */
export function flagName(parameterName: string): string {
  return parameterName.replace(/[_.]/g, '-').toLowerCase();
}

/**
 * Long flags `invd` adds to every data command (output, paging, metering) and commander's `--help`. The program
 * uses positional options, so the root's `--version` never shadows an operation's `version` parameter. `--fields`
 * is added too, but an operation's own `fields` parameter IS what it sends (see `GLOBAL_PARAM_FLAGS`).
 */
export const RESERVED_FLAGS: readonly string[] = [
  'json', 'output', 'jq', 'plain', 'all', 'dry-run', 'yes', 'no-input', 'show-cost', 'help',
];

/** Global flags that fill the operation's parameter of the same name when it has one (`--fields` → `fields=`). */
export const GLOBAL_PARAM_FLAGS: readonly string[] = ['fields'];

/** Flags a generated command adds for itself: the JSON body (operations with one), `--save` (download objects). */
export const COMMAND_FLAGS: readonly string[] = ['body', 'body-file', 'save', 'force'];

/** The selector flags of a command over several operations (`invd financials --basis --view`). */
export const SELECT_FLAGS: readonly string[] = ['basis', 'view'];

/** Short flags commander owns (`-V`, `-h`). */
export const RESERVED_ALIASES: readonly string[] = ['V', 'h'];
