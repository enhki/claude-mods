import type { Issue, Milestone, StateFilter, Ui } from '../types'

export type Query = {
  /** Fuzzy terms; each must match (fzf's extended-mode AND). */
  terms: string[]
  labels: string[]
  notLabels: string[]
  milestones: string[]
  state: StateFilter | null
}

/**
 * Reads the search box: bare words are fuzzy terms; `label:x`, `-label:x`,
 * `milestone:x` and `is:open|closed|all` filter. Values may be quoted
 * (`milestone:"Theming System"`). `l:` and `m:` are short forms.
 */
export function parseQuery(text: string): Query {
  const q: Query = { terms: [], labels: [], notLabels: [], milestones: [], state: null }
  const re = /(-?)([a-z]+):("[^"]*"?|\S*)|"([^"]*)"?|(\S+)/gi
  for (const m of text.matchAll(re)) {
    const [, neg, key, raw, quoted, word] = m
    if (key !== undefined) {
      const value = (raw ?? '').replace(/^"|"$/g, '').toLowerCase()
      const k = key.toLowerCase()
      if (!value) continue
      if (k === 'label' || k === 'l') (neg ? q.notLabels : q.labels).push(value)
      else if (k === 'milestone' || k === 'm') q.milestones.push(value)
      else if (k === 'is' && (value === 'open' || value === 'closed' || value === 'all')) q.state = value
      else q.terms.push(`${neg}${key}:${value}`.toLowerCase())
    } else {
      const t = (quoted ?? word ?? '').toLowerCase()
      if (t) q.terms.push(t)
    }
  }
  return q
}

export type Match = { score: number; positions: number[] }

const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/**
 * fzf-style fuzzy match: `pattern`'s characters in order, not necessarily
 * adjacent. Finds the shortest window holding them (forward, then backward
 * from where the forward scan ended) and scores it: points per character,
 * more at word starts and in runs, less for gaps. Case-insensitive.
 */
export function fuzzy(text: string, pattern: string): Match | null {
  if (!pattern) return { score: 0, positions: [] }
  const t = text.toLowerCase()
  const p = pattern.toLowerCase()
  let pi = 0
  let end = -1
  for (let i = 0; i < t.length; i++) {
    if (t[i] === p[pi] && ++pi === p.length) {
      end = i
      break
    }
  }
  if (end < 0) return null
  let start = end
  for (let i = end, back = p.length - 1; i >= 0; i--) {
    if (t[i] === p[back]) {
      start = i
      if (--back < 0) break
    }
  }
  const positions: number[] = []
  let score = 0
  let prev = -2
  for (let i = start, k = 0; i <= end && k < p.length; i++) {
    if (t[i] !== p[k]) continue
    let s = 16
    if (!isWord(text[i - 1])) s += 10
    else if (text[i] !== t[i] && text[i - 1] === t[i - 1]) s += 8
    // A run is worth as much as a word start (fzf's rule); a gap costs more
    // the longer it is, so a tight match beats letters scattered at word starts.
    if (i === prev + 1) s += 10
    else if (prev >= 0) s -= Math.min(12, 3 + (i - prev - 2))
    score += s
    positions.push(i)
    prev = i
    k++
  }
  return { score: score - start * 0.1, positions }
}

function labelHit(names: string[], want: string): boolean {
  return names.some(n => {
    const name = n.toLowerCase()
    if (want.endsWith('/')) return name.startsWith(want)
    return name === want || name.endsWith(`/${want}`) || name.startsWith(`${want}/`)
  })
}

export type Row = { issue: Issue; positions: number[] }

/** The issues the box and the chips let through, best fuzzy match first, else most recently updated. */
export function filterIssues(issues: Issue[], ui: Pick<Ui, 'query' | 'chips' | 'milestone' | 'state'>): Row[] {
  const q = parseQuery(ui.query)
  const state = q.state ?? ui.state
  const rows: (Row & { score: number })[] = []
  for (const issue of issues) {
    if (state !== 'all' && issue.state !== state) continue
    const names = issue.labels.map(l => l.name)
    if (!ui.chips.every(c => names.includes(c))) continue
    if (!q.labels.every(l => labelHit(names, l))) continue
    if (q.notLabels.some(l => labelHit(names, l))) continue
    if (ui.milestone === '-' ? issue.milestone !== null : ui.milestone && issue.milestone !== ui.milestone) continue
    const ms = (issue.milestone ?? '').toLowerCase()
    if (!q.milestones.every(m => (m === 'none' ? !issue.milestone : ms.includes(m)))) continue

    const haystack = `#${issue.number} ${issue.title}`
    let score = 0
    const positions = new Set<number>()
    let ok = true
    for (const term of q.terms) {
      const m = fuzzy(haystack, term)
      if (!m) {
        ok = false
        break
      }
      score += m.score
      m.positions.forEach(p => positions.add(p))
    }
    if (!ok) continue
    // Positions are reported against the title alone.
    const offset = haystack.length - issue.title.length
    rows.push({
      issue,
      score,
      positions: [...positions].filter(p => p >= offset).map(p => p - offset).sort((a, b) => a - b),
    })
  }
  const byDate = (a: Row, b: Row) => b.issue.updatedAt.localeCompare(a.issue.updatedAt)
  rows.sort((a, b) => (q.terms.length && b.score !== a.score ? b.score - a.score : byDate(a, b)))
  return rows.map(({ issue, positions }) => ({ issue, positions }))
}

/** Rows under their milestones, in the repo's milestone order, those without one last. */
export function groupRows(rows: Row[], milestones: Milestone[]): { title: string; rows: Row[] }[] {
  const order = new Map(milestones.map((m, i) => [m.title, i]))
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = r.issue.milestone ?? ''
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b)))
    .map(([title, rows]) => ({ title: title || 'No milestone', rows }))
}
