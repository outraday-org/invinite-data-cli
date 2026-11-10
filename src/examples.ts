import { commandName, exampleValue, type ManifestOperation, type ManifestParam } from './spec-manifest.js';

/**
 * The example invocations of a generated command, valued from the spec's parameter `example`s (AAPL, a CIK, an
 * accession …): shown first in every `--help` and, the second one, in the skill's command block. A `<name>`
 * placeholder only where the spec has no example.
 */

/** A word the shell reads as itself; anything else is quoted (double quotes unless the text needs single ones). */
export const shellWord = (text: string): string => {
  if (/^[\w.,:/@+=-]+$/.test(text)) return text;
  if (!/["$`\\!]/.test(text)) return `"${text}"`;
  return `'${text.replace(/'/g, "'\\''")}'`;
};

/** A flag's example value: the spec's example, else the enum's first value, else `<name>`. */
export const placeholder = (param: Pick<ManifestParam, 'example' | 'enum' | 'name'>): string =>
  param.example !== undefined ? shellWord(exampleValue(param.example)) : (param.enum?.[0] ?? `<${param.name}>`);

/** The first spelling a flag is shown with: its one-letter alias, else the long flag. */
export const flagSpelling = (param: Pick<ManifestParam, 'alias' | 'flag'>): string =>
  (param.alias ? `-${param.alias}` : `--${param.flag}`);

/** The parameters a command takes as flags (the positional one and implied ones are not flags to show as required). */
export const isRequiredFlag = (operation: ManifestOperation, param: ManifestParam, implied: readonly string[] = []) =>
  param.required && param.name !== operation.positional?.name && !implied.includes(param.name);

function positionalWords(operation: ManifestOperation): string[] {
  const positional = operation.positional;
  if (!positional) return [];
  const param = operation.params.find(candidate => candidate.name === positional.name);
  if (!param) return [];
  if (param.example === undefined) return [`<${param.name}>`];
  const value = exampleValue(param.example);
  return positional.variadic === 'comma' ? value.split(',').map(shellWord) : [shellWord(value)];
}

function flagWords(operation: ManifestOperation, params: ManifestParam[]): string[] {
  return params.map(param => (param.type === 'boolean' ? flagSpelling(param) : `${flagSpelling(param)} ${placeholder(param)}`));
}

function bodyWords(operation: ManifestOperation): string[] {
  if (!operation.body || !(operation.body.required || operation.body.example !== undefined)) return [];
  return [`--body ${operation.body.example === undefined ? "'<json>'" : shellWord(JSON.stringify(operation.body.example))}`];
}

/**
 * Two examples: the minimal call (positional + required flags), then the fuller one (+ the spec's
 * `x-example-params`, `extra` words such as a selector, and `--json`).
 */
export function exampleLines(
  operation: ManifestOperation,
  options: { implied?: readonly string[]; extra?: readonly string[] } = {},
): [string, string] {
  const implied = options.implied ?? [];
  const head = ['invd', commandName(operation), ...positionalWords(operation)];
  const required = operation.params.filter(param => isRequiredFlag(operation, param, implied));
  const shown = new Set(operation.exampleParams ?? []);
  const optional = operation.params.filter(param =>
    shown.has(param.name) && !required.includes(param) && param.name !== operation.positional?.name);
  const body = bodyWords(operation);
  const first = [...head, ...flagWords(operation, required), ...body].join(' ');
  const second = [...head, ...flagWords(operation, [...required, ...optional]), ...(options.extra ?? []), ...body, '--json'].join(' ');
  return [first, second];
}
