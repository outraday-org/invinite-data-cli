/** A parameter's flag: `company_name` → `company-name` (shown as `--company-name`). */
export function flagName(parameterName: string): string {
  return parameterName.replace(/_/g, '-');
}

/** Long flags `invd` owns itself on every command: the program's globals and commander's own. */
export const RESERVED_FLAGS: readonly string[] = ['json', 'all', 'show-cost', 'version', 'help'];

/**
 * The JSON-body flags `defineOperationCommand` adds to an operation WITH a request body only: a body-less read may
 * name a parameter `body` (`GET /v1/news/{id}?body=html` → `invd news get --body html`).
 */
export const BODY_FLAGS: readonly string[] = ['body', 'body-file'];

/** Short flags commander owns (`-V`, `-h`). */
export const RESERVED_ALIASES: readonly string[] = ['V', 'h'];
