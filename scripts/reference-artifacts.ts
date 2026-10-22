import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = (file: string) =>
  createHash('sha256')
    .update(readFileSync(resolve(ROOT, file)))
    .digest('hex');

/** Hashes identify the exact source bytes; revision names the checkout base at first export. */
export function exportArtifact(
  file: string,
  payload: Record<string, unknown> & { provenance?: Record<string, unknown> },
  sources: ReadonlyArray<string>,
  check = false,
): void {
  const target = resolve(ROOT, file);
  const sourceHashes = Object.fromEntries(
    [...new Set([...sources, 'package.json', 'scripts/reference-artifacts.ts'])]
      .sort()
      .map((source) => [source, sha256(source)]),
  );
  const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : undefined;
  const sameSources = JSON.stringify(previous?.provenance?.sourceHashes) === JSON.stringify(sourceHashes);
  const today = new Date().toISOString().slice(0, 10);
  const provenance: Record<string, unknown> = {
    ...payload.provenance,
    repository: 'https://github.com/outraday-org/invinite-data-cli',
    version: JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version,
    specSha256: sha256('openapi.json'),
    sourceHashes,
  };
  // Revision itself cannot enter the fingerprint: committing the artifact must not stale it.
  delete provenance.revision;
  if ('verifiedOn' in provenance) provenance.verifiedOn = sameSources ? previous.provenance.verifiedOn : today;
  const unsigned = {
    ...payload,
    ...('observedAt' in payload ? { observedAt: sameSources ? previous.observedAt : today } : {}),
    provenance,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const artifact = {
    ...unsigned,
    provenance: {
      ...provenance,
      revision:
        previous?.provenance?.fingerprint === fingerprint
          ? previous.provenance.revision
          : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      fingerprint,
    },
  };
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== serialized)
      throw new Error(`${file} stale; run its owner export`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, serialized);
  }
}
