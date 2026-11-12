import { stopSpinners } from './spinner.js';

/** Exit codes of the signals that stop a command (128 + signal number, as a shell reports them). */
export const ABORT_SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;

export type AbortSignalName = keyof typeof ABORT_SIGNALS;

/** A synchronous cleanup run before the exit (remove a `.part` file, print a resume cursor, close a server). */
export type InterruptCleanup = (signal: AbortSignalName) => void;

const cleanups: InterruptCleanup[] = [];
let installed = false;

/** Stops the spinners, runs the registered cleanups (newest first), then exits 130 / 143. */
export function handleInterrupt(signal: AbortSignalName): void {
  stopSpinners();
  for (const cleanup of [...cleanups].reverse()) {
    try {
      cleanup(signal);
    } catch {
      // one failing cleanup must not keep the others (or the exit) from running
    }
  }
  process.exit(ABORT_SIGNALS[signal]);
}

/**
 * Installs the one SIGINT / SIGTERM handler of the process (idempotent): every command, interrupted, exits 130 / 143
 * (C1). `bin/invd.ts` calls it before parsing; `onInterrupt` calls it too, so a registered cleanup always runs.
 */
export function installSignalExit(): void {
  if (installed) return;
  installed = true;
  for (const signal of Object.keys(ABORT_SIGNALS) as AbortSignalName[]) process.on(signal, handleInterrupt);
}

/** Registers `cleanup` for an interrupt; the returned function unregisters it (call it in a `finally`). */
export function onInterrupt(cleanup: InterruptCleanup): () => void {
  installSignalExit();
  cleanups.push(cleanup);
  return () => {
    const index = cleanups.lastIndexOf(cleanup);
    if (index >= 0) cleanups.splice(index, 1);
  };
}

/**
 * While a walk runs, Ctrl-C / SIGTERM print `Stopped after N row(s) — resume with --cursor X` (when rows were written
 * and a cursor is known) before the interrupt exit 130 / 143. Returns the unregister function.
 */
export function resumeOnInterrupt(progress: () => { written: number; cursor?: string }): () => void {
  return onInterrupt(() => {
    const { written, cursor } = progress();
    if (written > 0 && cursor) console.error(`Stopped after ${written} row(s) — resume with --cursor ${cursor}`);
  });
}
