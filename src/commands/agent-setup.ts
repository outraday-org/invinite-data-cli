import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { UsageError, withErrorHandling } from '../shared/errors.js';
import { getSourceDir, promptInteractive, RUNTIMES, resolveScope, type Runtime } from './plugin.js';

/** The runtimes `agent-setup` wires both the MCP connector and the skill for. */
export const AGENT_RUNTIMES = ['claude', 'codex'] as const satisfies readonly Runtime[];
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

export interface Connector {
  name: string;
  url: string;
}

/** The plugin's one MCP connector (`claude-plugin/.mcp.json`): the name and URL every runtime is given. */
export function bundledConnector(sourceDir = getSourceDir()): Connector {
  const raw = JSON.parse(fs.readFileSync(path.join(sourceDir, '.mcp.json'), 'utf8')) as { mcpServers?: Record<string, { url?: string }> };
  const [entry] = Object.entries(raw.mcpServers ?? {});
  if (!entry?.[1]?.url) throw new Error('claude-plugin/.mcp.json names no MCP connector');
  return { name: entry[0], url: entry[1].url };
}

/** Where a runtime reads its MCP servers: Claude Code `./.mcp.json` / `~/.claude.json`, Codex `config.toml`. */
export function mcpConfigPath(runtime: AgentRuntime, scope: 'global' | 'local', cwd = process.cwd(), home = os.homedir()): string {
  if (runtime === 'claude') return scope === 'local' ? path.join(cwd, '.mcp.json') : path.join(home, '.claude.json');
  return scope === 'local' ? path.join(cwd, '.codex', 'config.toml') : path.join(home, '.codex', 'config.toml');
}

/** The JSON config with the connector set under `mcpServers` (every other key kept as it was). */
export function mergeClaudeMcp(current: string | undefined, connector: Connector): string {
  let config: Record<string, unknown> = {};
  if (current?.trim()) {
    const parsed: unknown = JSON.parse(current);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not a JSON object');
    config = parsed as Record<string, unknown>;
  }
  const servers = typeof config.mcpServers === 'object' && config.mcpServers !== null ? config.mcpServers as Record<string, unknown> : {};
  return `${JSON.stringify({ ...config, mcpServers: { ...servers, [connector.name]: { type: 'http', url: connector.url } } }, null, 2)}\n`;
}

/** The Codex TOML with a `[mcp_servers.<name>]` table for the connector (an existing table is replaced). */
export function mergeCodexMcp(current: string | undefined, connector: Connector): string {
  const header = `[mcp_servers.${connector.name}]`;
  const lines = (current ?? '').split('\n');
  const start = lines.findIndex(line => line.trim() === header);
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !(lines[end] ?? '').trim().startsWith('[')) end += 1;
    lines.splice(start, end - start);
  }
  const body = lines.join('\n').replace(/\n+$/, '');
  return `${body ? `${body}\n\n` : ''}${header}\nurl = "${connector.url}"\n`;
}

function writeMcp(runtime: AgentRuntime, scope: 'global' | 'local', connector: Connector, dryRun: boolean): string {
  const target = mcpConfigPath(runtime, scope);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  let next: string;
  try {
    next = runtime === 'claude' ? mergeClaudeMcp(current, connector) : mergeCodexMcp(current, connector);
  } catch (error) {
    throw new Error(`${target}: ${error instanceof Error ? error.message : String(error)} — fix the file or add the connector by hand`);
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
  }
  return target;
}

/**
 * `invd agent-setup`: one step for an agent — the MCP connector in the runtime's config (Claude Code, Codex) and the
 * skill / agent / commands the plugin installs. The connector signs in with OAuth on first use; no key is written.
 */
export function registerAgentSetupCommand(program: Command): void {
  program
    .command('agent-setup')
    .description('Connect an AI agent: the Invinite MCP connector plus the invd skill, in one step')
    .option('--claude', 'Claude Code (.mcp.json / ~/.claude.json + .claude/)')
    .option('--codex', 'Codex (config.toml [mcp_servers] + .codex/skills)')
    .option('--all', 'Both')
    .option('-g, --global', 'User-wide (home directory)')
    .option('-l, --local', 'This project (current directory)')
    .option('--dry-run', 'Print what would be written; write nothing')
    .option('--no-input', 'Never prompt (a missing agent or scope fails with exit 2 instead)')
    .addHelpText('before', 'Examples:\n  $ invd agent-setup --claude --local\n  $ invd agent-setup --all --global --dry-run\n')
    .action(withErrorHandling(async (opts: Record<string, boolean>) => {
      let runtimes: Runtime[] | null = opts.all ? [...AGENT_RUNTIMES] : AGENT_RUNTIMES.filter(runtime => opts[runtime]);
      if (runtimes.length === 0) runtimes = null;
      let scope = resolveScope(opts);
      if (!runtimes || !scope) {
        const answers = await promptInteractive(runtimes, scope, {
          input: opts.input,
          answers: 'the agent (--claude, --codex or --all) and the scope (--global or --local)',
        });
        runtimes = answers.runtimes;
        scope = answers.scope;
      }
      const chosen = runtimes.filter((runtime): runtime is AgentRuntime => (AGENT_RUNTIMES as readonly string[]).includes(runtime));
      if (chosen.length === 0) throw new UsageError('agent-setup supports --claude and --codex (invd plugin install covers the others)');
      const sourceDir = getSourceDir();
      const connector = bundledConnector(sourceDir);
      const dryRun = opts.dryRun === true;
      for (const runtime of chosen) {
        const config = RUNTIMES[runtime];
        const mcp = writeMcp(runtime, scope, connector, dryRun);
        const skillRoot = scope === 'global' ? config.globalDir : config.localDir ? path.resolve(process.cwd(), config.localDir) : null;
        if (skillRoot && !dryRun) config.install(sourceDir, skillRoot);
        const verb = dryRun ? 'would write' : 'wrote';
        console.error(chalk.green(`  ✓ ${config.label}`) + chalk.dim(` — ${verb} MCP ${connector.name} → ${mcp}${skillRoot ? `; skill → ${skillRoot}` : ''}`));
      }
      console.error(dryRun
        ? chalk.bold('\nDry run: nothing was written.')
        : chalk.bold(`\nDone. Restart the agent; it asks you to sign in to ${connector.url} the first time it uses a tool.`));
    }));
}
