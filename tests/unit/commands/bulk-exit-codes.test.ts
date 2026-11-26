import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The real process exit code (not the mocked `process.exit` of the other command tests) of a bulk export that ended
 * without a file: `bin/invd.ts` run with tsx against a local stub of the API. A pipe (`invd … | tail`) reports the
 * last command's status, not invd's; scripts read `$?` of invd itself or `PIPESTATUS`.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const job = (status: string) => ({
  export_id: 'bx_1', status, dataset: 'f13', format: 'parquet', from: '2026-01-01', to: '2026-06-30',
  created_at: '2026-11-26T16:00:00Z', row_count: null, bytes: null, expires_at: null,
  error_code: status === 'failed' ? 'internal' : null, coverage: null,
});

let server: Server;
let base = '';
/** The status a POST answers (an already-finished job is not polled, so the child never sleeps). */
let created = 'failed';

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      res.end(JSON.stringify(job(created)));
      return;
    }
    res.statusCode = 409;
    res.end(JSON.stringify({ title: 'Conflict', status: 409, code: 'conflict', detail: 'This export failed (internal); nothing to download.' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const exitCodeOf = (...args: string[]): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'bin/invd.ts', ...args], {
      cwd: ROOT,
      env: { ...process.env, INVD_API_KEY: 'k', INVD_BASE_URL: base, INVD_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr }));
  });

const create = ['bulk', 'export', '--dataset', 'f13', '--company', 'AAPL', '--from', '2026-01-01', '--to', '2026-06-30', '--wait', '--out', '.'];

describe('bulk export exit codes of the real process', () => {
  it('export --wait of a failed job exits 1', async () => {
    created = 'failed';
    const { code, stderr } = await exitCodeOf(...create);
    expect(stderr).toContain('bx_1 failed (internal)');
    expect(code).toBe(1);
  }, 30_000);

  it('export --wait of an expired job exits 3', async () => {
    created = 'expired';
    expect((await exitCodeOf(...create)).code).toBe(3);
  }, 30_000);

  it('export-download of a failed job (409 conflict) exits 1', async () => {
    const { code, stderr } = await exitCodeOf('bulk', 'export-download', 'bx_1', '--out', '.');
    expect(stderr).toContain('(conflict)');
    expect(code).toBe(1);
  }, 30_000);
});
