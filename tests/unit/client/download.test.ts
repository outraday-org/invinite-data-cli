import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
}));

import { downloadToFile, extensionFor, writeTextFile } from '../../../src/client/download.js';

function streamOf(chunks: string[], failAfter?: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (failAfter !== undefined && i === failAfter) {
        controller.error(new Error('connection reset'));
        return;
      }
      if (i < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('downloadToFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'invd-download-'));
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the streamed bytes without an Authorization header', async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, body: streamOf(['abc', 'def']) });
    const file = join(dir, 'call.mp3');

    const result = await downloadToFile('https://r2.example.com/signed', file);

    expect(result).toEqual({ path: file, bytes: 6 });
    expect(await readFile(file, 'utf8')).toBe('abcdef');
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('https://r2.example.com/signed');
    expect(init).toEqual({ signal: expect.any(AbortSignal) });
  });

  it('refuses to overwrite an existing file without force', async () => {
    const file = join(dir, 'deck.pdf');
    await writeFile(file, 'old');

    await expect(downloadToFile('https://r2.example.com/signed', file)).rejects.toThrow(/--force/);
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('old');
  });

  it('overwrites with force', async () => {
    const file = join(dir, 'deck.pdf');
    await writeFile(file, 'old');
    (fetch as any).mockResolvedValue({ ok: true, status: 200, body: streamOf(['new']) });

    await downloadToFile('https://r2.example.com/signed', file, { force: true });
    expect(await readFile(file, 'utf8')).toBe('new');
  });

  it('creates no file on a non-2xx response', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 403, body: null });

    await expect(downloadToFile('https://r2.example.com/signed', join(dir, 'a.mp3'))).rejects.toThrow(/403/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('cleans up after a failed stream', async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, body: streamOf(['abc', 'def'], 1) });

    await expect(downloadToFile('https://r2.example.com/signed', join(dir, 'a.mp3'))).rejects.toThrow('connection reset');
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('removes the .part file on %s and exits %i', async (signal, code) => {
    // One chunk, then the body hangs like a slow download.
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return new Promise<void>(() => {});
        sent = true;
        controller.enqueue(new TextEncoder().encode('abc'));
      },
    });
    (fetch as any).mockResolvedValue({ ok: true, status: 200, body });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const listeners = process.listenerCount(signal);
    const file = join(dir, 'call.mp3');

    const pending = downloadToFile('https://r2.example.com/signed', file);
    await vi.waitFor(async () => expect(await readFile(`${file}.part`, 'utf8')).toBe('abc'));
    process.emit(signal, signal);

    await expect(pending).rejects.toThrow(/abort/i);
    expect(exit).toHaveBeenCalledWith(code);
    expect(await readdir(dir)).toEqual([]);
    expect(process.listenerCount(signal)).toBe(listeners);
    exit.mockRestore();
  });
});

describe('writeTextFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'invd-text-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes text and refuses to overwrite without force', async () => {
    const file = join(dir, 'transcript.txt');
    expect(await writeTextFile(file, 'héllo')).toEqual({ path: file, bytes: 6 });
    await expect(writeTextFile(file, 'again')).rejects.toThrow(/--force/);
    await writeTextFile(file, 'again', { force: true });
    expect(await readFile(file, 'utf8')).toBe('again');
  });
});

describe('extensionFor', () => {
  it('maps content types to extensions', () => {
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('text/html; charset=utf-8')).toBe('html');
    expect(extensionFor(null)).toBe('bin');
  });
});
