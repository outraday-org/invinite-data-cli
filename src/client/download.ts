import { createWriteStream, rmSync } from 'node:fs';
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createSpinner } from '../shared/spinner.js';

export interface SaveOptions {
  /** Replace an existing file. */
  force?: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolves `file` against cwd and refuses an existing target unless `force`. */
async function prepareTarget(file: string, opts: SaveOptions): Promise<string> {
  const path = resolve(file);
  if (!opts.force && await exists(path)) {
    throw new Error(`${path} already exists (use --force to overwrite)`);
  }
  await mkdir(dirname(path), { recursive: true });
  return path;
}

/** Exit codes of the signals that abort a write (128 + signal number, as a shell reports them). */
const ABORT_SIGNALS: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };

/**
 * Runs `write(part, signal)` against `<path>.part` and renames it onto `path` on success, so a
 * failed write never leaves a partial file or clobbers an existing one. While it runs, SIGINT /
 * SIGTERM (Ctrl-C) abort `signal`, remove the `.part` file synchronously and exit with 130 / 143 —
 * a listener replaces Node's default exit, which would skip the cleanup.
 */
async function writeViaPart(path: string, write: (part: string, signal: AbortSignal) => Promise<void>): Promise<void> {
  const part = `${path}.part`;
  const controller = new AbortController();
  const onSignal = (signal: NodeJS.Signals) => {
    controller.abort();
    rmSync(part, { force: true });
    process.exit(ABORT_SIGNALS[signal]);
  };
  for (const signal of Object.keys(ABORT_SIGNALS)) process.once(signal, onSignal);
  try {
    await write(part, controller.signal);
    await rename(part, path);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  } finally {
    for (const signal of Object.keys(ABORT_SIGNALS)) process.off(signal, onSignal);
  }
}

/**
 * Streams a presigned URL to disk. Plain fetch: NO Authorization header — the URL is a
 * bearer URL and R2 would reject the extra header. Written through `writeViaPart`.
 */
export async function downloadToFile(
  url: string,
  file: string,
  opts: SaveOptions & { spinnerText?: string } = {},
): Promise<{ path: string; bytes: number }> {
  const path = await prepareTarget(file, opts);
  const spinner = createSpinner(opts.spinnerText ?? 'Downloading...');
  try {
    await writeViaPart(path, async (part, signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(part), { signal });
    });
    const { size } = await stat(path);
    spinner.succeed('Downloaded');
    return { path, bytes: size };
  } catch (error) {
    spinner.fail('Download failed');
    throw error;
  }
}

/** Writes text (transcript, press release) to `file`; refuses an existing target unless `force`. */
export async function writeTextFile(file: string, text: string, opts: SaveOptions = {}): Promise<{ path: string; bytes: number }> {
  const path = await prepareTarget(file, opts);
  await writeViaPart(path, (part, signal) => writeFile(part, text, { encoding: 'utf8', signal }));
  return { path, bytes: Buffer.byteLength(text, 'utf8') };
}

/** `mkdir -p` of a directory target (`documents --output dir/`); returns its absolute path. */
export async function ensureDir(dir: string): Promise<string> {
  const path = resolve(dir);
  await mkdir(path, { recursive: true });
  return path;
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
};

/** File extension for a `content_type` (parameters ignored); `bin` when unknown. */
export function extensionFor(contentType: string | null | undefined): string {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? 'bin';
}
