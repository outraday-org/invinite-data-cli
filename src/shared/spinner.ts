import ora, { type Ora } from 'ora';
import { setJsonOutput } from './json-mode.js';

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
  setJsonOutput(enabled);
}

export function createSpinner(text: string): Ora {
  // Progress is for a person watching a terminal: silent under --json and when stderr is not a terminal.
  if (jsonMode || !process.stderr.isTTY) {
    return ora({ text, isSilent: true });
  }
  return ora(text).start();
}
