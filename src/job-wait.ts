import { ApiError } from './shared/errors.js';
import { onInterrupt } from './shared/signals.js';
import { createSpinner } from './shared/spinner.js';

/**
 * `--wait` on a command that starts a background job (`invd bulk export`, Data API 12.2): the job is read again until
 * its status is terminal, then (with `--out` / `--save`) its file is downloaded. Hand-written on top of the generated
 * command: the spec has no "poll this operation" relation, so the three operations of one job are named here.
 */
export interface JobWait {
  /** The read of one job (`getBulkExport`). */
  status: string;
  /** The job's download (`getBulkExportDownload`). */
  download: string;
  /** The job id field of the answer, also the path parameter of both operations. */
  id: string;
}

export const JOB_WAITS: Readonly<Record<string, JobWait>> = {
  createBulkExport: { status: 'getBulkExport', download: 'getBulkExportDownload', id: 'export_id' },
};

/** The statuses of a job still at work; any other status (ready, failed, expired, or one unknown) ends the wait. */
export const PENDING_STATUSES: readonly string[] = ['queued', 'running'];

/** Seam for tests: the pause between two reads. */
export const waitClock = {
  sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
};

/** The pause before read `attempt` (0-based): 10 s for the first minute, then 20 s, 40 s, and 60 s from then on. */
export const pollDelayMs = (attempt: number): number => Math.min(60_000, 10_000 * 2 ** Math.floor(attempt / 6));

/**
 * Reads in a row that may fail with a 429 / 5xx or a network error before the wait gives up (the job keeps running
 * server-side).
 */
export const MAX_FAILED_READS = 3;

const transient = (error: unknown): boolean =>
  (error instanceof ApiError && (error.statusCode === 429 || error.statusCode >= 500))
  // `fetch` rejects a network failure with a TypeError.
  || error instanceof TypeError;

const statusOf = (job: unknown): string | undefined => {
  if (typeof job !== 'object' || job === null) return undefined;
  const status: unknown = Reflect.get(job, 'status');
  return typeof status === 'string' ? status : undefined;
};

/**
 * Reads the job (`read`) while its status is pending and returns the first other answer. A job that is no longer
 * pending is returned at once. A read refused with 429 / 5xx (or a network error) is skipped (the next read follows the schedule) up to
 * `MAX_FAILED_READS` in a row; any other error ends the wait. Ctrl-C prints `resumeHint(status)` (the commands that
 * follow the job) before the interrupt exit.
 */
export async function waitForJob(
  first: unknown,
  options: { id: string; read: () => Promise<unknown>; resumeHint: (status: string) => string },
): Promise<unknown> {
  let job = first;
  let status = statusOf(job) ?? 'unknown';
  if (!PENDING_STATUSES.includes(status)) return job;
  const spinner = createSpinner(`${options.id}: ${status}`);
  const unregister = onInterrupt(() => console.error(options.resumeHint(status)));
  let failed = 0;
  try {
    for (let attempt = 0; ; attempt += 1) {
      const delay = pollDelayMs(attempt);
      spinner.text = `${options.id}: ${status} (next check in ${delay / 1000} s)`;
      await waitClock.sleep(delay);
      try {
        job = await options.read();
        failed = 0;
      } catch (error) {
        failed += 1;
        if (!transient(error) || failed >= MAX_FAILED_READS) throw error;
        continue;
      }
      status = statusOf(job) ?? 'unknown';
      if (!PENDING_STATUSES.includes(status)) break;
    }
    spinner.stop();
    return job;
  } catch (error) {
    spinner.stop();
    throw error;
  } finally {
    unregister();
  }
}
