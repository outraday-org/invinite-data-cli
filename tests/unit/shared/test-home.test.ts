import os, { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RUNTIMES } from '../../../src/commands/plugin.js';
import { mcpConfigPath } from '../../../src/commands/agent-setup.js';

describe('tests run on a temporary home (tests/setup.ts)', () => {
  it('os.homedir, HOME, XDG_CONFIG_HOME and the global install targets all sit under the temp dir', () => {
    const root = tmpdir();
    for (const value of [homedir(), os.homedir(), process.env.HOME, process.env.XDG_CONFIG_HOME, RUNTIMES.claude.globalDir, mcpConfigPath('claude', 'global')]) {
      expect(value?.startsWith(root), value).toBe(true);
    }
    expect(process.env.INVD_CONFIG_DIR?.startsWith(root)).toBe(true);
  });
});
