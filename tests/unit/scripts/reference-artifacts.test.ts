import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT, sha256 } from '../../../scripts/reference-artifacts.js';
import { resolve } from 'node:path';

describe('owner reference provenance', () => {
  it('exports registration only with isolated configuration and network disabled', () => {
    const generator = readFileSync(resolve(ROOT, 'scripts/snapshot-data-cli-reference.ts'), 'utf8');
    expect(generator).toContain('createProgram();');
    expect(generator).not.toMatch(/program\.parse(?:Async)?\(/u);
    expect(generator).toContain('mkdtempSync');
    expect(generator).toContain('INVD_CONFIG_DIR');
    expect(generator).toContain('Network disabled');
    expect(generator).toContain('finally');
  });
  it('pins the versioned API owner contract', () => {
    const upstream = JSON.parse(readFileSync(resolve(ROOT, 'api-contract.json'), 'utf8'));
    expect(upstream.provenance.repository).toBe('https://github.com/outraday-org/invinite-data-api');
    expect(upstream.provenance.specSha256).toBe(sha256('openapi.json'));
  });
  for (const name of ['data-cli-reference.snapshot.json', 'data-plugin-identity.snapshot.json']) {
    it(`checks ${name} source hashes and payload fingerprint offline`, () => {
      const artifact = JSON.parse(readFileSync(resolve(ROOT, 'reference', name), 'utf8'));
      for (const [file, hash] of Object.entries(artifact.provenance.sourceHashes))
        expect(sha256(file), file).toBe(hash);
      const { revision, fingerprint, ...provenance } = artifact.provenance;
      expect(revision).toMatch(/^[a-f0-9]{40}$/u);
      const digest = createHash('sha256')
        .update(JSON.stringify({ ...artifact, provenance }))
        .digest('hex');
      expect(digest).toBe(fingerprint);
    });
  }
});
