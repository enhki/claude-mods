import type { Comment, Issue, Label, Milestone } from '../types'

/** Where a repository lives on a Forgejo/Gitea host. */
export type RepoRef = {
  host: string
  owner: string
  repo: string
  webBase: string
  apiBase: string
}

/**
 * Reads a git remote URL in any of its spellings: scp-like
 * (`git@host:owner/repo.git`), `ssh://`, `https://` (with or without a port or
 * credentials). The API is assumed on https at the same host; `apiOverride`
 * replaces it where the SSH host is not the web host.
 */
export function parseRemote(url: string, apiOverride = ''): RepoRef | null {
  const trimmed = url.trim()
  let host: string | undefined
  let path: string | undefined
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(trimmed)
  const full = /^(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/.exec(trimmed)
  if (full) [, host, path] = full
  else if (scp) [, host, path] = scp
  if (!host || !path) return null
  const parts = path.replace(/\.git\/?$/, '').replace(/\/$/, '').split('/')
  const repo = parts.pop()
  const owner = parts.pop()
  if (!owner || !repo) return null
  const webBase = `https://${host}`
  const apiBase = apiOverride ? apiOverride.replace(/\/+$/, '') : `${webBase}/api/v1`
  return { host, owner, repo, webBase, apiBase }
}

/** The secrets-file key holding the token for `host`: `FORGEJO_TOKEN_GIT_EXAMPLE_ORG`. */
export function tokenKey(host: string): string {
  return `FORGEJO_TOKEN_${host.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** Parses `KEY=value` lines (comments, blank lines, `export`, quotes allowed). */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || !m[1]) continue
    let value = m[2] ?? ''
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    out.set(m[1], value)
  }
  return out
}

/**
 * The token fgj keeps for `host` in its config.yaml
 * (`hosts: { <host>: { token } }`), read without a YAML library.
 */
export function fgjToken(yaml: string, host: string): string | undefined {
  let inHost = false
  let hostIndent = -1
  for (const line of yaml.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const key = /^\s*([^:\s]+):\s*(.*)$/.exec(line)
    if (!key) continue
    if (inHost && indent <= hostIndent) inHost = false
    if (key[1] === host && !key[2]) {
      inHost = true
      hostIndent = indent
    } else if (inHost && key[1] === 'token' && key[2]) {
      return key[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return undefined
}

/** Where a token was found, for the pane to say (never the token itself). */
export type TokenSource = 'secrets' | 'fgj'

/**
 * The token for `host`, first match wins: the claude-mods secrets file's
 * host-bound key, then fgj's entry for that host. Never a token keyed to
 * another host, so a repo on one forge cannot leak another forge's token.
 */
export function pickToken(
  host: string,
  secretsText: string | null,
  fgjYaml: string | null,
): { token: string; source: TokenSource } | null {
  const fromSecrets = secretsText ? parseEnv(secretsText).get(tokenKey(host)) : undefined
  if (fromSecrets) return { token: fromSecrets, source: 'secrets' }
  const fromFgj = fgjYaml ? fgjToken(fgjYaml, host) : undefined
  if (fromFgj) return { token: fromFgj, source: 'fgj' }
  return null
}

type ApiIssue = {
  number: number
  title: string
  body?: string
  state: string
  comments: number
  updated_at: string
  html_url: string
  user?: { login?: string }
  labels?: { name: string; color: string }[]
  milestone?: { title?: string } | null
  pull_request?: unknown
}

function list<T>(json: string, what: string): T[] {
  const raw = JSON.parse(json) as unknown
  if (!Array.isArray(raw)) throw new Error(`${what} is not a list`)
  return raw as T[]
}

const hex = (c: string) => `#${c.replace(/^#/, '')}`

/** Narrows the API's issue list to what the pane draws; pull requests are left out. */
export function toIssues(json: string): Issue[] {
  return list<ApiIssue>(json, 'issue list')
    .filter(i => !i.pull_request)
    .map(i => ({
      number: i.number,
      title: i.title,
      body: i.body ?? '',
      state: i.state === 'closed' ? 'closed' : 'open',
      comments: i.comments,
      updatedAt: i.updated_at,
      url: i.html_url,
      author: i.user?.login ?? '',
      labels: (i.labels ?? []).map(l => ({ name: l.name, color: hex(l.color) })),
      milestone: i.milestone?.title ?? null,
    }))
}

export function toLabels(json: string): Label[] {
  return list<{ name: string; color: string; exclusive?: boolean; description?: string }>(json, 'label list').map(
    l => ({ name: l.name, color: hex(l.color), exclusive: Boolean(l.exclusive), description: l.description ?? '' }),
  )
}

export function toMilestones(json: string): Milestone[] {
  return list<{ title: string; open_issues?: number; closed_issues?: number }>(json, 'milestone list').map(m => ({
    title: m.title,
    open: m.open_issues ?? 0,
    closed: m.closed_issues ?? 0,
  }))
}

export function toComments(json: string): Comment[] {
  return list<{ user?: { login?: string }; body?: string; created_at: string }>(json, 'comment list').map(c => ({
    author: c.user?.login ?? '',
    body: c.body ?? '',
    createdAt: c.created_at,
  }))
}

/** Splits a scoped label (`kind/bug`, `area/ui/menu`) at its last slash, as Forgejo does. */
export function scopeOf(name: string): { scope: string | null; leaf: string } {
  const at = name.lastIndexOf('/')
  return at > 0 && at < name.length - 1 ? { scope: name.slice(0, at), leaf: name.slice(at + 1) } : { scope: null, leaf: name }
}

/**
 * Turns bare `#123` references into links to the issue page, outside code
 * spans and fences, so the pane can catch a press on one and open it in place.
 */
export function linkifyRefs(markdown: string, issueBase: string): string {
  return markdown
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((block, i) =>
      i % 2 === 1
        ? block
        : block
            .split(/(`[^`\n]*`)/)
            .map((part, j) =>
              j % 2 === 1 ? part : part.replace(/(^|[^\w&#\[\/])#(\d+)\b/g, (_, pre: string, n: string) => `${pre}[#${n}](${issueBase}/${n})`),
            )
            .join(''),
    )
    .join('')
}

/** "3d", "5h", "just now": how long ago `iso` was, from `now` (ms). */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'now'
  const units: [number, string][] = [[31_536_000, 'y'], [2_592_000, 'mo'], [86_400, 'd'], [3_600, 'h'], [60, 'm']]
  for (const [size, unit] of units) if (s >= size) return `${Math.floor(s / size)}${unit}`
  return 'now'
}
