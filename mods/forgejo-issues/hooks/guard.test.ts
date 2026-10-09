import { describe, expect, test } from 'claude-code/testing'

import { touchesSecrets } from './guard'

const HOME = '/h'
const DIR = '/h/.config/claude-mods/secrets'
const t = (tool: string, input: Record<string, unknown>) => touchesSecrets(tool, input, DIR, HOME)

describe('touchesSecrets', () => {
  test('read_of_a_secret_file', async () => {
    expect(t('Read', { file_path: `${DIR}/forgejo.env` })).toBe(true)
  })

  test('bash_in_every_home_spelling', async () => {
    expect(t('Bash', { command: 'cat ~/.config/claude-mods/secrets/forgejo.env' })).toBe(true)
    expect(t('Bash', { command: 'cat $HOME/.config/claude-mods/secrets/forgejo.env' })).toBe(true)
    expect(t('Bash', { command: 'ls "${HOME}/.config/claude-mods/secrets"' })).toBe(true)
    expect(t('Bash', { command: 'cd .config/claude-mods/secrets && cat *' })).toBe(true)
  })

  test('search_aimed_at_it', async () => {
    expect(t('Grep', { path: DIR, pattern: 'TOKEN' })).toBe(true)
  })

  test('ordinary_work_passes', async () => {
    expect(t('Read', { file_path: '/h/.config/claude-mods/forgejo-issues.json' })).toBe(false)
    expect(t('Grep', { path: '/h/.config', pattern: 'gaps_in' })).toBe(false)
    expect(t('Bash', { command: 'git status' })).toBe(false)
    expect(t('Edit', { file_path: '/h/repos/x/secrets.ts' })).toBe(false)
    expect(t('WebFetch', { url: 'https://example.com' })).toBe(false)
  })

  test('text_written_through_a_heredoc_is_not_a_read', async () => {
    const commit = "git commit -F - <<'EOF'\nfeat: token in ~/.config/claude-mods/secrets/forgejo.env\nEOF\ngit log -1"
    expect(t('Bash', { command: commit })).toBe(false)
    const script = 'python3 - <<EOF\nopen("t.ts").write("/claude-mods/secrets/forgejo.env")\nEOF'
    expect(t('Bash', { command: script })).toBe(false)
  })

  test('a_read_after_a_heredoc_still_counts', async () => {
    expect(t('Bash', { command: "cat <<'EOF'\nhi\nEOF\ncat ~/.config/claude-mods/secrets/forgejo.env" })).toBe(true)
  })

  test('a_path_merely_ending_in_the_name_elsewhere_passes', async () => {
    expect(t('Bash', { command: 'ls repos/x/claude-mods/secrets-docs' })).toBe(false)
  })
})
