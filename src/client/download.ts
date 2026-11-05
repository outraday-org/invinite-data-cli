import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { IntegrityError, PartialDownloadError } from '../shared/errors.js';
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
 * Streams a permanent public media URL (audio, deck, document, PDF) to disk. Plain fetch: NO
 * Authorization header — the public bucket needs none. Written through `writeViaPart`.
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

/** What the API stated about the bytes; each stated value is verified, an absent one is not. */
export interface ExpectedFile {
  /** Lower-case hex SHA-256 (also checked against the answer's `X-Content-SHA256` header when it sends one). */
  sha256?: string;
  /** The true size in bytes (else the answer's `Content-Length`, unless the body is content-encoded). */
  bytes?: number;
  /** Accepted media types (parameters ignored); the answer's `Content-Type` must be one of them. */
  contentTypes?: readonly string[];
}

export interface VerifiedFile {
  path: string;
  bytes: number;
  sha256: string;
  /** The target already held exactly these bytes (`expected.sha256` matched): nothing was requested or written. */
  skipped: boolean;
}

/** Hex SHA-256 of a file on disk. */
export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

const mediaType = (value: string | null | undefined): string => (value ?? '').split(';')[0].trim().toLowerCase();

/**
 * Streams `open(signal)`'s body to `file` through `writeViaPart`, verifying what is known before the rename: the
 * media type, the size (short = `PartialDownloadError`, exit 4; a broken stream too) and the SHA-256 (else
 * `IntegrityError`, exit 5) — a failed check saves nothing. Resume rule for immutable files: an existing target whose
 * SHA-256 equals `expected.sha256` is complete (`skipped`, no request); any other existing target needs `force`.
 * `open` is the request: keyless `fetch` of a permanent public URL, or `apiDownload` for a key-authorized stream.
 */
export async function saveVerified(
  open: (signal: AbortSignal) => Promise<Response>,
  file: string,
  opts: SaveOptions & { expected?: ExpectedFile; spinnerText?: string } = {},
): Promise<VerifiedFile> {
  const path = resolve(file);
  const expected = opts.expected ?? {};
  if (!opts.force && await exists(path)) {
    if (expected.sha256 && await fileSha256(path) === expected.sha256.toLowerCase()) {
      const { size } = await stat(path);
      return { path, bytes: size, sha256: expected.sha256.toLowerCase(), skipped: true };
    }
    throw new Error(`${path} already exists (use --force to overwrite${expected.sha256 ? '' : ', or pass --sha256 to accept an identical file'})`);
  }
  await mkdir(dirname(path), { recursive: true });
  const spinner = createSpinner(opts.spinnerText ?? 'Downloading...');
  let digest = '';
  let received = 0;
  try {
    await writeViaPart(path, async (part, signal) => {
      const response = await open(signal);
      if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);
      const type = mediaType(response.headers?.get('Content-Type'));
      if (expected.contentTypes && !expected.contentTypes.includes(type)) {
        throw new IntegrityError(`Expected ${expected.contentTypes.join(' or ')}, the server sent ${type || 'no media type'}; nothing was saved`);
      }
      const length = response.headers?.get('Content-Encoding') ? null : response.headers?.get('Content-Length');
      const size = expected.bytes ?? (length && /^\d+$/.test(length) ? Number(length) : undefined);
      const shas = [expected.sha256, response.headers?.get('X-Content-SHA256') ?? undefined]
        .filter((value): value is string => Boolean(value))
        .map(value => value.toLowerCase());
      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          hash.update(chunk);
          done(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(response.body as WebReadableStream), meter, createWriteStream(part), { signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new PartialDownloadError(received, size);
      }
      if (size !== undefined && received < size) throw new PartialDownloadError(received, size);
      if (size !== undefined && received > size) {
        throw new IntegrityError(`Received ${received} bytes, ${size} were stated; nothing was saved`);
      }
      digest = hash.digest('hex');
      const mismatch = shas.find(sha => sha !== digest);
      if (mismatch) throw new IntegrityError(`SHA-256 ${digest} differs from the stated ${mismatch}; nothing was saved`);
    });
    spinner.succeed('Downloaded');
    return { path, bytes: received, sha256: digest, skipped: false };
  } catch (error) {
    spinner.fail('Download failed');
    throw error;
  }
}

/** A file name from a server or manifest, reduced to one safe path segment (no directories, no control chars). */
export function safeFileName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned.slice(0, 200) : fallback;
}

/** The `filename` of a `Content-Disposition` header (`filename*=UTF-8''…` first), if any. */
export function dispositionFileName(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended.trim());
    } catch {
      // fall through to the plain form
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/i.exec(header)?.[1]?.trim();
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
