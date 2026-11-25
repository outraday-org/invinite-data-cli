/**
 * The Agent Skills of the plugin come from `invinite-data-api` (`src/skills/`, served by its MCP server): this script
 * vendors a pinned copy into `claude-plugin/skills/` and records it in `reference/data-skills.pin.json`. The vendored
 * folders are never hand-edited; `invinite-data-cli` (the CLI-only skill) is this repository's own.
 *
 *   pnpm skills:import -- --from ../invinite-data-api --rev <commit>   re-vendor from a COMMITTED revision
 *   pnpm skills:import:check                                            the drift gate (no API checkout needed)
 *
 * The import reads the revision with `git ls-tree` / `git show` (never the working tree), writes every file of every
 * skill folder, appends ONE footer line to each `SKILL.md` (the only place a vendored file names the CLI skill), deletes
 * a previously vendored folder the revision no longer has, and writes the pin: repository, revision, and per file the
 * sha256 of the source bytes and of the written bytes. `--check` recomputes the written hashes from disk and also fails
 * on a folder under `claude-plugin/skills/` that is neither pinned nor `invinite-data-cli`, on a file the pin does not
 * list, and on a pin whose repository or revision is not what an import writes. Model: `scripts/check-api-contract.mjs`
 * (the pin check of the vendored `openapi.json` / `api-contract.json`).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VENDORED_SKILL_FOOTER } from '../src/commands/plugin.js';

export const SOURCE_REPOSITORY = 'https://github.com/outraday-org/invinite-data-api';
export const SOURCE_PATH = 'src/skills';
export const CLI_SKILL = 'invinite-data-cli';
export const SKILLS_DIR = 'claude-plugin/skills';
export const PIN_PATH = 'reference/data-skills.pin.json';
/** The one line appended to every vendored `SKILL.md`; the installer rewrites it for OpenCode (`plugin.ts`). */
export const FOOTER = VENDORED_SKILL_FOOTER;

/** A skill folder name (the Agent Skills `name` rule): never a path that could leave `claude-plugin/skills/`. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/u;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Local macOS folder metadata: never vendored, never a finding. */
const IGNORED = new Set(['.DS_Store']);

export interface PinnedFile {
  readonly source: string;
  readonly written: string;
}

export interface SkillsPin {
  readonly repository: string;
  readonly revision: string;
  readonly path: string;
  readonly footer: string;
  readonly skills: readonly string[];
  readonly files: Readonly<Record<string, PinnedFile>>;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** `git` in another checkout, without a caller's `GIT_DIR` / `GIT_WORK_TREE` (a hook's) redirecting it. */
function git(cwd: string, args: readonly string[]): Buffer {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR)$/.test(key)),
  );
  return execFileSync('git', ['-C', cwd, ...args], { env, maxBuffer: 64 * 1024 * 1024 });
}

const walk = (directory: string): string[] =>
  existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (IGNORED.has(entry.name)) return [];
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    })
    : [];

/** The vendored bytes: the source, plus the footer line after a `SKILL.md`. */
export function vendoredBytes(file: string, source: Buffer): Buffer {
  if (file.split('/').pop() !== 'SKILL.md') return source;
  const text = source.toString('utf8');
  return Buffer.from(`${text.endsWith('\n') ? text : `${text}\n`}\n${FOOTER}\n`, 'utf8');
}

/** The skill files of `rev` in `from`, keyed `<skill>/<path>`; a symlink, submodule or a folder without SKILL.md fails. */
export function readSkillsAt(from: string, rev: string): { revision: string; files: Map<string, Buffer> } {
  const revision = git(from, ['rev-parse', '--verify', `${rev}^{commit}`]).toString('utf8').trim();
  const entries = git(from, ['ls-tree', '-r', '-z', revision, '--', SOURCE_PATH])
    .toString('utf8')
    .split('\0')
    .filter(line => line !== '');
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    const [meta = '', path = ''] = entry.split('\t');
    const [mode, type] = meta.split(' ');
    const key = path.slice(SOURCE_PATH.length + 1);
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755'))
      throw new Error(`${path} at ${revision} is not a regular file (mode ${mode}, ${type}): skills hold real files only`);
    if (!key.includes('/')) throw new Error(`${path} at ${revision} is outside a skill folder`);
    if (IGNORED.has(key.split('/').pop() ?? '')) continue;
    files.set(key, git(from, ['show', `${revision}:${path}`]));
  }
  const skills = [...new Set([...files.keys()].map(key => key.split('/')[0] ?? ''))];
  if (skills.length === 0) throw new Error(`${SOURCE_PATH} at ${revision} holds no skill`);
  for (const skill of skills) {
    if (!SKILL_NAME.test(skill)) throw new Error(`${SOURCE_PATH}/${skill} at ${revision} is not a skill folder name`);
    if (skill === CLI_SKILL) throw new Error(`${SOURCE_PATH}/${CLI_SKILL} would overwrite this repository's own CLI skill`);
    if (!files.has(`${skill}/SKILL.md`)) throw new Error(`${SOURCE_PATH}/${skill} at ${revision} has no SKILL.md`);
  }
  return { revision, files };
}

const readPin = (root: string): SkillsPin | undefined => {
  const path = join(root, PIN_PATH);
  if (!existsSync(path)) return undefined;
  const pin = JSON.parse(readFileSync(path, 'utf8')) as SkillsPin;
  // Pinned names reach `rmSync` (import) and path joins (check): never a path out of claude-plugin/skills/.
  const bad = pin.skills.find(skill => !SKILL_NAME.test(skill));
  if (bad !== undefined) throw new Error(`${PIN_PATH}: ${JSON.stringify(bad)} is not a skill folder name`);
  return pin;
};

/** Vendors `rev` of `from` into `root`'s plugin and writes the pin; returns the pin. */
export function importSkills(options: { from: string; rev: string; root?: string }): SkillsPin {
  const root = options.root ?? REPO_ROOT;
  const { revision, files } = readSkillsAt(resolve(options.from), options.rev);
  const skills = [...new Set([...files.keys()].map(key => key.split('/')[0] ?? ''))].sort();
  const previous = readPin(root)?.skills ?? [];
  for (const skill of new Set([...previous, ...skills])) {
    if (skill !== CLI_SKILL) rmSync(join(root, SKILLS_DIR, skill), { recursive: true, force: true });
  }
  const pinned: Record<string, PinnedFile> = {};
  for (const key of [...files.keys()].sort()) {
    const source = files.get(key) ?? Buffer.alloc(0);
    const written = vendoredBytes(key, source);
    const target = join(root, SKILLS_DIR, key);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, written);
    pinned[key] = { source: sha256(source), written: sha256(written) };
  }
  const pin: SkillsPin = { repository: SOURCE_REPOSITORY, revision, path: SOURCE_PATH, footer: FOOTER, skills, files: pinned };
  mkdirSync(dirname(join(root, PIN_PATH)), { recursive: true });
  writeFileSync(join(root, PIN_PATH), `${JSON.stringify(pin, null, 2)}\n`);
  return pin;
}

/** Every difference between the pin and `root`'s plugin skills; empty = in sync. */
export function checkSkills(root: string = REPO_ROOT): string[] {
  const pin = readPin(root);
  if (!pin) return [`${PIN_PATH} is missing: run pnpm skills:import -- --from ../invinite-data-api --rev <commit>`];
  const problems: string[] = [];
  if (pin.repository !== SOURCE_REPOSITORY) problems.push(`${PIN_PATH}: repository ${pin.repository} is not ${SOURCE_REPOSITORY}`);
  if (!/^[a-f0-9]{40}$/u.test(pin.revision)) problems.push(`${PIN_PATH}: revision ${pin.revision} is not a 40-hex commit`);
  if (pin.footer !== FOOTER) problems.push(`${PIN_PATH}: footer differs from the import script's`);
  const skillsRoot = join(root, SKILLS_DIR);
  const entries = existsSync(skillsRoot)
    ? readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => !IGNORED.has(entry.name))
    : [];
  for (const entry of entries) {
    // The installer copies everything under skills/: a loose file or a linked folder would ship unpinned.
    if (!entry.isDirectory()) problems.push(`${SKILLS_DIR}/${entry.name} is not a skill folder`);
    else if (entry.name !== CLI_SKILL && !pin.skills.includes(entry.name))
      problems.push(`${SKILLS_DIR}/${entry.name} is neither a pinned skill nor ${CLI_SKILL}`);
  }
  for (const [key, hashes] of Object.entries(pin.files)) {
    const path = join(skillsRoot, key);
    if (!existsSync(path)) problems.push(`${SKILLS_DIR}/${key} is missing`);
    else if (sha256(readFileSync(path)) !== hashes.written)
      problems.push(`${SKILLS_DIR}/${key} differs from the pinned import (vendored files are written only by pnpm skills:import)`);
  }
  for (const skill of pin.skills) {
    for (const file of walk(join(skillsRoot, skill))) {
      const key = relative(skillsRoot, file).split(sep).join('/');
      if (!(key in pin.files)) problems.push(`${SKILLS_DIR}/${key} is not in ${PIN_PATH}`);
    }
  }
  return problems;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const problems = checkSkills();
      for (const problem of problems) console.error(problem);
      if (problems.length === 0) console.log(`vendored skills match ${PIN_PATH}`);
      process.exitCode = problems.length === 0 ? 0 : 1;
    } else {
      const from = argument('--from');
      const rev = argument('--rev');
      if (!from || !rev) throw new Error('usage: pnpm skills:import -- --from ../invinite-data-api --rev <commit>');
      const pin = importSkills({ from, rev });
      console.log(`vendored ${pin.skills.length} skills (${Object.keys(pin.files).length} files) from ${pin.revision}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
