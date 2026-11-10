import { UsageError } from './errors.js';

/**
 * Asks before something costly or destructive. `--yes` answers for the person; `--no-input` (or no terminal on
 * stdin, e.g. CI) refuses with exit 2 instead of waiting for an answer nobody can give.
 */
export async function confirmOrRefuse(question: string, flags: { yes?: boolean; input?: boolean }): Promise<void> {
  if (flags.yes) return;
  if (flags.input === false || !process.stdin.isTTY) {
    throw new UsageError(`${question} Pass --yes to go ahead without a prompt.`);
  }
  const { default: Enquirer } = await import('enquirer');
  const answer = await new Enquirer().prompt({ type: 'confirm', name: 'ok', message: question, initial: false }) as { ok: boolean };
  if (!answer.ok) throw new UsageError('Cancelled.');
}

/** Reads all of stdin as text (`--body-file -`, `auth login --with-token`). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}
