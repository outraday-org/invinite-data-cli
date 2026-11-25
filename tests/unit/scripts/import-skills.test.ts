import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkSkills,
  CLI_SKILL,
  FOOTER,
  importSkills,
  PIN_PATH,
  SKILLS_DIR,
  SOURCE_REPOSITORY,
  vendoredBytes,
  type SkillsPin,
} from '../../../scripts/import-skills.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** `git` in a temporary repository, without a hook's GIT_* variables pointing it elsewhere. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { env, encoding: 'utf8' }).trim();
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('pnpm skills:import', () => {
  let base: string;
  let source: string;
  let plugin: string;

  const commit = (message: string) => {
    git(source, 'add', '-A');
    git(source, 'commit', '-q', '-m', message);
    return git(source, 'rev-parse', 'HEAD');
  };

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'invd-skills-'));
    source = join(base, 'api');
    plugin = join(base, 'cli');
    mkdirSync(source);
    git(source, 'init', '-q');
    write(join(source, 'src/skills/data-guide/SKILL.md'), '---\nname: data-guide\ndescription: d\n---\n\nBody.\n');
    write(join(source, 'src/skills/data-guide/references/more.md'), '# More\n');
    write(join(source, 'src/skills/workflow/SKILL.md'), '---\nname: workflow\ndescription: w\n---\n\nSteps.');
    write(join(plugin, SKILLS_DIR, CLI_SKILL, 'SKILL.md'), 'the CLI skill\n');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('vendors a committed revision, appends the footer to SKILL.md only, and pins both hashes', () => {
    const revision = commit('skills');
    write(join(source, 'src/skills/data-guide/SKILL.md'), 'uncommitted edit\n');

    const pin = importSkills({ from: source, rev: 'HEAD', root: plugin });

    expect(pin.revision).toBe(revision);
    expect(pin.repository).toBe(SOURCE_REPOSITORY);
    expect(pin.skills).toEqual(['data-guide', 'workflow']);
    expect(Object.keys(pin.files)).toEqual(['data-guide/SKILL.md', 'data-guide/references/more.md', 'workflow/SKILL.md']);
    const guide = readFileSync(join(plugin, SKILLS_DIR, 'data-guide/SKILL.md'), 'utf8');
    expect(guide).toBe(`---\nname: data-guide\ndescription: d\n---\n\nBody.\n\n${FOOTER}\n`);
    expect(readFileSync(join(plugin, SKILLS_DIR, 'workflow/SKILL.md'), 'utf8').endsWith(`Steps.\n\n${FOOTER}\n`)).toBe(true);
    expect(readFileSync(join(plugin, SKILLS_DIR, 'data-guide/references/more.md'), 'utf8')).toBe('# More\n');
    expect(readFileSync(join(plugin, SKILLS_DIR, CLI_SKILL, 'SKILL.md'), 'utf8')).toBe('the CLI skill\n');
    expect(pin.files['data-guide/references/more.md']?.source).toBe(pin.files['data-guide/references/more.md']?.written);
    expect(JSON.parse(readFileSync(join(plugin, PIN_PATH), 'utf8'))).toEqual(pin);
    expect(checkSkills(plugin)).toEqual([]);
  });

  it('--check names a hand-edited vendored file, an extra file and an unpinned folder', () => {
    commit('skills');
    importSkills({ from: source, rev: 'HEAD', root: plugin });

    writeFileSync(join(plugin, SKILLS_DIR, 'workflow/SKILL.md'), 'hand edit\n');
    write(join(plugin, SKILLS_DIR, 'data-guide/references/extra.md'), 'x\n');
    write(join(plugin, SKILLS_DIR, 'stray/SKILL.md'), 'x\n');
    write(join(plugin, SKILLS_DIR, 'data-guide/.DS_Store'), 'ignored');

    expect(checkSkills(plugin)).toEqual([
      `${SKILLS_DIR}/stray is neither a pinned skill nor ${CLI_SKILL}`,
      `${SKILLS_DIR}/workflow/SKILL.md differs from the pinned import (vendored files are written only by pnpm skills:import)`,
      `${SKILLS_DIR}/data-guide/references/extra.md is not in ${PIN_PATH}`,
    ]);
  });

  it('--check names a loose file beside the skill folders, and a pinned name that is not a folder name fails', () => {
    commit('skills');
    const pin = importSkills({ from: source, rev: 'HEAD', root: plugin });
    write(join(plugin, SKILLS_DIR, 'README.md'), 'x\n');
    expect(checkSkills(plugin)).toEqual([`${SKILLS_DIR}/README.md is not a skill folder`]);

    writeFileSync(join(plugin, PIN_PATH), JSON.stringify({ ...pin, skills: [...pin.skills, '../../src'] }));
    expect(() => checkSkills(plugin)).toThrow('"../../src" is not a skill folder name');
    expect(() => importSkills({ from: source, rev: 'HEAD', root: plugin })).toThrow('is not a skill folder name');
    expect(existsSync(join(plugin, 'src'))).toBe(false);
  });

  it('--check refuses a pin from another repository or without a commit revision', () => {
    commit('skills');
    const pin = importSkills({ from: source, rev: 'HEAD', root: plugin });
    const forged: SkillsPin = { ...pin, repository: 'https://example.com/fork', revision: 'main' };
    writeFileSync(join(plugin, PIN_PATH), JSON.stringify(forged));

    const problems = checkSkills(plugin);

    expect(problems).toContain(`${PIN_PATH}: repository https://example.com/fork is not ${SOURCE_REPOSITORY}`);
    expect(problems).toContain(`${PIN_PATH}: revision main is not a 40-hex commit`);
    rmSync(join(plugin, PIN_PATH));
    expect(checkSkills(plugin)[0]).toContain(`${PIN_PATH} is missing`);
  });

  it('a re-import drops a skill the new revision removed and keeps the CLI skill', () => {
    commit('two skills');
    importSkills({ from: source, rev: 'HEAD', root: plugin });
    rmSync(join(source, 'src/skills/workflow'), { recursive: true });
    commit('one skill');

    const pin = importSkills({ from: source, rev: 'HEAD', root: plugin });

    expect(pin.skills).toEqual(['data-guide']);
    expect(existsSync(join(plugin, SKILLS_DIR, 'workflow'))).toBe(false);
    expect(existsSync(join(plugin, SKILLS_DIR, CLI_SKILL, 'SKILL.md'))).toBe(true);
    expect(checkSkills(plugin)).toEqual([]);
  });

  it('refuses a symlink, a folder without SKILL.md and a source skill named like the CLI skill', () => {
    symlinkSync('SKILL.md', join(source, 'src/skills/workflow/link.md'));
    commit('symlink');
    expect(() => importSkills({ from: source, rev: 'HEAD', root: plugin })).toThrow('is not a regular file');

    rmSync(join(source, 'src/skills/workflow/link.md'));
    write(join(source, 'src/skills/broken/notes.md'), 'x\n');
    commit('no SKILL.md');
    expect(() => importSkills({ from: source, rev: 'HEAD', root: plugin })).toThrow('src/skills/broken');

    rmSync(join(source, 'src/skills/broken'), { recursive: true });
    write(join(source, `src/skills/${CLI_SKILL}/SKILL.md`), 'x\n');
    commit('collision');
    expect(() => importSkills({ from: source, rev: 'HEAD', root: plugin })).toThrow(CLI_SKILL);
  });

  it('only SKILL.md gets the footer, and the footer names no invd command', () => {
    expect(vendoredBytes('a/references/x.md', Buffer.from('x')).toString()).toBe('x');
    expect(vendoredBytes('a/SKILL.md', Buffer.from('x')).toString()).toBe(`x\n\n${FOOTER}\n`);
    expect(FOOTER).not.toMatch(/`invd [^`]/u);
  });
});

describe('the committed plugin skills', () => {
  it('match reference/data-skills.pin.json (pnpm skills:import:check)', () => {
    expect(checkSkills(ROOT)).toEqual([]);
  });
});
