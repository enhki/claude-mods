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
  const hits = (text: unknown) =>
    typeof text === 'string' && spellings.some(s => text === s || text.includes(`${s}/`) || text.endsWith(s))

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
    case 'Bash':
      return hits(input.command) || /claude-mods\/secrets\b/.test(String(input.command ?? ''))
    default:
      return false
  }
}

