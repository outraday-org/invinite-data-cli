import ora, { type Ora } from 'ora';
import { setJsonOutput } from './json-mode.js';

let jsonMode = false;

/** The spinners started on a terminal, so an interrupt can stop them (and restore the cursor) before exiting. */
const live = new Set<Ora>();

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
  setJsonOutput(enabled);
}

export function createSpinner(text: string): Ora {
  // Progress is for a person watching a terminal: silent under --json and when stderr is not a terminal.
  if (jsonMode || !process.stderr.isTTY) {
    return ora({ text, isSilent: true });
  }
  const spinner = ora(text).start();
  live.add(spinner);
  return spinner;
}

/** Stops every spinner still turning (`src/shared/signals.ts` calls it on SIGINT / SIGTERM). */
export function stopSpinners(): void {
  for (const spinner of live) if (spinner.isSpinning) spinner.stop();
  live.clear();
}
