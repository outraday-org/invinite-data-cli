/**
 * src/generated/cli-manifest.json + src/hand-written-commands.ts → the command block of the plugin skill
 * (`claude-plugin/skills/invinite-data-cli/SKILL.md`, between `<!-- invd:commands:start -->` and
 * `<!-- invd:commands:end -->`). `--check` exits 1 when the committed block is not what the manifest produces.
 *
 *   pnpm skill:commands          rewrite the block
 *   pnpm skill:commands:check    the drift gate
 *
 * One example per generated command (the second `--help` example of `src/examples.ts`: positional, required flags and
 * the spec's `x-example-params`, valued with the spec's examples, and `--json`), its summary as a `#` comment;
 * `invd financials` once for its six operations.
 * A rostered command keeps a hand-written block between `<!-- invd:hand:<command> -->` and
 * `<!-- /invd:hand:<command> -->`, carried over verbatim; a missing one is seeded, a stale one fails by name.
 * The prose around the block stays hand-written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_WRITTEN_COMMANDS } from '../src/hand-written-commands.js';
import { exampleLines, shellWord } from '../src/examples.js';
import { commandName, parseManifest, type Manifest, type ManifestOperation } from '../src/spec-manifest.js';

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

export { shellWord };

/** The skill's example: the second (fuller) `--help` example of the command. */
export function exampleLine(operation: ManifestOperation, siblings: readonly ManifestOperation[] = []): string {
  if (siblings.length > 1) {
    const detailed = siblings.find(candidate => candidate.select?.view === 'detailed' && candidate.select?.basis === operation.select?.basis);
    return exampleLines(detailed ?? operation, { implied: ['period'], extra: detailed ? ['--view detailed'] : [] })[1];
  }
  return exampleLines(operation)[1];
}

export function commentLine(operation: ManifestOperation, siblings: readonly ManifestOperation[] = []): string {
  const optional = operation.params
    .filter(param => !param.required && param.name !== operation.positional?.name)
    .map(param => `--${param.flag}`);
  if (operation.body) optional.push(...operation.body.fields.map(field => `--${field.flag}`), '--body', '--body-file');
  if (operation.download !== undefined) optional.push('--save');
  if (operation.list) optional.push('--all');
  const selectors = siblings.length > 1
    ? ` [${[...new Set(siblings.flatMap(sibling => Object.entries(sibling.select ?? {}).map(([key]) => key)))].map(key => `--${key} ${[...new Set(siblings.map(sibling => sibling.select?.[key]))].join('|')}`).join(', ')}]`
    : '';
  return `# ${operation.summary}${selectors}${optional.length ? ` (optional: ${optional.join(', ')})` : ''}`;
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
    const commands = new Map<string, ManifestOperation[]>();
    for (const operation of manifest.operations.filter(candidate => candidate.group === group)) {
      commands.set(commandName(operation), [...(commands.get(commandName(operation)) ?? []), operation]);
    }
    const entries = [...commands].sort(([a], [b]) => a.localeCompare(b));
    if (entries.length > 0) {
      lines.push('```bash');
      entries.forEach(([, siblings], index) => {
        const primary = siblings.find(sibling => sibling.select?.basis === 'standardized' && sibling.select?.view === 'summary') ?? siblings[0];
        if (!primary) return;
        if (index > 0) lines.push('');
        lines.push(commentLine(primary, siblings), exampleLine(primary, siblings));
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
