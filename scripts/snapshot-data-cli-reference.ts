/** Explicit authoring tool. Normal Consumers read the committed snapshot; source introspection runs only in its owner. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportArtifact } from './reference-artifacts';

type RegisteredOption = {
  flags: string;
  description: string;
  mandatory: boolean;
  defaultValue?: unknown;
  argChoices?: ReadonlyArray<string>;
};
type RegisteredCommand = {
  name: () => string;
  description: () => string;
  usage: () => string;
  options: ReadonlyArray<RegisteredOption>;
  registeredArguments: ReadonlyArray<{ name: () => string; description: string; required: boolean }>;
  commands: ReadonlyArray<RegisteredCommand>;
};
type ManifestOperation = { group: string; action: string; method: string; path: string };
const REPO_ROOT = resolve(import.meta.dirname, '..');
globalThis.fetch = async () => {
  throw new Error('Network disabled during CLI reference export');
};
const scratch = mkdtempSync(join(tmpdir(), 'invinite-data-cli-docs-'));
const previousDirectory = process.env.INVD_CONFIG_DIR;
process.env.INVD_CONFIG_DIR = scratch;
const sourceFiles = (directory: string): Array<string> =>
  readdirSync(join(REPO_ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
try {
  const {
    createProgram,
    loadManifest,
  }: { createProgram: () => RegisteredCommand; loadManifest: () => { operations: ReadonlyArray<ManifestOperation> } } =
    await import(pathToFileURL(join(REPO_ROOT, 'src/cli.ts')).href);
  // This owner's roster decides which commands are hand-written; every other leaf must be a manifest operation.
  const { HAND_WRITTEN_COMMANDS }: { HAND_WRITTEN_COMMANDS: ReadonlyArray<{ command: string }> } = await import(
    pathToFileURL(join(REPO_ROOT, 'src/hand-written-commands.ts')).href
  );
  const program = createProgram(); // Registration only: never parse argv or invoke an action.
  const manifestOperations = loadManifest().operations;
  const manifestGroups = new Set(manifestOperations.map((operation) => operation.group));
  const spec = JSON.parse(readFileSync(resolve(REPO_ROOT, 'openapi.json'), 'utf8'));
  const inSpec = (method: string, path: string) => Boolean(spec.paths[path]?.[method.toLowerCase()]);
  const options = (command: RegisteredCommand) =>
    command.options.map((option) => ({
      flags: option.flags,
      description: option.description,
      required: option.mandatory,
      ...(option.defaultValue === undefined ? {} : { default: option.defaultValue }),
      ...(option.argChoices ? { choices: option.argChoices } : {}),
    }));
  /** A rostered command's API operations, regex-scraped from its file (`src/commands/<top-level>.ts`). */
  const scrapeHandOperations = (
    tokens: ReadonlyArray<string>,
    sourcePath: string,
  ): Array<{ method: string; path: string }> => {
    const name = tokens[tokens.length - 1] ?? '';
    const source = readFileSync(join(REPO_ROOT, sourcePath), 'utf8');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const commandBlock =
      source
        .split(new RegExp(`(?:\\.command|selectorCommand)\\(['\"]${escapedName}(?:['\"]| )`, 'u'))[1]
        ?.split(/(?:\.command|selectorCommand)\(/u)[0] ?? '';
    const base = /const BASE = '([^']+)'/u.exec(source)?.[1] ?? '';
    /** `cmdOpts.documentId` → `{document_id}`: the spec's spelling of the path parameter a template interpolates. */
    const pathParameter = (_match: string, expression: string) => {
      const camel = expression.split('.').pop() ?? expression;
      return `{${camel.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)}}`;
    };
    const pathLiterals = [...commandBlock.matchAll(/path: (?:'([^']+)'|`([^`]+)`)/gu)].map(
      (match) => match[1] ?? match[2] ?? '',
    );
    const paths = pathLiterals.map((literal) =>
      literal.replaceAll('${BASE}', base).replace(/\$\{encodeURIComponent\(([^)]+)\)\}/gu, pathParameter),
    );
    if (tokens[0] === 'ws') paths.push('/v1/ws');
    const declaredMethod = /method: '(POST|PATCH|DELETE|PUT)'/u.exec(commandBlock)?.[1] ?? 'GET';
    const method = tokens[0] === 'ws' ? 'WS' : declaredMethod;
    return [...new Set(paths)].filter((path) => inSpec(method, path)).map((path) => ({ method, path }));
  };
  const collect = (
    command: RegisteredCommand,
    parents: ReadonlyArray<string> = [],
  ): Array<{ command: string } & Record<string, unknown>> =>
    command.commands.flatMap((child) => {
      const tokens = [...parents, child.name()];
      if (child.commands.length) return collect(child, tokens);
      const name = tokens.join(' ');
      const manifestOperation = manifestOperations.find(
        (operation) => [operation.group, operation.action].filter(Boolean).join(' ') === name,
      );
      const rostered = HAND_WRITTEN_COMMANDS.some(
        (entry) => name === entry.command || name.startsWith(`${entry.command} `),
      );
      if (manifestOperation && rostered)
        throw new Error(`invd ${name} is both a manifest operation and on the hand-written roster`);
      if (!manifestOperation && !rostered)
        throw new Error(
          `invd ${name} is neither a manifest operation nor on the hand-written roster (src/hand-written-commands.ts)`,
        );
      let origin: 'spec' | 'hand';
      let source: string;
      let operations: Array<{ method: string; path: string }>;
      if (manifestOperation) {
        origin = 'spec';
        source = 'src/generated/cli-manifest.json';
        operations = [{ method: manifestOperation.method.toUpperCase(), path: manifestOperation.path }];
        if (!inSpec(manifestOperation.method, manifestOperation.path))
          throw new Error(
            `invd ${name}: ${manifestOperation.method.toUpperCase()} ${manifestOperation.path} is not in openapi.json — copy the spec the local manifest was built from`,
          );
      } else {
        origin = 'hand';
        source = `src/commands/${tokens[0] === 'logout' ? 'login' : tokens[0]}.ts`;
        operations = scrapeHandOperations(tokens, source);
        // A rostered command inside an API group (or the WebSocket) calls the API; a local one (login, config, plugin) may not.
        if (operations.length === 0 && (manifestGroups.has(tokens[0] ?? '') || tokens[0] === 'ws'))
          throw new Error(`invd ${name}: no API path found in ${source}`);
      }
      return [
        {
          command: name,
          group: tokens[0],
          origin,
          description: child.description(),
          source,
          operations,
          arguments: child.registeredArguments.map((argument) => ({
            name: argument.name(),
            description: argument.description,
            required: argument.required,
          })),
          options: options(child),
        },
      ];
    });
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const snapshot = {
    provenance: {
      repository: pkg.repository.url,
      version: pkg.version,
      revision: 'source-hashes',
      package: pkg.name,
      bin: pkg.bin,
      engines: pkg.engines,
      verifiedOn: new Date().toISOString().slice(0, 10),
      sourceHashes: Object.fromEntries(
        ['package.json', ...sourceFiles('src')].sort().map((file) => [
          file,
          createHash('sha256')
            .update(readFileSync(join(REPO_ROOT, file)))
            .digest('hex'),
        ]),
      ),
    },
    globalOptions: options(program),
    // Alphabetical, like `invd --help` (the REPO_ROOT registers its roster before the manifest's groups).
    groups: program.commands
      .map((command) => ({ id: command.name(), description: command.description() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    commands: collect(program).sort((a, b) => a.command.localeCompare(b.command)),
  };
  exportArtifact(
    'reference/data-cli-reference.snapshot.json',
    snapshot,
    [
      'package.json',
      'openapi.json',
      'api-contract.json',
      'scripts/check-api-contract.mjs',
      'scripts/snapshot-data-cli-reference.ts',
      ...sourceFiles('src'),
    ],
    process.argv.includes('--check'),
  );
} finally {
  if (previousDirectory === undefined) delete process.env.INVD_CONFIG_DIR;
  else process.env.INVD_CONFIG_DIR = previousDirectory;
  rmSync(scratch, { recursive: true, force: true });
}
