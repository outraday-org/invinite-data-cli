import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Never the person's real config: `resetConfig()` in the config tests clears it, API key included.
    env: { INVD_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'invd-test-config-')) },
    // A temporary home for every test file (os.homedir, HOME, XDG_CONFIG_HOME, APPDATA): tests/setup.ts.
    setupFiles: ['tests/setup.ts'],
  },
});
