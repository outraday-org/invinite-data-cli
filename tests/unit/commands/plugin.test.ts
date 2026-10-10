import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLED_PATHS, RUNTIMES, uninstallRuntime, type Runtime } from '../../../src/commands/plugin.js';

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../claude-plugin');

const EXPECTED: Record<Runtime, string[]> = {
  claude: [
    'agents/invinite-data.md',
    'commands/analyze-earnings-call.md',
    'commands/financial-research.md',
    'skills/invinite-data-cli/SKILL.md',
  ],
  opencode: [
    'agents/invinite-data.md',
    'command/analyze-earnings-call.md',
    'command/invinite-data-cli.md',
  ],
  codex: [
    'skills/invinite-analyze-earnings-call/SKILL.md',
    'skills/invinite-data-cli/SKILL.md',
    'skills/invinite-financial-research/SKILL.md',
  ],
  copilot: [
    'skills/invinite-analyze-earnings-call/SKILL.md',
    'skills/invinite-data-cli/SKILL.md',
    'skills/invinite-financial-research/SKILL.md',
  ],
};

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter(rel => fs.statSync(path.join(dir, rel)).isFile())
    .map(rel => rel.split(path.sep).join('/'))
    .sort();
}

describe('plugin install / uninstall', () => {
  let target: string;

  beforeEach(() => {
    target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'invd-plugin-')), 'runtime');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
  });

  for (const runtime of Object.keys(EXPECTED) as Runtime[]) {
    it(`${runtime}: installs exactly its files and uninstall removes them`, () => {
      RUNTIMES[runtime].install(SOURCE_DIR, target);
      expect(filesUnder(target)).toEqual(EXPECTED[runtime]);
      expect([...INSTALLED_PATHS[runtime]].sort()).toEqual(EXPECTED[runtime]);

      expect(uninstallRuntime(runtime, target)).toBe(EXPECTED[runtime].length);
      expect(filesUnder(target)).toEqual([]);
    });
  }

  it('claude installs analyze-earnings-call unchanged', () => {
    RUNTIMES.claude.install(SOURCE_DIR, target);
    expect(fs.readFileSync(path.join(target, 'commands/analyze-earnings-call.md'), 'utf-8'))
      .toBe(fs.readFileSync(path.join(SOURCE_DIR, 'commands/analyze-earnings-call.md'), 'utf-8'));
  });

  it('codex keeps only name + description in the command frontmatter', () => {
    RUNTIMES.codex.install(SOURCE_DIR, target);
    const content = fs.readFileSync(path.join(target, 'skills/invinite-analyze-earnings-call/SKILL.md'), 'utf-8');
    expect(content).toMatch(/^---\nname: analyze-earnings-call\ndescription: .+\n---\n/);
  });
});
