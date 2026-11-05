import ora, { type Ora } from 'ora';
import { setJsonOutput } from './json-mode.js';

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
  setJsonOutput(enabled);
}

export function createSpinner(text: string): Ora {
  if (jsonMode) {
    return ora({ text, isSilent: true });
  }
  return ora(text).start();
}
