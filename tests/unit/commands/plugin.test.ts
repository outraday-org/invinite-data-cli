import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installedPaths,
  LEGACY_PATHS,
  pluginSkillFiles,
  RUNTIMES,
  uninstallRuntime,
  type Runtime,
} from '../../../src/commands/plugin.js';

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../claude-plugin');

/** The eleven skill folders the plugin ships: ten vendored from invinite-data-api + the CLI skill. */
const SKILLS = [
  'alert-setup',
  'analyze-earnings-call',
  'analyze-filing',
  'compare-companies',
  'earnings-preview',
  'financial-research',
  'invinite-data-cli',
  'invinite-financial-data',
  'ownership-review',
  'restatement-history',
  'what-changed-since-last-report',
];

const SKILL_FILES = pluginSkillFiles(SOURCE_DIR);

const EXPECTED: Record<Runtime, string[]> = {
  claude: [...SKILL_FILES, 'agents/invinite-data.md'].sort(),
  opencode: ['agents/invinite-data.md', 'command/analyze-earnings-call.md', 'command/invinite-data-cli.md'],
  codex: SKILL_FILES,
  copilot: SKILL_FILES,
};

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter(rel => fs.statSync(path.join(dir, rel)).isFile())
    .map(rel => rel.split(path.sep).join('/'))
    .sort();
}

const read = (file: string) => fs.readFileSync(file, 'utf-8');

describe('plugin install / uninstall', () => {
  let target: string;

  beforeEach(() => {
    target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'invd-plugin-')), 'runtime');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
  });

  it('ships the eleven skill folders with their references and no commands', () => {
    expect([...new Set(SKILL_FILES.map(file => file.split('/')[1]))]).toEqual(SKILLS);
    expect(SKILL_FILES).toContain('skills/invinite-data-cli/references/commands.md');
    expect(SKILL_FILES).toContain('skills/invinite-financial-data/references/financials.md');
    expect(fs.existsSync(path.join(SOURCE_DIR, 'commands'))).toBe(false);
  });

  for (const runtime of Object.keys(EXPECTED) as Runtime[]) {
    it(`${runtime}: installs exactly its files and uninstall removes them`, () => {
      RUNTIMES[runtime].install(SOURCE_DIR, target);
      expect(filesUnder(target)).toEqual(EXPECTED[runtime]);
      expect([...installedPaths(runtime, SOURCE_DIR)].sort()).toEqual(EXPECTED[runtime]);

      expect(uninstallRuntime(runtime, target, SOURCE_DIR)).toBe(EXPECTED[runtime].length);
      expect(filesUnder(target)).toEqual([]);
      // Empty folders are pruned below the runtime's directory only: the directory itself (~/.claude, …) stays.
      expect(fs.readdirSync(target)).toEqual([]);
    });
  }

  it('claude copies every skill file and the agent unchanged', () => {
    RUNTIMES.claude.install(SOURCE_DIR, target);
    for (const file of [...SKILL_FILES, 'agents/invinite-data.md'])
      expect(read(path.join(target, file)), file).toBe(read(path.join(SOURCE_DIR, file)));
  });

  for (const runtime of ['codex', 'copilot'] as const) {
    it(`${runtime} keeps name + description only: the CLI skill loses allowed-tools, the vendored skills stay byte-equal`, () => {
      RUNTIMES[runtime].install(SOURCE_DIR, target);
      const cli = read(path.join(target, 'skills/invinite-data-cli/SKILL.md'));
      expect(cli).toMatch(/^---\nname: invinite-data-cli\ndescription: .+\n---\n/);
      expect(cli).not.toContain('allowed-tools');
      for (const file of SKILL_FILES.filter(candidate => !candidate.startsWith('skills/invinite-data-cli/')))
        expect(read(path.join(target, file)), file).toBe(read(path.join(SOURCE_DIR, file)));
    });
  }

  it('opencode flattens the CLI skill into one command with the command reference appended', () => {
    RUNTIMES.opencode.install(SOURCE_DIR, target);
    const command = read(path.join(target, 'command/invinite-data-cli.md'));
    expect(command).toMatch(/^---\ndescription: .+\ntools: shell\(invd \*\)\n---\n/);
    expect(command).not.toContain('](references/commands.md)');
    expect(command).toContain('<!-- invd:commands:start -->');
    const analyze = read(path.join(target, 'command/analyze-earnings-call.md'));
    expect(analyze).toMatch(/^---\ndescription: .+\n---\n\n# Analyze an earnings call/);
    // OpenCode has no skills: the vendored footer points at the /invinite-data-cli command instead.
    expect(analyze).toContain('use the `/invinite-data-cli` command');
    expect(analyze).not.toContain('load the `invinite-data-cli` skill');
  });

  it('never writes or deletes through a symlinked skill folder (a checkout\'s dev links, a dotfiles repo)', () => {
    const linked = path.join(path.dirname(target), 'linked-skill');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'SKILL.md'), 'the link target');
    fs.mkdirSync(path.join(target, 'skills'), { recursive: true });
    fs.symlinkSync(linked, path.join(target, 'skills/alert-setup'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    RUNTIMES.claude.install(SOURCE_DIR, target);
    expect(read(path.join(linked, 'SKILL.md'))).toBe('the link target');
    expect(errors.mock.calls.join('\n')).toContain('skills/alert-setup');

    const removed = uninstallRuntime('claude', target, SOURCE_DIR);
    expect(read(path.join(linked, 'SKILL.md'))).toBe('the link target');
    expect(removed).toBe(EXPECTED.claude.filter(file => !file.startsWith('skills/alert-setup/')).length);
    errors.mockRestore();
  });

  for (const runtime of ['claude', 'codex', 'copilot'] as const) {
    it(`${runtime}: install and uninstall remove what plugin 0.21.0 wrote, and only that`, () => {
      for (const legacy of LEGACY_PATHS[runtime]) {
        fs.mkdirSync(path.dirname(path.join(target, legacy)), { recursive: true });
        fs.writeFileSync(path.join(target, legacy), 'old');
      }
      const keep = path.join(target, runtime === 'claude' ? 'commands/my-own.md' : 'skills/my-own/SKILL.md');
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.writeFileSync(keep, 'mine');

      RUNTIMES[runtime].install(SOURCE_DIR, target);
      for (const legacy of LEGACY_PATHS[runtime]) expect(fs.existsSync(path.join(target, legacy)), legacy).toBe(false);
      expect(fs.existsSync(path.join(target, 'skills/invinite-financial-research'))).toBe(false);

      for (const legacy of LEGACY_PATHS[runtime]) {
        fs.mkdirSync(path.dirname(path.join(target, legacy)), { recursive: true });
        fs.writeFileSync(path.join(target, legacy), 'old');
      }
      uninstallRuntime(runtime, target, SOURCE_DIR);
      expect(filesUnder(target)).toEqual([path.relative(target, keep).split(path.sep).join('/')]);
    });
  }
});
