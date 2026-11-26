import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FAILED_READS, pollDelayMs, waitClock, waitForJob } from '../../src/job-wait.js';
import { ApiError } from '../../src/shared/errors.js';
import { handleInterrupt } from '../../src/shared/signals.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const hint = (status: string) => `stopped at ${status}; resume with invd bulk export-status bx_1`;

describe('pollDelayMs', () => {
  it('10 s for the first minute, then backing off to 60 s', () => {
    expect([0, 5, 6, 11, 12, 17, 18, 40].map(pollDelayMs)).toEqual([10_000, 10_000, 20_000, 20_000, 40_000, 40_000, 60_000, 60_000]);
  });
});

describe('waitForJob', () => {
  it('reads until a terminal status and returns that answer', async () => {
    vi.spyOn(waitClock, 'sleep').mockResolvedValue();
    const read = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'ready', row_count: 3 });
    expect(await waitForJob({ status: 'queued' }, { id: 'bx_1', read, resumeHint: hint })).toEqual({ status: 'ready', row_count: 3 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('skips a 429 / 5xx read, but gives up after MAX_FAILED_READS in a row; another error ends the wait at once', async () => {
    vi.spyOn(waitClock, 'sleep').mockResolvedValue();
    const unavailable = new ApiError(503, 'Unavailable', 'down');
    const read = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ status: 'failed' });
    expect(await waitForJob({ status: 'queued' }, { id: 'bx_1', read, resumeHint: hint })).toEqual({ status: 'failed' });
    const always = vi.fn().mockRejectedValue(unavailable);
    await expect(waitForJob({ status: 'queued' }, { id: 'bx_1', read: always, resumeHint: hint })).rejects.toBe(unavailable);
    expect(always).toHaveBeenCalledTimes(MAX_FAILED_READS);
    const notFound = new ApiError(404, 'Not found', 'gone', undefined, 'not_found');
    const once = vi.fn().mockRejectedValue(notFound);
    await expect(waitForJob({ status: 'queued' }, { id: 'bx_1', read: once, resumeHint: hint })).rejects.toBe(notFound);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('Ctrl-C prints the job id and how to resume before the interrupt exit', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line?: unknown) => { lines.push(String(line)); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    vi.spyOn(waitClock, 'sleep').mockImplementation(async () => { handleInterrupt('SIGINT'); });
    await expect(waitForJob({ status: 'running' }, { id: 'bx_1', read: vi.fn(), resumeHint: hint })).rejects.toThrow('exit 130');
    expect(lines).toEqual([hint('running')]);
  });
});
