import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

type Runtime = 'claude' | 'opencode' | 'codex' | 'copilot';

interface RuntimeConfig {
  label: string;
  globalDir: string;
  localDir: string | null;
  install: (sourceDir: string, targetDir: string) => void;
}

const RUNTIMES: Record<Runtime, RuntimeConfig> = {
  claude: {
    label: 'Claude Code',
    globalDir: path.join(os.homedir(), '.claude'),
    localDir: '.claude',
    install(sourceDir, targetDir) {
      copyFile(
        path.join(sourceDir, 'skills/invinite-data-cli/SKILL.md'),
        path.join(targetDir, 'skills/invinite-data-cli/SKILL.md'),
      );
      copyFile(
        path.join(sourceDir, 'agents/invinite-data.md'),
        path.join(targetDir, 'agents/invinite-data.md'),
      );
      copyFile(
        path.join(sourceDir, 'commands/financial-research.md'),
        path.join(targetDir, 'commands/financial-research.md'),
      );
    },
  },
  opencode: {
    label: 'OpenCode',
    globalDir: path.join(os.homedir(), '.config/opencode'),
    localDir: null,
    install(sourceDir, targetDir) {
      const skillContent = fs.readFileSync(
        path.join(sourceDir, 'skills/invinite-data-cli/SKILL.md'),
        'utf-8',
      );
      const transformed = transformForOpenCode(skillContent);
      writeFile(path.join(targetDir, 'command/invinite-data-cli.md'), transformed);

      const agentContent = fs.readFileSync(
        path.join(sourceDir, 'agents/invinite-data.md'),
        'utf-8',
      );
      const transformedAgent = transformAgentForOpenCode(agentContent);
      writeFile(path.join(targetDir, 'agents/invinite-data.md'), transformedAgent);
    },
  },
  codex: {
    label: 'Codex',
    globalDir: path.join(os.homedir(), '.codex'),
    localDir: '.codex',
    install(sourceDir, targetDir) {
      const skillContent = fs.readFileSync(
        path.join(sourceDir, 'skills/invinite-data-cli/SKILL.md'),
        'utf-8',
      );
      writeFile(
        path.join(targetDir, 'skills/invinite-data-cli/SKILL.md'),
        transformForCodex(skillContent),
      );

      const cmdContent = fs.readFileSync(
        path.join(sourceDir, 'commands/financial-research.md'),
        'utf-8',
      );
      writeFile(
        path.join(targetDir, 'skills/invinite-financial-research/SKILL.md'),
        transformForCodex(cmdContent),
      );
    },
  },
  copilot: {
    label: 'Copilot',
    globalDir: path.join(os.homedir(), '.github'),
    localDir: '.github',
    install(sourceDir, targetDir) {
      const skillContent = fs.readFileSync(
        path.join(sourceDir, 'skills/invinite-data-cli/SKILL.md'),
        'utf-8',
      );
      writeFile(
        path.join(targetDir, 'skills/invinite-data-cli/SKILL.md'),
        transformForCopilot(skillContent),
      );

      const cmdContent = fs.readFileSync(
        path.join(sourceDir, 'commands/financial-research.md'),
        'utf-8',
      );
      writeFile(
        path.join(targetDir, 'skills/invinite-financial-research/SKILL.md'),
        transformForCopilot(cmdContent),
      );
    },
  },
};

const INSTALLED_PATHS: Record<Runtime, string[]> = {
  claude: [
    'skills/invinite-data-cli/SKILL.md',
    'agents/invinite-data.md',
    'commands/financial-research.md',
  ],
  opencode: [
    'command/invinite-data-cli.md',
    'agents/invinite-data.md',
  ],
  codex: [
    'skills/invinite-data-cli/SKILL.md',
    'skills/invinite-financial-research/SKILL.md',
  ],
  copilot: [
    'skills/invinite-data-cli/SKILL.md',
    'skills/invinite-financial-research/SKILL.md',
  ],
};

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

function transformForCodex(content: string): string {
  return transformFrontmatter(content, (attrs) => {
    const result: Record<string, string> = {};
    if (attrs.name) result.name = attrs.name;
    if (attrs.description) result.description = attrs.description;
    return result;
  });
}

function transformForCopilot(content: string): string {
  return transformFrontmatter(content, (attrs) => {
    const result: Record<string, string> = {};
    if (attrs.name) result.name = attrs.name;
    if (attrs.description) result.description = attrs.description;
    return result;
  });
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

function removeFile(filePath: string): boolean {
  try {
    fs.unlinkSync(filePath);
    // Clean up empty parent directories
    let dir = path.dirname(filePath);
    while (dir !== path.dirname(dir)) {
      const entries = fs.readdirSync(dir);
      if (entries.length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
    return true;
  } catch {
    return false;
  }
}

function getPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/src/commands/plugin.js → package root (3 levels up)
  return path.resolve(path.dirname(thisFile), '..', '..', '..');
}

function getSourceDir(): string {
  return path.join(getPackageRoot(), 'claude-plugin');
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
    .action(async (opts) => {
      let runtimes = resolveRuntimes(opts);
      let scope = resolveScope(opts);

      if (!runtimes || !scope) {
        const answers = await promptInteractive(runtimes, scope);
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
          console.log(chalk.yellow(`  ${config.label} does not support ${scope} install, skipping.`));
          continue;
        }

        const resolvedTarget = scope === 'local' ? path.resolve(process.cwd(), targetDir) : targetDir;
        config.install(sourceDir, resolvedTarget);
        console.log(chalk.green(`  ✓ ${config.label}`) + chalk.dim(` → ${resolvedTarget}`));
      }

      console.log(chalk.bold('\nPlugin installed successfully.'));
    });

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
    .action(async (opts) => {
      let runtimes = resolveRuntimes(opts);
      let scope = resolveScope(opts);

      if (!runtimes || !scope) {
        const answers = await promptInteractive(runtimes, scope);
        runtimes = answers.runtimes;
        scope = answers.scope;
      }

      for (const runtime of runtimes) {
        const config = RUNTIMES[runtime];
        const targetDir = scope === 'global' ? config.globalDir : config.localDir;

        if (!targetDir) {
          console.log(chalk.yellow(`  ${config.label} does not support ${scope} uninstall, skipping.`));
          continue;
        }

        const resolvedTarget = scope === 'local' ? path.resolve(process.cwd(), targetDir) : targetDir;
        const paths = INSTALLED_PATHS[runtime];
        let removed = 0;
        for (const rel of paths) {
          if (removeFile(path.join(resolvedTarget, rel))) removed++;
        }

        if (removed > 0) {
          console.log(chalk.green(`  ✓ ${config.label}`) + chalk.dim(` — removed ${removed} file(s) from ${resolvedTarget}`));
        } else {
          console.log(chalk.dim(`  ${config.label} — nothing to remove`));
        }
      }

      console.log(chalk.bold('\nPlugin uninstalled.'));
    });
}

// --- Helpers ---

function resolveRuntimes(opts: Record<string, boolean>): Runtime[] | null {
  if (opts.all) return Object.keys(RUNTIMES) as Runtime[];
  const selected = (Object.keys(RUNTIMES) as Runtime[]).filter((r) => opts[r]);
  return selected.length > 0 ? selected : null;
}

function resolveScope(opts: Record<string, boolean>): 'global' | 'local' | null {
  if (opts.global) return 'global';
  if (opts.local) return 'local';
  return null;
}

async function promptInteractive(
  runtimes: Runtime[] | null,
  scope: 'global' | 'local' | null,
): Promise<{ runtimes: Runtime[]; scope: 'global' | 'local' }> {
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
      console.log(chalk.yellow('No runtimes selected.'));
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
