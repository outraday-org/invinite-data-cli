// `tsc` copies no JSON: put the command manifest where `dist/src/cli.js` resolves it.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/src/generated', { recursive: true });
copyFileSync('src/generated/cli-manifest.json', 'dist/src/generated/cli-manifest.json');
