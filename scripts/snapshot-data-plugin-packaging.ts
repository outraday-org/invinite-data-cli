import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { exportArtifact } from './reference-artifacts';

/** Read-only package inventory. Does not import the CLI, install files or connect a client. */
const REPO_ROOT = resolve(import.meta.dirname, '..');
const pluginRoot = resolve(REPO_ROOT, 'claude-plugin');
const walk = (directory: string): Array<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = resolve(directory, entry.name);
    if (entry.name === '.DS_Store') return [];
    return entry.isDirectory() ? walk(nextPath) : [nextPath];
  });
const manifest = z
  .object({ name: z.string(), version: z.string() })
  .parse(JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')));
const mcp = z
  .object({ mcpServers: z.record(z.object({ url: z.string().url() })) })
  .parse(JSON.parse(readFileSync(resolve(pluginRoot, '.mcp.json'), 'utf8')));
const servers = Object.entries(mcp.mcpServers);
const connector = servers[0];
if (!connector || servers.length !== 1) throw new Error('Expected exactly one Data plugin MCP connector');
const previous = JSON.parse(readFileSync(resolve(REPO_ROOT, 'reference/data-plugin-identity.snapshot.json'), 'utf8'));
const pluginSources = [...walk(pluginRoot), resolve(REPO_ROOT, 'src/commands/plugin.ts')].sort();
const sourceHashes = Object.fromEntries(
  pluginSources.map((file) => [
    relative(REPO_ROOT, file),
    createHash('sha256').update(readFileSync(file)).digest('hex'),
  ]),
);
const unchanged =
  Object.keys(sourceHashes).length === Object.keys(previous.sourceHashes).length &&
  Object.entries(sourceHashes).every(([file, hash]) => previous.sourceHashes[file] === hash);
const revision = unchanged
  ? previous.download.revision
  : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
if (!unchanged) {
  const committedFiles = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', revision, '--', 'claude-plugin', 'src/commands/plugin.ts'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .sort();
  if (JSON.stringify(committedFiles) !== JSON.stringify(Object.keys(sourceHashes).sort()))
    throw new Error('Commit the changed plugin file roster before exporting its immutable download ref');
}
for (const [file, hash] of unchanged ? [] : Object.entries(sourceHashes)) {
  const committed = execFileSync('git', ['show', `${revision}:${file}`], { cwd: REPO_ROOT });
  if (createHash('sha256').update(committed).digest('hex') !== hash)
    throw new Error(`Commit plugin source before exporting its immutable download ref: ${file}`);
}
const snapshot = {
  observedAt: new Date().toISOString().slice(0, 10),
  download: { owner: 'outraday-org', repository: 'invinite-data-cli', revision },
  manifest,
  connector: { key: connector[0], url: connector[1].url },
  files: walk(pluginRoot)
    .map((file) => relative(pluginRoot, file))
    .sort(),
  sourceHashes,
};
exportArtifact(
  'reference/data-plugin-identity.snapshot.json',
  snapshot,
  [
    ...walk(pluginRoot),
    resolve(REPO_ROOT, 'src/commands/plugin.ts'),
    resolve(REPO_ROOT, 'scripts/snapshot-data-plugin-packaging.ts'),
  ].map((file) => relative(REPO_ROOT, file)),
  process.argv.includes('--check'),
);
