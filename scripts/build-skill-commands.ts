/**
 * src/generated/cli-manifest.json + src/hand-written-commands.ts → the command block of the plugin skill
 * (`claude-plugin/skills/invinite-data-cli/SKILL.md`, between `<!-- invd:commands:start -->` and
 * `<!-- invd:commands:end -->`). `--check` exits 1 when the committed block is not what the manifest produces.
 *
 *   pnpm skill:commands          rewrite the block
 *   pnpm skill:commands:check    the drift gate
 *
 * One example per generated command (its required flags and the spec's `x-example-params`, valued with the spec's
 * examples — a placeholder only where the spec has none — and `--json`), its summary as a `#` comment.
 * A rostered command keeps a hand-written block between `<!-- invd:hand:<command> -->` and
 * `<!-- /invd:hand:<command> -->`, carried over verbatim; a missing one is seeded, a stale one fails by name.
 * The prose around the block stays hand-written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_WRITTEN_COMMANDS } from '../src/hand-written-commands.js';
import { exampleValue, parseManifest, type Manifest, type ManifestOperation, type ManifestParam } from '../src/spec-manifest.js';
import { flagName } from '../src/spec-flags.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SKILL_PATH = resolve(REPO_ROOT, 'claude-plugin/skills/invinite-data-cli/SKILL.md');
export const DEFAULT_MANIFEST_PATH = resolve(REPO_ROOT, 'src/generated/cli-manifest.json');

export const BLOCK_START = '<!-- invd:commands:start -->';
export const BLOCK_END = '<!-- invd:commands:end -->';
const handStart = (command: string) => `<!-- invd:hand:${command} -->`;
const handEnd = (command: string) => `<!-- /invd:hand:${command} -->`;

export interface RosterEntry {
  readonly command: string;
  readonly reason: string;
}

/** The first spelling a flag is shown with: its one-letter alias, else the long flag. */
const flagSpelling = (param: ManifestParam) => (param.alias ? `-${param.alias}` : `--${flagName(param.name)}`);

/** A word the shell reads as itself; anything else is quoted (double quotes unless the text needs single ones). */
export const shellWord = (text: string): string => {
  if (/^[\w.,:/@+=-]+$/.test(text)) return text;
  if (!/["$`\\!]/.test(text)) return `"${text}"`;
  return `'${text.replace(/'/g, "'\\''")}'`;
};

/** A flag's example value: the spec's example, else the enum's first value, else `<name>`. */
const placeholder = (param: ManifestParam) =>
  param.example !== undefined ? shellWord(exampleValue(param.example)) : (param.enum?.[0] ?? `<${param.name}>`);

export function exampleLine(operation: ManifestOperation): string {
  const shown = new Set(operation.exampleParams ?? []);
  const flags = operation.params
    .filter(param => param.required || shown.has(param.name))
    .map(param => (param.type === 'boolean' ? flagSpelling(param) : `${flagSpelling(param)} ${placeholder(param)}`));
  const body = operation.body && (operation.body.required || operation.body.example !== undefined)
    ? [`--body ${operation.body.example === undefined ? "'<json>'" : shellWord(JSON.stringify(operation.body.example))}`]
    : [];
  return ['invd', operation.group, operation.action, ...flags, ...body, '--json'].filter(Boolean).join(' ');
}

export function commentLine(operation: ManifestOperation): string {
  const optional = operation.params.filter(param => !param.required).map(param => `--${flagName(param.name)}`);
  if (operation.body && !operation.body.required) optional.push('--body', '--body-file');
  if (operation.body?.required) optional.push('--body-file');
  if (operation.pagination !== 'none') optional.push('--all');
  return `# ${operation.summary}${optional.length ? ` (optional: ${optional.join(', ')})` : ''}`;
}

/** Every `<!-- invd:hand:<command> -->` block of a SKILL.md, by command; a command given twice fails. */
export function extractHandBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const match of text.matchAll(/<!-- invd:hand:([^>]+?) -->\n([\s\S]*?)<!-- \/invd:hand:\1 -->/g)) {
    const [, command, content] = match;
    if (command === undefined || content === undefined) continue;
    if (blocks.has(command)) throw new Error(`SKILL.md has two hand blocks for \`invd ${command}\``);
    blocks.set(command, content);
  }
  return blocks;
}

const seed = (command: string) => `\`\`\`bash\ninvd ${command} --help\n\`\`\`\n`;
const topLevel = (command: string) => command.split(' ')[0] ?? command;

/** The whole generated block, markers included. */
export function renderCommandBlock(
  manifest: Manifest,
  roster: readonly RosterEntry[],
  handBlocks: ReadonlyMap<string, string>,
): string {
  const rosterNames = new Set(roster.map(entry => entry.command));
  const stale = [...handBlocks.keys()].filter(command => !rosterNames.has(command));
  if (stale.length > 0) {
    throw new Error(`SKILL.md has a hand block for a command that is not on the roster: ${stale.map(c => `\`invd ${c}\``).join(', ')} — move its text out of the block or roster the command`);
  }
  const descriptions = new Map(manifest.groups.map(group => [group.name, group.description]));
  const groups = [...new Set([...manifest.groups.map(group => group.name), ...roster.map(entry => topLevel(entry.command))])]
    .sort((a, b) => a.localeCompare(b));

  const sections = groups.map(group => {
    const lines = [`### ${group}`, ''];
    const description = descriptions.get(group);
    if (description) lines.push(description, '');
    const operations = manifest.operations
      .filter(operation => operation.group === group)
      .sort((a, b) => a.action.localeCompare(b.action));
    if (operations.length > 0) {
      lines.push('```bash');
      operations.forEach((operation, index) => {
        if (index > 0) lines.push('');
        lines.push(commentLine(operation), exampleLine(operation));
      });
      lines.push('```', '');
    }
    for (const entry of roster.filter(candidate => topLevel(candidate.command) === group)) {
      lines.push(handStart(entry.command), `${handBlocks.get(entry.command) ?? seed(entry.command)}${handEnd(entry.command)}`, '');
    }
    return lines.join('\n');
  });

  return [
    BLOCK_START,
    '<!-- Generated by `pnpm skill:commands` from src/generated/cli-manifest.json and src/hand-written-commands.ts. Edit only inside an invd:hand block; `pnpm skill:commands:check` fails on drift. -->',
    '',
    ...sections,
    BLOCK_END,
  ].join('\n');
}

/** The SKILL.md text with its block re-rendered; a file without both markers fails by name. */
export function renderSkill(skill: string, manifest: Manifest, roster: readonly RosterEntry[]): string {
  const start = skill.indexOf(BLOCK_START);
  const end = skill.indexOf(BLOCK_END);
  if (start < 0 || end < start) throw new Error(`SKILL.md needs ${BLOCK_START} … ${BLOCK_END} around its command block`);
  const current = skill.slice(start, end + BLOCK_END.length);
  return `${skill.slice(0, start)}${renderCommandBlock(manifest, roster, extractHandBlocks(current))}${skill.slice(end + BLOCK_END.length)}`;
}

/** Writes (or, with `check`, compares) the block; returns the exit code. */
export function runBuildSkillCommands(options: { skillPath: string; manifestPath: string; check: boolean }): number {
  const manifest = parseManifest(createRequire(import.meta.url)(options.manifestPath), options.manifestPath);
  const current = readFileSync(options.skillPath, 'utf8');
  const next = renderSkill(current, manifest, HAND_WRITTEN_COMMANDS);
  if (options.check) {
    if (current === next) {
      console.log(`skill command block up to date (${options.skillPath})`);
      return 0;
    }
    console.error(`skill command block is stale: ${options.skillPath} differs from what the manifest produces — run pnpm skill:commands`);
    return 1;
  }
  writeFileSync(options.skillPath, next);
  console.log(`wrote ${options.skillPath}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runBuildSkillCommands({
      skillPath: DEFAULT_SKILL_PATH,
      manifestPath: DEFAULT_MANIFEST_PATH,
      check: process.argv.includes('--check'),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
