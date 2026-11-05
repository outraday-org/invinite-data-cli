/**
 * Whether `--json` is on for this invocation. Kept apart from the spinner (which tests replace) so error output can
 * read it: `setJsonMode` in `spinner.ts` sets both.
 */
let jsonMode = false;

export function setJsonOutput(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}
