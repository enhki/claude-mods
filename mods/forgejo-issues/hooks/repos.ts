import type { RepoInfo } from '../types'

/** The project file listing the other repos the pane can switch to, relative to the session folder. */
export const REPOS_FILE = '.claude/forgejo-issues.json'

/** `owner/repo` as the switcher, the store and `/issues <repo>` name it. */
export function repoKey(r: Pick<RepoInfo, 'owner' | 'repo'>): string {
  return `${r.owner}/${r.repo}`
}

/**
 * The `owner/repo` names in a project's repos file (`{ "repos": [...] }`):
 * entries that are not `owner/repo` are dropped, a trailing `.git` is
 * trimmed, and a repeat is kept once. A missing or unreadable file is none.
 */
export function parseRepoList(json: string | null): string[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  const list = (parsed as { repos?: unknown } | null)?.repos
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().replace(/\.git$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(name)) continue
    if (!out.some(x => x.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out
}

/** The repos to switch between: the session's own first, then the listed ones on its host. */
export function repoChoices(launch: RepoInfo, listed: string[]): RepoInfo[] {
  const out = [launch]
  for (const name of listed) {
    const [owner, repo] = name.split('/') as [string, string]
    if (out.some(r => repoKey(r).toLowerCase() === name.toLowerCase())) continue
    out.push({ ...launch, owner, repo })
  }
  return out
}

/** What the switcher calls a repo: its name, or `owner/repo` where two choices share the name. */
export function repoLabel(r: RepoInfo, choices: RepoInfo[]): string {
  const same = choices.filter(c => c.repo.toLowerCase() === r.repo.toLowerCase())
  return same.length > 1 ? repoKey(r) : r.repo
}

/**
 * The choice `/issues <arg>` names: `owner/repo` or a repo name, matched
 * without case, exact first, then a prefix only one choice starts with.
 */
export function matchRepo(choices: RepoInfo[], arg: string): RepoInfo | undefined {
  const want = arg.trim().toLowerCase()
  if (!want) return undefined
  const exact = choices.find(r => repoKey(r).toLowerCase() === want || r.repo.toLowerCase() === want)
  if (exact) return exact
  const prefix = choices.filter(r => r.repo.toLowerCase().startsWith(want) || repoKey(r).toLowerCase().startsWith(want))
  return prefix.length === 1 ? prefix[0] : undefined
}
