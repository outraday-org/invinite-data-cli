import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { UsageError, withErrorHandling } from '../shared/errors.js';

/** The flags that answer `promptInteractive`'s two questions on `plugin install` / `uninstall`. */
const PLUGIN_ANSWERS = 'the runtimes (--claude, --opencode, --codex, --copilot or --all) and the scope (--global or --local)';

export type Runtime = 'claude' | 'opencode' | 'codex' | 'copilot';

export interface RuntimeConfig {
  label: string;
  globalDir: string;
  localDir: string | null;
  install: (sourceDir: string, targetDir: string) => void;
}

/** The CLI-only skill (this repository's own); the other skill folders are vendored from invinite-data-api. */
const CLI_SKILL = 'invinite-data-cli';
const AGENT = 'agents/invinite-data.md';

/**
 * The line `pnpm skills:import` appends to every vendored `SKILL.md` (`scripts/import-skills.ts`, pinned in
 * `reference/data-skills.pin.json`). OpenCode installs the CLI skill as the command `/invinite-data-cli`, so its copy
 * of a vendored skill points there instead.
 */
export const VENDORED_SKILL_FOOTER =
  'Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.';
const OPENCODE_FOOTER =
  'Without a connected Invinite Data MCP server, use the `/invinite-data-cli` command: it maps every tool named here to an `invd` command.';

/** The CLI skill's link to its command reference (replaced where the reference is appended inline). */
const COMMANDS_LINK = '[references/commands.md](references/commands.md)';

/** One file the installer writes: its source under `claude-plugin/`, its path under the runtime's directory. */
export interface PlannedFile {
  readonly from: string;
  readonly to: string;
  readonly transform?: (content: string) => string;
}

/** Every file under `claude-plugin/skills/` (the eleven skill folders, `references/` included), relative to the plugin. */
export function pluginSkillFiles(sourceDir: string): string[] {
  const walk = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (entry.name === '.DS_Store') return [];
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  return walk(path.join(sourceDir, 'skills'))
    .map(file => path.relative(sourceDir, file).split(path.sep).join('/'))
    .sort();
}

/**
 * What `install` writes for a runtime, from ONE walk of `claude-plugin/skills/` — `install` and `installedPaths` both
 * read it, so they cannot drift. Claude: the skill folders as they are + the agent. Codex / Copilot: the same folders,
 * byte-equal except the CLI skill's `SKILL.md`, whose `allowed-tools` they do not read (stripped). OpenCode (global only) takes single
 * command files: the CLI skill with its command reference appended (a flattened command cannot carry `references/`),
 * the `analyze-earnings-call` skill, and the agent.
 */
export function installPlan(runtime: Runtime, sourceDir: string): PlannedFile[] {
  const skills = pluginSkillFiles(sourceDir);
  const cliSkillFile = `skills/${CLI_SKILL}/SKILL.md`;
  switch (runtime) {
    case 'claude':
      return [...skills.map(file => ({ from: file, to: file })), { from: AGENT, to: AGENT }];
    case 'codex':
    case 'copilot':
      return skills.map(file => (file === cliSkillFile ? { from: file, to: file, transform: stripAllowedTools } : { from: file, to: file }));
    case 'opencode': {
      const reference = fs.readFileSync(path.join(sourceDir, `skills/${CLI_SKILL}/references/commands.md`), 'utf-8');
      return [
        {
          from: `skills/${CLI_SKILL}/SKILL.md`,
          to: `command/${CLI_SKILL}.md`,
          transform: content => `${transformForOpenCode(content).split(COMMANDS_LINK).join('the command reference at the end of this file')}\n${reference}`,
        },
        { from: AGENT, to: AGENT, transform: transformAgentForOpenCode },
        {
          from: 'skills/analyze-earnings-call/SKILL.md',
          to: 'command/analyze-earnings-call.md',
          transform: content => transformForOpenCode(content).split(VENDORED_SKILL_FOOTER).join(OPENCODE_FOOTER),
        },
      ];
    }
  }
}

/**
 * True when `rel` under `targetDir` passes through a symbolic link, such as a skill folder linked into a checkout or a
 * dotfiles repository: writing or deleting there would change the link's target, never this install. Skipped.
 */
export function throughSymlink(targetDir: string, rel: string): boolean {
  let current = targetDir;
  for (const segment of rel.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function warnSkipped(targetDir: string, skipped: readonly string[]): void {
  if (skipped.length === 0) return;
  const folders = [...new Set(skipped.map(rel => rel.split('/').slice(0, 2).join('/')))];
  console.error(chalk.yellow(`  ${targetDir}: left ${folders.join(', ')} alone (a symbolic link; update or remove it by hand)`));
}

function installRuntime(runtime: Runtime, sourceDir: string, targetDir: string): void {
  const skipped: string[] = [];
  for (const legacy of LEGACY_PATHS[runtime]) {
    if (throughSymlink(targetDir, legacy)) skipped.push(legacy);
    else removeFile(targetDir, legacy);
  }
  for (const file of installPlan(runtime, sourceDir)) {
    if (throughSymlink(targetDir, file.to)) {
      skipped.push(file.to);
      continue;
    }
    const source = path.join(sourceDir, file.from);
    const target = path.join(targetDir, file.to);
    if (file.transform) writeFile(target, file.transform(fs.readFileSync(source, 'utf-8')));
    else copyFile(source, target);
  }
  warnSkipped(targetDir, skipped);
}

export const RUNTIMES: Record<Runtime, RuntimeConfig> = {
  claude: {
    label: 'Claude Code',
    globalDir: path.join(os.homedir(), '.claude'),
    localDir: '.claude',
    install: (sourceDir, targetDir) => installRuntime('claude', sourceDir, targetDir),
  },
  opencode: {
    label: 'OpenCode',
    globalDir: path.join(os.homedir(), '.config/opencode'),
    localDir: null,
    install: (sourceDir, targetDir) => installRuntime('opencode', sourceDir, targetDir),
  },
  codex: {
    label: 'Codex',
    globalDir: path.join(os.homedir(), '.codex'),
    localDir: '.codex',
    install: (sourceDir, targetDir) => installRuntime('codex', sourceDir, targetDir),
  },
  copilot: {
    label: 'Copilot',
    globalDir: path.join(os.homedir(), '.github'),
    localDir: '.github',
    install: (sourceDir, targetDir) => installRuntime('copilot', sourceDir, targetDir),
  },
};

/** Every file `install` writes for a runtime (what `uninstall` removes), relative to the runtime's directory. */
export function installedPaths(runtime: Runtime, sourceDir: string = getSourceDir()): string[] {
  return installPlan(runtime, sourceDir).map(file => file.to);
}

/**
 * What plugin 0.21.0 and earlier wrote and this version no longer ships: removed by `install` and `uninstall`. Exact
 * file paths only (their now-empty folders are pruned), never a glob over the user's directory.
 */
export const LEGACY_PATHS: Record<Runtime, readonly string[]> = {
  claude: ['commands/financial-research.md', 'commands/analyze-earnings-call.md'],
  opencode: [],
  codex: ['skills/invinite-financial-research/SKILL.md', 'skills/invinite-analyze-earnings-call/SKILL.md'],
  copilot: ['skills/invinite-financial-research/SKILL.md', 'skills/invinite-analyze-earnings-call/SKILL.md'],
};

/** Removes the runtime's installed files (and an earlier version's) from `targetDir`; returns how many were removed. */
export function uninstallRuntime(runtime: Runtime, targetDir: string, sourceDir: string = getSourceDir()): number {
  let removed = 0;
  const skipped: string[] = [];
  for (const rel of [...installedPaths(runtime, sourceDir), ...LEGACY_PATHS[runtime]]) {
    if (throughSymlink(targetDir, rel)) skipped.push(rel);
    else if (removeFile(targetDir, rel)) removed++;
  }
  warnSkipped(targetDir, skipped);
  return removed;
}

// --- Frontmatter transformations ---

function transformFrontmatter(
  content: string,
  transform: (attrs: Record<string, string>) => Record<string, string> | null,
): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return content;

  const attrs: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      attrs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }

  const newAttrs = transform(attrs);
  if (!newAttrs) return content.slice(match[0].length);

  const yaml = Object.entries(newAttrs)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${yaml}\n---\n${content.slice(match[0].length)}`;
}

function transformForOpenCode(content: string): string {
  return transformFrontmatter(content, (attrs) => {
    const result: Record<string, string> = {};
    if (attrs.description) result.description = attrs.description;
    if (attrs['allowed-tools']) {
      result.tools = attrs['allowed-tools'].replace(/^Bash\(/, 'shell(');
    }
    return result;
  });
}

function transformAgentForOpenCode(content: string): string {
  return transformFrontmatter(content, (attrs) => {
    const result: Record<string, string> = {};
    if (attrs.name) result.name = attrs.name;
    if (attrs.description) result.description = attrs.description;
    if (attrs.tools) {
      result.tools = attrs.tools.replace(/Bash\(/g, 'shell(');
    }
    if (attrs.model) result.model = attrs.model;
    return result;
  });
}

/** Codex / Copilot: the CLI skill without `allowed-tools` (a Claude Code key they do not read); every other key stays. */
function stripAllowedTools(content: string): string {
  return transformFrontmatter(content, attrs =>
    Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'allowed-tools')),
  );
}

// --- File utilities ---

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeFile(dest: string, content: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf-8');
}

/** Removes `targetDir`/`rel` and the folders it leaves empty below `targetDir` (never `targetDir` itself or above). */
function removeFile(targetDir: string, rel: string): boolean {
  const filePath = path.join(targetDir, rel);
  try {
    fs.unlinkSync(filePath);
  } catch {
    return false;
  }
  // Clean up empty parent directories (a failure here does not undo the removal).
  try {
    const root = path.resolve(targetDir);
    let dir = path.dirname(path.resolve(filePath));
    while (dir !== root && dir.startsWith(root + path.sep)) {
      const entries = fs.readdirSync(dir);
      if (entries.length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  } catch {
    // A parent that cannot be listed or removed stays.
  }
  return true;
}

/** The bundled `claude-plugin/`: two levels above this file under tsx (`src/commands/`), three in the build. */
export function getSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '..', '..', '..', 'claude-plugin'), path.resolve(here, '..', '..', 'claude-plugin')];
  return candidates.find(candidate => fs.existsSync(path.join(candidate, '.claude-plugin'))) ?? candidates[0];
}

// --- Command registration ---

export function registerPluginCommands(program: Command): void {
  const pluginCmd = program
    .command('plugin')
    .description('Install or uninstall AI coding tool plugins');

  pluginCmd
    .command('install')
    .description('Install the Invinite plugin for AI coding tools')
    .option('--claude', 'Install for Claude Code')
    .option('--opencode', 'Install for OpenCode')
    .option('--codex', 'Install for Codex')
    .option('--copilot', 'Install for Copilot')
    .option('--all', 'Install for all supported runtimes')
    .option('-g, --global', 'Install globally (user home)')
    .option('-l, --local', 'Install locally (current directory)')
    .option('--no-input', 'Never prompt (missing runtimes or scope fail with exit 2 instead)')
    .action(withErrorHandling(async (opts: Record<string, boolean>) => {
      let runtimes = resolveRuntimes(opts);
      let scope = resolveScope(opts);

      if (!runtimes || !scope) {
        const answers = await promptInteractive(runtimes, scope, { input: opts.input, answers: PLUGIN_ANSWERS });
        runtimes = answers.runtimes;
        scope = answers.scope;
      }

      const sourceDir = getSourceDir();
      if (!fs.existsSync(sourceDir)) {
        console.error(chalk.red('Plugin source files not found. Make sure the package is installed correctly.'));
        process.exit(1);
      }

      for (const runtime of runtimes) {
        const config = RUNTIMES[runtime];
        const targetDir = scope === 'global' ? config.globalDir : config.localDir;

        if (!targetDir) {
          console.error(chalk.yellow(`  ${config.label} does not support ${scope} install, skipping.`));
          continue;
        }

        const resolvedTarget = scope === 'local' ? path.resolve(process.cwd(), targetDir) : targetDir;
        config.install(sourceDir, resolvedTarget);
        console.error(chalk.green(`  ✓ ${config.label}`) + chalk.dim(` → ${resolvedTarget}`));
      }

      console.error(chalk.bold('\nPlugin installed successfully.'));
    }));

  pluginCmd
    .command('uninstall')
    .description('Uninstall the Invinite plugin from AI coding tools')
    .option('--claude', 'Uninstall from Claude Code')
    .option('--opencode', 'Uninstall from OpenCode')
    .option('--codex', 'Uninstall from Codex')
    .option('--copilot', 'Uninstall from Copilot')
    .option('--all', 'Uninstall from all supported runtimes')
    .option('-g, --global', 'Uninstall globally (user home)')
    .option('-l, --local', 'Uninstall locally (current directory)')
    .option('--no-input', 'Never prompt (missing runtimes or scope fail with exit 2 instead)')
    .action(withErrorHandling(async (opts: Record<string, boolean>) => {
      let runtimes = resolveRuntimes(opts);
      let scope = resolveScope(opts);

      if (!runtimes || !scope) {
        const answers = await promptInteractive(runtimes, scope, { input: opts.input, answers: PLUGIN_ANSWERS });
        runtimes = answers.runtimes;
        scope = answers.scope;
      }

      for (const runtime of runtimes) {
        const config = RUNTIMES[runtime];
        const targetDir = scope === 'global' ? config.globalDir : config.localDir;

        if (!targetDir) {
          console.error(chalk.yellow(`  ${config.label} does not support ${scope} uninstall, skipping.`));
          continue;
        }

        const resolvedTarget = scope === 'local' ? path.resolve(process.cwd(), targetDir) : targetDir;
        const removed = uninstallRuntime(runtime, resolvedTarget);

        if (removed > 0) {
          console.error(chalk.green(`  ✓ ${config.label}`) + chalk.dim(` — removed ${removed} file(s) from ${resolvedTarget}`));
        } else {
          console.error(chalk.dim(`  ${config.label} — nothing to remove`));
        }
      }

      console.error(chalk.bold('\nPlugin uninstalled.'));
    }));
}

// --- Helpers ---

export function resolveRuntimes(opts: Record<string, boolean>): Runtime[] | null {
  if (opts.all) return Object.keys(RUNTIMES) as Runtime[];
  const selected = (Object.keys(RUNTIMES) as Runtime[]).filter((r) => opts[r]);
  return selected.length > 0 ? selected : null;
}

export function resolveScope(opts: Record<string, boolean>): 'global' | 'local' | null {
  if (opts.global) return 'global';
  if (opts.local) return 'local';
  return null;
}

/**
 * Asks for the runtimes and / or the scope the flags left open. Under `--no-input` (`input: false`) or without a
 * terminal on stdin it refuses with exit 2 naming `answers`, the flags that answer it.
 */
export async function promptInteractive(
  runtimes: Runtime[] | null,
  scope: 'global' | 'local' | null,
  flags: { input?: boolean; answers: string },
): Promise<{ runtimes: Runtime[]; scope: 'global' | 'local' }> {
  if (flags.input === false || !process.stdin.isTTY) {
    throw new UsageError(`Name ${flags.answers}; invd does not prompt ${flags.input === false ? 'under --no-input' : 'without a terminal'}.`);
  }
  const { default: Enquirer } = await import('enquirer');
  const enquirer = new Enquirer();

  if (!runtimes) {
    const response = await enquirer.prompt({
      type: 'multiselect',
      name: 'runtimes',
      message: 'Which runtimes do you want to install for?',
      choices: Object.entries(RUNTIMES).map(([key, cfg]) => ({
        name: key,
        message: cfg.label,
      })),
    }) as { runtimes: Runtime[] };
    runtimes = response.runtimes;

    if (runtimes.length === 0) {
      console.error(chalk.yellow('No runtimes selected.'));
      process.exit(0);
    }
  }

  if (!scope) {
    const response = await enquirer.prompt({
      type: 'select',
      name: 'scope',
      message: 'Install globally or locally?',
      choices: [
        { name: 'global', message: 'Global (user home)' },
        { name: 'local', message: 'Local (current directory)' },
      ],
    }) as { scope: 'global' | 'local' };
    scope = response.scope;
  }

  return { runtimes, scope };
}
