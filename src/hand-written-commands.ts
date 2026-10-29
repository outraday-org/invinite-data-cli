/**
 * The commands `invd` writes by hand, each with WHY it is not one REST call plus one view. Every other command is
 * generated from the manifest (`src/spec-commands.ts`); `tests/unit/command-roster.test.ts` fails on a hand-written
 * command missing here, on an entry that registers nothing, and on an entry that is also a manifest operation.
 * An entry is a top-level command (`group`, covering its subcommands) or one `group action`.
 */
export const HAND_WRITTEN_COMMANDS = [
  { command: 'login', reason: 'Clerk PKCE sign-in in the browser, then the local credential store' },
  { command: 'logout', reason: 'clears the local credential store' },
  { command: 'config', reason: 'local settings (API key, API host)' },
  { command: 'plugin', reason: 'copies the bundled Claude plugin into agent config dirs' },
  { command: 'ws', reason: 'WebSocket stream (/v1/ws); --earnings is the live transcript (src/client/earnings-live.ts), --news the news.live channel (src/client/news-live.ts)' },
  { command: 'earnings transcript', reason: 'renders the transcript as text and saves it with -o' },
  { command: 'earnings press-release', reason: 'prints the release text with --body and saves it with -o' },
  { command: 'earnings audio', reason: 'downloads the recording from its URL with -o' },
  { command: 'earnings slides', reason: 'downloads the deck PDF with -o, prints page markdown with --markdown' },
  { command: 'earnings documents', reason: 'downloads every document into a directory with -o' },
  { command: 'earnings company-documents', reason: 'downloads every stored file into a directory with -o' },
  { command: 'earnings document', reason: 'downloads the file, or fetches and renders its page text with --pages' },
] as const;
