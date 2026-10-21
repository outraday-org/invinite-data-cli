/** A parameter's flag: `company_name` → `company-name` (shown as `--company-name`). */
export function flagName(parameterName: string): string {
  return parameterName.replace(/_/g, '-');
}

/** Long flags `invd` owns itself: the program's globals, commander's own, and the body flags of a write. */
export const RESERVED_FLAGS: readonly string[] = ['json', 'all', 'show-cost', 'version', 'help', 'body', 'body-file'];

/** Short flags commander owns (`-V`, `-h`). */
export const RESERVED_ALIASES: readonly string[] = ['V', 'h'];
