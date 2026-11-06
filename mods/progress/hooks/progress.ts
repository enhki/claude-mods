/** Pure readings behind the band: plans, a gate run's real outcome, the forge's lists and the maps. */

import type { Gate, Plan, Sheet, Specs } from '../types'

// ── Frontmatter and plans ───────────────────────────────────────────────────

/** The simple `key: value` pairs of a leading `---` block; nested values are left out. */
export function frontmatter(md: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!md.startsWith('---\n')) return out
  const end = md.indexOf('\n---', 4)
  if (end === -1) return out
  for (const line of md.slice(4, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '')
  }
  return out
}

type Row = { id: string; name: string; status: string }

/** A slice's short name: its bold lead, up to the first comma or bracket. */
function shortName(cell: string): string {
  const bold = /\*\*(.+?)\*\*/.exec(cell)?.[1] ?? cell
  return bold.replace(/\.$/, '').split(/,|\s\(/)[0]?.trim() ?? bold
}

/** The rows of the first table whose header has `#`, `Slice` and `Status` columns. */
export function sliceRows(md: string): Row[] {
  const lines = md.split('\n')
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  const head = lines.findIndex(l => l.trim().startsWith('|') && /\bSlice\b/.test(l) && /\bStatus\b/.test(l))
  if (head === -1) return []
  const cols = cells(lines[head] ?? '')
  const idAt = cols.indexOf('#')
  const nameAt = cols.indexOf('Slice')
  const statusAt = cols.indexOf('Status')
  if (idAt < 0 || nameAt < 0 || statusAt < 0) return []
  const rows: Row[] = []
  for (const line of lines.slice(head + 2)) {
    if (!line.trim().startsWith('|')) break
    const c = cells(line)
    rows.push({ id: c[idAt] ?? '', name: shortName(c[nameAt] ?? ''), status: (c[statusAt] ?? '').toLowerCase() })
  }
  return rows
}

export type PlanFile = { file: string; md: string }

/** A plan's title: its frontmatter, else its first heading, else its file name. */
export function planName(p: PlanFile): string {
  const title = frontmatter(p.md).title
  if (title) return title
  const heading = /^#\s+(.+?)\s*$/m.exec(p.md)?.[1]
  if (heading) return heading
  return p.file.replace(/^.*\//, '').replace(/\.md$/, '')
}

export function isActive(p: PlanFile): boolean {
  return /^active$/i.test(frontmatter(p.md).status ?? '')
}

/**
 * The plan to show: the explicit file when one is configured, else the plan whose
 * frontmatter says `status: active` (the first by file name when several do).
 * With plans but none active, a Plan with an empty name says so; with none, null.
 */
export function choosePlan(files: PlanFile[], explicit = ''): Plan | null {
  const plans = files.filter(f => sliceRows(f.md).length > 0).sort((a, b) => a.file.localeCompare(b.file))
  const active = plans.filter(isActive)
  const chosen = explicit ? plans.find(f => f.file === explicit) : active[0]
  if (!chosen) {
    if (plans.length === 0) return null
    return { name: '', file: '', current: null, done: 0, total: 0, nextGate: '', plans: plans.length, active: active.length }
  }
  const rows = sliceRows(chosen.md)
  const at = rows.findIndex(r => r.status.startsWith('current'))
  const from = at === -1 ? rows.findIndex(r => !r.status.startsWith('done')) : at
  const gate = rows.slice(Math.max(from, 0)).find(r => /^G\d+\b/.test(r.name))
  const cur = at === -1 ? undefined : rows[at]
  return {
    name: planName(chosen),
    file: chosen.file,
    current: cur ? { id: cur.id, name: cur.name } : null,
    done: rows.filter(r => r.status.startsWith('done')).length,
    total: rows.length,
    nextGate: gate ? (/^G\d+/.exec(gate.name)?.[0] ?? '') : '',
    plans: plans.length,
    active: active.length,
  }
}

// ── A gate run ──────────────────────────────────────────────────────────────

/** Gates: cabal build or test anywhere, and a check script only where it is the command itself. */
export const DEFAULT_GATE = String.raw`\bcabal\s+(?:v2-)?(?:build|test)\b|(?:^|[;&|(]\s*|\n\s*)(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:time|exec|nohup)\s+)?(?:\./)?scripts/check(?:-[a-z-]+)?\b`

/** The command's short name when it is a gate: `cabal test`, `check`, `check-forge`; null otherwise. */
export function gateName(command: string, pattern: RegExp): string | null {
  const m = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(command)
  if (!m) return null
  const cabal = /cabal\s+(?:v2-)?(build|test)\b/.exec(m[0])
  if (cabal) return `cabal ${cabal[1]}`
  const check = /scripts\/(check(?:-[a-z-]+)?)/.exec(m[0])
  if (check?.[1]) return check[1]
  return m[0].trim()
}

/** Where the command ran, when it starts by changing directory. */
export function commandDir(command: string): string {
  return /^\s*cd\s+(["']?)([^"'&;|]+?)\1\s*&&/.exec(command)?.[2]?.trim() ?? ''
}

/** The gate's output piped on with no pipefail: the shell's status is the pipe's last command's. */
export function isPiped(command: string, pattern: RegExp): boolean {
  // `2>&1` and `&>` are redirections, not the `&` or `&&` that end a command.
  const plain = command.replace(/\d*>&\d*|&>/g, '>')
  const m = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(plain)
  if (!m) return false
  const rest = plain.slice(m.index + m[0].length).split(/[;&\n]/)[0] ?? ''
  return /(?<!\|)\|(?!\|)/.test(rest) && !/pipefail|PIPESTATUS/.test(command)
}

/** Statuses the command echoed itself (`; echo $?`, `echo "exit=$?"`), in order. */
export function echoedStatuses(command: string, output: string): number[] {
  if (!/\$\?/.test(command)) return []
  const found: number[] = []
  for (const line of output.split('\n')) {
    const m = /^\s*(?:[\w .-]*?[=:]\s*)?(\d{1,3})\s*$/.exec(line)
    if (m?.[1]) found.push(Number(m[1]))
  }
  return found
}

/**
 * The run's real exit status: what it echoed, else the tool's own, and null
 * where a pipe makes the tool's status someone else's.
 */
export function exitStatus(command: string, output: string, isError: boolean, pattern: RegExp): number | null {
  if (isPiped(command, pattern)) return null
  const echoed = echoedStatuses(command, output)
  if (echoed.length > 0) return echoed.find(s => s !== 0) ?? 0
  if (!isError) return 0
  return Number(/Exit code (\d+)/.exec(output)?.[1] ?? 1)
}

/** Test totals summed over every tasty or unittest summary in the output. */
export function testCounts(output: string): { total: number; failed: number } | null {
  let counts: { total: number; failed: number } | null = null
  const add = (total: number, failed: number) => {
    counts = { total: (counts?.total ?? 0) + total, failed: (counts?.failed ?? 0) + failed }
  }
  for (const m of output.matchAll(/All (\d+) tests passed|(\d+) out of (\d+) tests failed/g)) {
    if (m[1]) add(Number(m[1]), 0)
    else add(Number(m[3]), Number(m[2]))
  }
  for (const m of output.matchAll(/Ran (\d+) tests? in [\d.]+s\s*\n\s*(OK\b|FAILED \(([^)]*)\))/g)) {
    const detail = m[3] ?? ''
    const failed = m[2]?.startsWith('OK')
      ? 0
      : Math.max(1, [...detail.matchAll(/(?:failures|errors)=(\d+)/g)].reduce((n, x) => n + Number(x[1]), 0))
    add(Number(m[1]), failed)
  }
  return counts
}

/** The command's own verdict line, when it prints one: scripts/check's stage summary or the profile runner's. */
export function summaryLine(output: string): string {
  const check = [...output.matchAll(/Requested checks complete: (ExitSuccess|ExitFailure \d+)/g)].pop()
  if (check?.[1]) return check[1]
  const profile = [...output.matchAll(/Selected checks passed: (True|False); application profile: (\w+)/g)].pop()
  if (profile?.[2]) return `profile ${profile[2]}${profile[1] === 'False' ? ', selected failed' : ''}`
  return ''
}

export function gate(name: string, command: string, output: string, isError: boolean, sha: string, at: number, pattern: RegExp): Gate {
  const counts = testCounts(output)
  const dir = commandDir(command)
  return {
    name,
    exit: exitStatus(command, output, isError, pattern),
    total: counts?.total ?? null,
    failed: counts?.failed ?? null,
    summary: summaryLine(output),
    werror: /-Werror\b/.test(command),
    sha,
    where: dir ? (dir.replace(/\/+$/, '').split('/').pop() ?? '') : '',
    at,
  }
}

export type Verdict = 'pass' | 'fail' | 'unknown'

export function verdict(g: Gate): Verdict {
  if (g.exit === null) return 'unknown'
  if (g.exit !== 0 || (g.failed ?? 0) > 0) return 'fail'
  if (/ExitFailure|selected failed/.test(g.summary)) return 'fail'
  return 'pass'
}

/** The gate as the band words it, without its mark. */
export function gateText(g: Gate): string {
  const counts = g.total === null ? '' : g.failed ? `${g.failed}/${g.total} failed` : `${g.total}/${g.total}`
  let what: string
  if (g.name === 'cabal test') what = counts ? `tests ${counts}` : 'tests'
  else if (g.name === 'cabal build') what = g.werror ? 'build -Werror' : 'build'
  else what = [g.name, g.summary, counts].filter(Boolean).join(' ')
  const exit = g.exit === null ? ' (piped, exit unverified)' : g.exit !== 0 ? ` exit ${g.exit}` : ''
  return what + exit
}

// ── The forge ───────────────────────────────────────────────────────────────

/** Issue or PR numbers from an `fgj … list` table, one `#N` per row. */
export function listedNumbers(stdout: string): number[] {
  return [...stdout.matchAll(/^#(\d+)\s/gm)].map(m => Number(m[1]))
}

/** Whether a command changed what the queue lists (labels, closes, merges). */
export function touchesQueue(command: string): boolean {
  return /\b(?:afj|fgj)\b[^\n]*\b(?:issue\s+(?:edit|close|reopen)|pr\s+(?:merge|close|create))\b/.test(command)
}

export function queueText(nums: number[], max = 3): string {
  const shown = nums.slice(0, max).map(n => `#${n}`)
  return nums.length > max ? `${shown.join(' ')} +${nums.length - max}` : shown.join(' ')
}

/** Host, owner and repo of a git remote URL (ssh, scp-like or https), or null. */
export function parseRemote(url: string): { host: string; owner: string; repo: string } | null {
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
  return { host, owner, repo }
}

// ── The maps ────────────────────────────────────────────────────────────────

/** Priorities per choice, undecided rows and overrides of the proposal, from a worksheet JSON. */
export function sheetSummary(json: string, label: string): Sheet | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { choices?: unknown; rows?: unknown }
  const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : []
  const choices = Array.isArray(d.choices) ? (d.choices as unknown[]).filter((c): c is string => typeof c === 'string') : []
  if (rows.length === 0) return null
  const tally = new Map<string, number>(choices.map(c => [c, 0]))
  let open = 0
  let overrides = 0
  for (const r of rows) {
    const p = typeof r.priority === 'string' ? r.priority : ''
    if (!p) {
      open++
      continue
    }
    tally.set(p, (tally.get(p) ?? 0) + 1)
    const proposed = r.proposed && typeof r.proposed === 'object' ? (r.proposed as { priority?: unknown }).priority : undefined
    if (typeof proposed === 'string' && proposed && proposed !== p) overrides++
  }
  return { label, counts: [...tally].map(([choice, n]) => ({ choice, n })), open, overrides }
}

/** The specification paths and area count of a catalogue JSON. */
export function catalogueSpecs(json: string): { paths: string[]; areas: number } | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { specifications?: unknown; areas?: unknown }
  const specs = Array.isArray(d.specifications) ? (d.specifications as Record<string, unknown>[]) : []
  const paths = specs.map(s => (typeof s.path === 'string' ? s.path : '')).filter(Boolean)
  const areas = d.areas && typeof d.areas === 'object' ? Object.keys(d.areas as object).length : 0
  return { paths, areas }
}

/** Specifications tallied by their frontmatter status, most common first. */
export function specsSummary(paths: string[], areas: number, statuses: Record<string, string>, label: string): Specs {
  const tally = new Map<string, number>()
  for (const p of paths) {
    const s = statuses[p] || 'unknown'
    tally.set(s, (tally.get(s) ?? 0) + 1)
  }
  const ranked = [...tally]
    .map(([status, n]) => ({ status, n }))
    .sort((a, b) => b.n - a.n || a.status.localeCompare(b.status))
  return { label, total: paths.length, statuses: ranked, areas }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export function age(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}
