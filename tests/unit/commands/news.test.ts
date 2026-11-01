import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

vi.mock('../../../src/config/auth.js', () => ({ getApiKey: vi.fn().mockResolvedValue('test-api-key') }));

vi.mock('../../../src/config/config-manager.js', () => ({ getBaseUrl: vi.fn().mockReturnValue('https://api.example.com') }));

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { Command } from 'commander';
import { registerEarningsCommands } from '../../../src/commands/earnings.js';
import { registerNewsCommands } from '../../../src/commands/news.js';

const PDF_BYTES = '%PDF-1.7 fixture';

const ID = '13351ae7-876b-4839-ba2b-78873f6b4e00';

let server: Server;
let pdfUrl: string;
let pdfHeaders: Record<string, unknown>[];
let dir: string;
let logs: string[];
let logSpy: MockInstance;

const realFetch = globalThis.fetch;

/** The API answers from `answer`; anything else (the local PDF fixture) is a real request. */
function stubApi(answer: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (
    String(url).startsWith('https://api.example.com')
      ? new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : realFetch(url, init)
  )));
}

async function run(...args: string[]) {
  const program = new Command();
  program.option('--json').exitOverride();
  registerEarningsCommands(program);
  registerNewsCommands(program);
  await program.parseAsync(['node', 'invd', ...args]);
}

const pdf = () => ({ url: pdfUrl, version: 1, sha256: 'ab', bytes: PDF_BYTES.length, pages: 2, generated_at: '2026-11-01T00:00:00.000Z' });

const newsItem = (value: unknown) => ({ id: ID, title: 'Headline', attribution: { publisher: 'Arm' }, body_text: 'Text', pdf: value });

const transcript = (value: unknown) => ({
  event: { symbol: 'FDX' }, version: 2, version_kind: 'final', published_at: '2026-11-01T00:00:00.000Z', qa_start_ms: null, format: 'text', data: 'Words', pdf: value,
});

beforeAll(async () => {
  server = createServer((request, response) => {
    pdfHeaders.push(request.headers);
    response.setHeader('Content-Type', 'application/pdf');
    response.end(PDF_BYTES);
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  pdfUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/r1.pdf`;
});

afterAll(async () => {
  await new Promise(resolve => { server.close(resolve); });
});

beforeEach(async () => {
  pdfHeaders = [];
  logs = [];
  dir = await mkdtemp(join(tmpdir(), 'invd-pdf-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { logs.push(String(line ?? '')); });
});

afterEach(async () => {
  logSpy.mockRestore();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe('invd news get', () => {
  it('prints the item with its attribution and PDF URL, above the body', async () => {
    stubApi(newsItem(pdf()));
    await run('news', 'get', '--id', ID, '--body', 'text');
    const text = logs.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    expect(text.indexOf('attribution.publisher')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('pdf.url')).toBeLessThan(text.indexOf('body_text'));
    expect(String((fetch as any).mock.calls[0][0])).toBe(`https://api.example.com/v1/news/${ID}?body=text`);
  });

  it('--pdf prints the URL alone, or the note without a PDF', async () => {
    stubApi(newsItem(pdf()));
    await run('news', 'get', '--id', ID, '--pdf');
    expect(logs).toEqual([pdfUrl]);

    logs.length = 0;
    stubApi(newsItem(null));
    await run('news', 'get', '--id', ID, '--pdf');
    expect(logs.join('')).toContain('No PDF yet');
  });

  it('--pdf-out saves the file with no API key on the request', async () => {
    stubApi(newsItem(pdf()));
    const file = join(dir, 'item.pdf');
    await run('news', 'get', '--id', ID, '--pdf-out', file);
    expect(await readFile(file, 'utf8')).toBe(PDF_BYTES);
    expect(pdfHeaders[0]?.authorization).toBeUndefined();
    expect(logs.join('')).toContain('Saved');
  });

  it('--pdf-out fails without a PDF', async () => {
    stubApi(newsItem(null));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run('news', 'get', '--id', ID, '--pdf-out', join(dir, 'item.pdf')).catch(() => undefined);
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.mock.calls.flat().join(' ')).toContain('No PDF yet');
    exit.mockRestore();
    errors.mockRestore();
  });
});

describe('invd earnings transcript PDF flags', () => {
  it('--pdf prints the URL alone, not the transcript', async () => {
    stubApi(transcript(pdf()));
    await run('earnings', 'transcript', '--event-id', 'e1', '--pdf');
    expect(logs).toEqual([pdfUrl]);
  });

  it('--pdf-out saves the file, and -o still saves the text beside it', async () => {
    stubApi(transcript(pdf()));
    const file = join(dir, 'call.pdf');
    const text = join(dir, 'call.txt');
    await run('earnings', 'transcript', '--event-id', 'e1', '--pdf-out', file, '-o', text);
    expect(await readFile(file, 'utf8')).toBe(PDF_BYTES);
    expect(await readFile(text, 'utf8')).toContain('Words');
    expect(logs.join('\n')).not.toContain('\nWords');
  });
});
