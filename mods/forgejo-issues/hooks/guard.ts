/**
 * Whether a tool call by the model reaches into the claude-mods secrets
 * folder. A mod reads that folder itself; the model has no reason to, and a
 * stray `cat` or `grep -r ~/.config` would put a token in the transcript.
 *
 * Bash is matched on the command text, so a determined command can get past
 * it; it is there to stop the accidental reads.
 */
export function touchesSecrets(
  tool: string,
  input: Record<string, unknown>,
  secretsDir: string,
  home: string,
): boolean {
  const dir = secretsDir.replace(/\/+$/, '')
  const spellings = [dir]
  if (home && dir.startsWith(`${home}/`)) {
    const rest = dir.slice(home.length)
    spellings.push(`~${rest}`, `$HOME${rest}`, `\${HOME}${rest}`)
  }
  // The folder itself or anything in it: the spelling ends at a path end, a
  // slash, or a character no path segment holds (a quote, space, `;`, `|`, ...).
  const pattern = new RegExp(`(?:${spellings.map(escape).join('|')})(?=$|[/\\s'"\`;|&)<>])`)
  const hits = (text: unknown) => typeof text === 'string' && pattern.test(text)

  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return hits(input.file_path)
    case 'Grep':
    case 'Glob':
      // A search rooted above the folder is let through: blocking those would
      // stop every search of ~/.config. Only a search aimed at it is refused.
      return hits(input.path) || hits(input.pattern)
    case 'Bash': {
      // A heredoc's body is text on its way somewhere (a file, a commit
      // message), not a path being opened; only the command itself counts.
      const command = stripHeredocs(String(input.command ?? ''))
      const relative = home && dir.startsWith(`${home}/`) ? dir.slice(home.length + 1) : null
      return hits(command) || (relative !== null && new RegExp(`(^|[\\s'"=])${escape(relative)}\\b`).test(command))
    }
    default:
      return false
  }
}

/** The command with every heredoc body (`<<EOF` … `EOF`, any quoting or `<<-`) taken out. */
export function stripHeredocs(command: string): string {
  const lines = command.split('\n')
  const out: string[] = []
  const pending: string[] = []
  for (const line of lines) {
    if (pending.length > 0) {
      if (line.replace(/^\t+/, '') === pending[0]) pending.shift()
      continue
    }
    out.push(line)
    for (const m of line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) pending.push(m[2]!)
  }
  return out.join('\n')
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

