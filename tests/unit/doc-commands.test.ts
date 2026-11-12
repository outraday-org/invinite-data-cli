import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { Command, Option } from 'commander';
import { createProgram } from '../../src/cli.js';

/**
 * Every `invd …` line in a fenced block, and every inline `invd …` code span, of the README and the plugin's skill,
 * agent and commands names a registered command, and every flag on it is one that command (or the program) declares —
 * the drift a renamed command or flag leaves behind. A span naming a placeholder command (`invd <group> …`) is skipped.
 */
/** The repository root: tests run in a temporary working directory (tests/setup.ts). */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DOCUMENTS = [
  'README.md',
  'claude-plugin/skills/invinite-data-cli/SKILL.md',
  'claude-plugin/agents/invinite-data.md',
  ...readdirSync(`${ROOT}claude-plugin/commands`).map(file => `claude-plugin/commands/${file}`),
];

/** Shell-like words of one line: quotes group, `#` starts a comment, a pipe or redirect ends the invd command. */
function words(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    // A comment, pipe or redirect starts a word; inside one (`<event_id>`) the character is text.
    if ((char === '#' || char === '|' || char === '>') && !started) break;
    if (char === ' ') {
      if (started) result.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) result.push(current);
  return result;
}

function invdLines(markdown: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of markdown.split('\n')) {
    if (raw.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    const line = raw.trim();
    if (inFence) {
      if (line.startsWith('invd ')) lines.push(line);
      continue;
    }
    for (const match of line.matchAll(/`(invd [^`]+)`/g)) {
      if (match[1] && !match[1].startsWith('invd <')) lines.push(match[1]);
    }
  }
  return lines;
}

const matches = (flag: string) => (option: Option) => option.long === flag || option.short === flag;

/** The subcommand a group runs when the next word is not one of its subcommands (`invd filings AAPL` → `list`). */
const defaultChild = (command: Command): Command | undefined => {
  const name = (command as unknown as { _defaultCommandName?: string })._defaultCommandName;
  return name ? command.commands.find(candidate => candidate.name() === name) : undefined;
};

/** How many positionals a command takes (Infinity after a variadic one). */
const positionalLimit = (command: Command) =>
  command.registeredArguments.some(argument => argument.variadic) ? Infinity : command.registeredArguments.length;

/** The problems of one `invd …` line; empty when it resolves. */
function problems(program: Command, line: string): string[] {
  const tokens = words(line).slice(1);
  let command = program;
  const found: string[] = [];
  let positionals = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token.startsWith('-') && !/^-\d/.test(token)) {
      const flag = token.split('=')[0] ?? token;
      if (flag === '--help' || flag === '-h') continue;
      if (command.commands.length > 0 && defaultChild(command) && !command.options.some(matches(flag))) {
        command = defaultChild(command) ?? command;
      }
      const option = command.options.find(matches(flag));
      if (!option) found.push(`unknown flag ${flag}`);
      // A flag that takes a value consumes the next word (unless given as --flag=value); an unknown flag is assumed to.
      // An optional value (`--json [fields]`) consumes it only when it does not look like a flag.
      const next = tokens[index + 1];
      const takesValue = option
        ? option.required || (option.optional && next !== undefined && !next.startsWith('-'))
        : !(next ?? '-').startsWith('-');
      if (takesValue && !token.includes('=')) index += 1;
      continue;
    }
    // A family in a table (`ratios\\|growth`, `<group> …`): each named alternative must exist.
    if (/\\\||…|</.test(token) && command.commands.length > 0) {
      const named = token.split('\\|').filter(alternative => /^[a-z][a-z-]*$/.test(alternative));
      const missing = named.filter(alternative => !command.commands.some(candidate => candidate.name() === alternative));
      found.push(...missing.map(alternative => `unknown command ${alternative} under \`${command.name()}\``));
      return found;
    }
    const child = command.commands.find(candidate => candidate.name() === token);
    if (child && positionals === 0) {
      command = child;
      continue;
    }
    if (command.commands.length > 0) {
      const fallback = defaultChild(command);
      if (!fallback || command === program) {
        found.push(`unknown command ${token} under \`${command === program ? 'invd' : command.name()}\``);
        break;
      }
      command = fallback;
    }
    positionals += 1;
    if (positionals > positionalLimit(command)) found.push(`unexpected argument ${token}`);
  }
  if (command === program && !tokens.every(token => ['--help', '-h', '--version', '-V'].includes(token))) found.push('no command');
  return found;
}

describe('invd command spellings in the docs', () => {
  for (const document of DOCUMENTS) {
    it(`${document}: every invd line names a real command with real flags`, () => {
      const program = createProgram();
      const lines = invdLines(readFileSync(`${ROOT}${document}`, 'utf8'));
      const bad = lines.flatMap(line => problems(program, line).map(problem => `${line}  →  ${problem}`));
      expect(bad).toEqual([]);
    });
  }

  it('reads the fenced and inline spellings of the README and the skill', () => {
    for (const document of DOCUMENTS.slice(0, 2)) expect(invdLines(readFileSync(`${ROOT}${document}`, 'utf8')).length, document).toBeGreaterThan(10);
  });

  it('catches a renamed flag, a missing command and a stray positional', () => {
    const program = createProgram();
    expect(problems(program, 'invd events transcript abc --event abc --json')).toEqual(['unknown flag --event']);
    expect(problems(program, 'invd financials AAPL MSFT --period annual --detailed')).toEqual(['unknown flag --detailed']);
    expect(problems(program, 'invd financials AAPL --view detailed --limit 4 --json')).toEqual([]);
    expect(problems(program, 'invd companies screener --json')).toEqual(['unexpected argument screener']);
    expect(problems(program, 'invd screener AAPL')).toEqual(['unknown command screener under `invd`', 'no command']);
    expect(problems(program, 'invd companies get AAPL MSFT')).toEqual(['unexpected argument MSFT']);
    expect(problems(program, 'invd filings AAPL --form 10-K')).toEqual([]);
    expect(problems(program, 'invd holdings --filer 0000102909')).toEqual([]);
    expect(problems(program, 'invd events transcript NVDA 2026Q3')).toEqual([]);
    expect(problems(program, 'invd config set base_url https://example.com')).toEqual([]);
    expect(problems(program, 'invd metrics ratios\\|growth\\|cagr')).toEqual([]);
    expect(problems(program, 'invd metrics ratios\\|gross')).toEqual(['unknown command gross under `metrics`']);
    expect(problems(program, 'invd financials AAPL MSFT --fiscal-year 2026 --json # comment --nope')).toEqual([]);
  });
});
