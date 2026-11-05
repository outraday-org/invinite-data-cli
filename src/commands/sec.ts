import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { apiDownload, apiGet } from '../client/api-client.js';
import { dispositionFileName, ensureDir, safeFileName, saveVerified, type VerifiedFile } from '../client/download.js';
import { formatKeyValue, formatTable } from '../formatters/table-formatter.js';
import { apiErrorHint, withErrorHandling } from '../shared/errors.js';
import { output } from '../shared/output.js';
import { printReadinessNotes } from '../shared/readiness.js';
import { setJsonMode } from '../shared/spinner.js';

/**
 * The hand-written `sec` downloads (`src/hand-written-commands.ts`); every other `sec` action is generated from the
 * spec and attaches to the same group. Two kinds of bytes, never mixed up:
 * - originals and figures are PERMANENT PUBLIC objects: fetched from their stated `url` without the API key;
 * - a metric export is private: streamed from the key-authorized `GET /v1/sec/exports/{export_id}/file`.
 * Each download verifies what the API stated (size, SHA-256, media type) before the file appears; nothing ever
 * fetches the SEC's own site. A saved citation is the immutable version / block, never a URL carrying a key.
 */

/** Exit code when a command finished but left documents unsaved (stated per document, never skipped silently). */
export const INCOMPLETE_EXIT_CODE = 3;

const EXPORT_CONTENT_TYPES = ['application/gzip', 'application/x-gzip'] as const;

interface ManifestDocument {
  filename: string;
  role?: string | null;
  doc_type?: string | null;
  mime_type?: string | null;
  availability?: string | null;
  quarantine_reason?: string | null;
  too_large?: boolean | null;
  sha256?: string | null;
  size_bytes?: number | null;
  canonical?: { status?: string | null; version_id?: string | null; text_ready?: boolean; visual_ready?: boolean } | null;
  source?: { url?: string | null } | null;
}

interface FilingManifest {
  readiness?: { status?: string; reason?: string | null };
  filing?: { accession?: string; form?: string } | null;
  documents?: ManifestDocument[];
}

export interface SavedDocument {
  filename: string;
  role: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  version_id: string | null;
  status: 'saved' | 'already_complete' | 'not_saved';
  path: string | null;
  url: string | null;
  reason: string | null;
}

const httpsUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

/** Why a manifest document has no public original to fetch (the API's own words, no guess). */
export function notSavedReason(document: ManifestDocument): string {
  if (document.availability && document.availability !== 'stored') {
    return `availability ${document.availability}${document.quarantine_reason ? ` (${document.quarantine_reason})` : ''}`;
  }
  if (document.too_large) return 'too_large';
  return 'no permanent public copy yet';
}

/** `-o`: an existing directory or a path ending in `/` is a directory; anything else a file. */
async function isDirectoryTarget(target: string): Promise<boolean> {
  if (/[\\/]$/.test(target)) return true;
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

const publicFetch = (url: string) => (signal: AbortSignal) => fetch(url, { signal });

const savedLine = (file: VerifiedFile): string => file.skipped
  ? `Already complete: ${file.path} (sha256 ${file.sha256})`
  : `Saved ${file.path} (${file.bytes.toLocaleString('en-US')} bytes, sha256 ${file.sha256})`;

async function saveOriginal(
  document: ManifestDocument,
  dir: string,
  opts: { force?: boolean },
): Promise<SavedDocument> {
  const url = httpsUrl(document.source?.url);
  const base: SavedDocument = {
    filename: document.filename,
    role: document.role ?? null,
    mime_type: document.mime_type ?? null,
    size_bytes: document.size_bytes ?? null,
    sha256: document.sha256 ?? null,
    version_id: document.canonical?.version_id ?? null,
    status: 'not_saved',
    path: null,
    url,
    reason: null,
  };
  if (!url) return { ...base, reason: notSavedReason(document) };
  const file = await saveVerified(publicFetch(url), join(dir, safeFileName(document.filename, 'document')), {
    force: opts.force,
    expected: {
      ...(document.sha256 ? { sha256: document.sha256 } : {}),
      ...(typeof document.size_bytes === 'number' ? { bytes: document.size_bytes } : {}),
    },
    spinnerText: `Downloading ${document.filename}...`,
  });
  return { ...base, status: file.skipped ? 'already_complete' : 'saved', path: file.path };
}

export function registerSecCommands(program: Command): void {
  const sec = program.commands.find(command => command.name() === 'sec') ?? program.command('sec');

  sec.command('save')
    .description("Save a filing's original documents from their permanent public copies (lists every one it cannot save, with why)")
    .requiredOption('--accession <accession>', 'Accession number (dashed)')
    .option('--filename <filename>', 'Only this document of the filing (default: every document)')
    .option('-o, --output <dir>', 'Directory to save into', '.')
    .option('--force', 'Overwrite existing files')
    .action(withErrorHandling(async (cmdOpts: { accession: string; filename?: string; output: string; force?: boolean }) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      const manifest = await apiGet<FilingManifest>({ path: `/v1/sec/filings/${encodeURIComponent(cmdOpts.accession)}` });
      const documents = (manifest.documents ?? [])
        .filter(document => !cmdOpts.filename || document.filename === cmdOpts.filename);
      if (cmdOpts.filename && documents.length === 0 && manifest.readiness?.status === 'ready') {
        throw new Error(`${cmdOpts.filename} is not a document of ${cmdOpts.accession} (see: invd sec filing --accession ${cmdOpts.accession})`);
      }
      const dir = await ensureDir(cmdOpts.output);
      const results: SavedDocument[] = [];
      for (const document of documents) results.push(await saveOriginal(document, dir, cmdOpts));
      const complete = manifest.readiness?.status === 'ready' && results.every(result => result.status !== 'not_saved');
      const report = { accession: cmdOpts.accession, readiness: manifest.readiness ?? null, complete, documents: results };
      output(report, opts, () => {
        formatTable(
          results.map(result => ({
            filename: result.filename,
            role: result.role ?? '',
            size_bytes: result.size_bytes ?? '',
            status: result.status,
            detail: result.path ?? result.reason ?? '',
          })),
          ['filename', 'role', 'size_bytes', 'status', 'detail'],
        );
        printReadinessNotes(manifest);
        const missing = results.filter(result => result.status === 'not_saved').length;
        if (missing > 0) {
          console.error(chalk.yellow(`${missing} of ${results.length} documents not saved (reason per row); canonical text: invd sec document --accession ${cmdOpts.accession} --filename <filename>`));
        }
      });
      if (!complete) process.exitCode = INCOMPLETE_EXIT_CODE;
    }, apiErrorHint));

  sec.command('save-figure')
    .description("Save a cited figure's image from its permanent public URL")
    .requiredOption('--version-id <version_id>', 'Document version id (immutable)')
    .requiredOption('--block-id <block_id>', 'Figure block id')
    .option('-o, --output <path>', 'File or directory to save into', '.')
    .option('--force', 'Overwrite an existing file')
    .action(withErrorHandling(async (cmdOpts: { versionId: string; blockId: string; output: string; force?: boolean }) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      const answer = await apiGet<Record<string, any>>({
        path: `/v1/sec/versions/${encodeURIComponent(cmdOpts.versionId)}/figures/${encodeURIComponent(cmdOpts.blockId)}`,
      });
      const url = httpsUrl(answer.image?.url);
      if (!url) {
        printReadinessNotes(answer);
        const reason = answer.readiness?.reason ?? 'no public image';
        throw new Error(`No public image for block ${cmdOpts.blockId} of version ${cmdOpts.versionId} (${reason})`);
      }
      const name = safeFileName(new URL(url).pathname.split('/').pop(), `${cmdOpts.blockId}.img`);
      const target = await isDirectoryTarget(cmdOpts.output) ? join(await ensureDir(cmdOpts.output), name) : cmdOpts.output;
      const file = await saveVerified(publicFetch(url), target, { force: cmdOpts.force, spinnerText: 'Downloading figure...' });
      const citation = { version_id: cmdOpts.versionId, block_id: cmdOpts.blockId };
      output({ citation, path: file.path, bytes: file.bytes, sha256: file.sha256, url }, opts, () => {
        console.log(chalk.green(savedLine(file)));
        formatKeyValue({ citation: `${citation.version_id}#${citation.block_id}` });
      });
    }, apiErrorHint));

  sec.command('export-file')
    .description('Download a metric export (.csv.gz, key-authorized), verified against its SHA-256')
    .requiredOption('--export-id <export_id>', 'Export id (from invd sec metric-export / sec export)')
    .option('-o, --output <path>', 'File or directory to save into (default: the server-named file in .)', '.')
    .option('--sha256 <hex>', "The export's sha256 (from invd sec export): verified, and an identical existing file counts as complete without a request")
    .option('--force', 'Overwrite an existing file')
    .action(withErrorHandling(async (cmdOpts: { exportId: string; output: string; sha256?: string; force?: boolean }) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      if (cmdOpts.sha256 && !/^[0-9a-f]{64}$/i.test(cmdOpts.sha256)) throw new Error('--sha256 expects 64 hex characters');
      const request = { path: `/v1/sec/exports/${encodeURIComponent(cmdOpts.exportId)}/file`, accept: 'application/gzip' };
      const expected = { ...(cmdOpts.sha256 ? { sha256: cmdOpts.sha256 } : {}), contentTypes: EXPORT_CONTENT_TYPES };
      let file: VerifiedFile;
      if (await isDirectoryTarget(cmdOpts.output)) {
        // The name comes from the answer's Content-Disposition, so the request opens first.
        const response = await apiDownload(request);
        const name = safeFileName(dispositionFileName(response.headers.get('Content-Disposition')), `${cmdOpts.exportId}.csv.gz`);
        const headerSha = response.headers.get('X-Content-SHA256') ?? undefined;
        file = await saveVerified(async () => response, join(await ensureDir(cmdOpts.output), name), {
          force: cmdOpts.force,
          expected: { ...expected, ...(expected.sha256 ?? headerSha ? { sha256: expected.sha256 ?? headerSha } : {}) },
          spinnerText: 'Downloading export...',
        });
        if (file.skipped) await response.body?.cancel();
      } else {
        file = await saveVerified(signal => apiDownload({ ...request, signal }), cmdOpts.output, {
          force: cmdOpts.force,
          expected,
          spinnerText: 'Downloading export...',
        });
      }
      output({ export_id: cmdOpts.exportId, path: file.path, bytes: file.bytes, sha256: file.sha256, skipped: file.skipped }, opts, () => {
        console.log(chalk.green(savedLine(file)));
      });
    }, apiErrorHint));
}
