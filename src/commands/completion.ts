import { Command } from 'commander';
import { UsageError } from '../shared/errors.js';

/** Every command path of the tree (`''` = the root) with the words completed after it: subcommands and flags. */
export function completionTable(program: Command): Map<string, string[]> {
  const table = new Map<string, string[]>();
  const walk = (command: Command, path: string[]) => {
    const words = [
      ...command.commands.map(child => child.name()),
      ...command.options.flatMap(option => [option.long, option.short].filter((flag): flag is string => Boolean(flag))),
      '--help',
    ];
    table.set(path.join(' '), [...new Set(words)]);
    for (const child of command.commands) walk(child, [...path, child.name()]);
  };
  walk(program, []);
  return table;
}

const shellQuote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

function bashScript(table: Map<string, string[]>, apiPaths: readonly string[]): string {
  const cases = [...table].map(([path, words]) => `    ${shellQuote(path)}) echo ${shellQuote(words.join(' '))} ;;`).join('\n');
  return `# invd completion for bash (eval "$(invd completion bash)", or save it under bash-completion's completions dir)
__invd_words() {
  case "$1" in
${cases}
  esac
}
__invd_api_paths=${shellQuote(apiPaths.join(' '))}
_invd() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" path="" w i words
  for ((i = 1; i < COMP_CWORD; i++)); do
    w="\${COMP_WORDS[i]}"
    [[ $w == -* ]] && continue
    words=" $(__invd_words "$path") "
    [[ $words == *" $w "* ]] && path="\${path:+$path }$w"
  done
  if [[ $path == api && $cur != -* ]]; then
    words="$__invd_api_paths GET POST PATCH DELETE"
  else
    words="$(__invd_words "$path")"
  fi
  COMPREPLY=($(compgen -W "$words" -- "$cur"))
}
complete -o default -F _invd invd
`;
}

function zshScript(table: Map<string, string[]>, apiPaths: readonly string[]): string {
  return `#compdef invd
# invd completion for zsh (eval "$(invd completion zsh)" in ~/.zshrc)
autoload -U +X bashcompinit && bashcompinit
${bashScript(table, apiPaths).split('\n').slice(1).join('\n')}`;
}

function fishScript(table: Map<string, string[]>, apiPaths: readonly string[]): string {
  const cases = [...table].map(([path, words]) => `    case ${shellQuote(path)}\n      printf '%s\\n' ${words.map(shellQuote).join(' ')}`).join('\n');
  return `# invd completion for fish (invd completion fish > ~/.config/fish/completions/invd.fish)
function __invd_words
  switch $argv[1]
${cases}
  end
end
function __invd_path
  set -l tokens (commandline -opc)
  set -e tokens[1]
  set -l path ''
  for t in $tokens
    string match -q -- '-*' $t; and continue
    if contains -- $t (__invd_words "$path")
      set path (string trim -- "$path $t")
    end
  end
  echo $path
end
function __invd_complete
  set -l path (__invd_path)
  if test "$path" = api
    printf '%s\\n' ${apiPaths.map(shellQuote).join(' ')}
  end
  __invd_words "$path"
end
complete -c invd -f -a '(__invd_complete)'
`;
}

export const SHELLS = ['bash', 'zsh', 'fish'] as const;

export function completionScript(shell: string, program: Command, apiPaths: readonly string[]): string {
  const table = completionTable(program);
  if (shell === 'bash') return bashScript(table, apiPaths);
  if (shell === 'zsh') return zshScript(table, apiPaths);
  if (shell === 'fish') return fishScript(table, apiPaths);
  throw new UsageError(`Unknown shell ${shell}: ${SHELLS.join(', ')}`);
}

/** `invd completion bash|zsh|fish`: the script, generated from the live command tree and the spec's paths. */
export function registerCompletionCommand(program: Command, apiPaths: () => readonly string[]): void {
  program
    .command('completion')
    .description('Print the shell completion script (commands, flags, and the API paths after invd api)')
    .argument('<shell>', SHELLS.join(' | '))
    .addHelpText('before', [
      'Examples:',
      '  $ eval "$(invd completion zsh)"',
      '  $ invd completion fish > ~/.config/fish/completions/invd.fish',
      '',
    ].join('\n'))
    .action((shell: string) => {
      try {
        process.stdout.write(completionScript(shell, program, apiPaths()));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
      }
    });
}
