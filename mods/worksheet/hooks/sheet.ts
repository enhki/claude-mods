/** Pure decisions behind the pane: reading a worksheet, filtering it, applying edits, summarising them. */

import type { Change, Filter, Mark, Priority, Progress, Row, Section, SheetState, Suite, Worksheet } from '../types'

const MAX_COMMENT = 4_000
const MAX_REASON = 1_000
const MAX_EVIDENCE = 300

export const NO_FILTER: Filter = { text: '', membership: '', category: '', priority: '', proposed: '', progress: '' }

export const EMPTY: SheetState = {
  paths: [],
  path: '',
  sheet: null,
  error: '',
  open: null,
  collapsed: [],
  filter: NO_FILTER,
  pending: [],
  log: [],
  notify: false,
  saving: false,
  sent: 0,
  rev: 0,
}

export const MEMBERSHIPS = ['required', 'note', 'future', 'additional'] as const
export const UNSET = 'unset'

function str(raw: unknown, max = 10_000): string {
  return typeof raw === 'string' ? raw.slice(0, max) : ''
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

function suite(raw: unknown): Suite {
  const s = (raw ?? {}) as Record<string, unknown>
  const m = s.membership
  const membership = m === 'required' || m === 'note' || m === 'future' || m === 'additional' ? m : ''
  return { membership, categories: strings(s.categories), levels: strings(s.levels), flags: strings(s.flags) }
}

/** The worksheet's progress declaration; null when absent or naming no roles. */
function progressDecl(raw: unknown): Progress | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const roles = [...new Set(strings(p.roles).map(r => r.slice(0, 40)).filter(Boolean))]
  if (roles.length === 0) return null
  return { roles, states: [...new Set(strings(p.states).map(x => x.slice(0, 40)).filter(Boolean))] }
}

/** A row's marks for the declared roles. A state is kept as written, declared or not, so the pane
 *  can flag a misspelt one; a role with no state is left out and reads as unknown. */
function marks(raw: unknown, decl: Progress | null): Record<string, Mark> {
  if (!decl || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: Record<string, Mark> = {}
  for (const role of decl.roles) {
    const m = (o[role] ?? {}) as Record<string, unknown>
    const state = str(m.state, 40).trim()
    if (state) out[role] = { state, evidence: str(m.evidence, MAX_EVIDENCE).trim() }
  }
  return out
}

/** A worksheet from its file's text, or why it is refused. The file may hold more; only this is kept. */
export function parseWorksheet(text: string): { sheet: Worksheet } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { error: `not JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const o = (raw ?? {}) as Record<string, unknown>
  if (o.schema !== 1) return { error: `schema ${JSON.stringify(o.schema)} is not 1` }
  const choices = strings(o.choices).map(c => c.toLowerCase())
  if (choices.length === 0) return { error: 'choices is empty' }
  if (!Array.isArray(o.sections) || !Array.isArray(o.rows)) return { error: 'sections and rows must be lists' }
  const sections: Section[] = []
  for (const raw of o.sections) {
    const s = (raw ?? {}) as Record<string, unknown>
    const id = str(s.id, 100)
    if (!id) return { error: 'a section has no id' }
    sections.push({ id, title: str(s.title, 200) || id, kind: s.kind === 'product' ? 'product' : 'capabilities' })
  }
  const progress = progressDecl(o.progress)
  const rows: Row[] = []
  const seen = new Set<string>()
  for (const raw of o.rows) {
    const r = (raw ?? {}) as Record<string, unknown>
    const id = str(r.id, 100)
    if (!id) return { error: 'a row has no id' }
    if (seen.has(id)) return { error: `row id ${id} repeats` }
    seen.add(id)
    const refs = Array.isArray(r.references) ? r.references : []
    const proposed = (r.proposed ?? {}) as Record<string, unknown>
    const priority = str(r.priority, 40).toLowerCase()
    rows.push({
      id,
      section: str(r.section, 100),
      title: str(r.title, 400),
      references: refs.map(x => {
        const ref = (x ?? {}) as Record<string, unknown>
        return { id: str(ref.id, 100), url: str(ref.url, 2048), version: str(ref.version, 40), status: str(ref.status, 40) }
      }),
      role: str(r.role, 1000),
      suite: suite(r.suite),
      priority: choices.includes(priority) ? priority : '',
      comment: str(r.comment, MAX_COMMENT),
      proposed: { priority: str(proposed.priority, 40).toLowerCase(), reason: str(proposed.reason, MAX_REASON) },
      progress: marks(r.progress, progress),
    })
  }
  return { sheet: { title: str(o.title, 200) || 'Worksheet', choices, render: str(o.render, 400), sections, rows, progress } }
}

/** Saved state from an older version, or a half-written one, made whole. */
export function whole(s: Partial<SheetState> | undefined): SheetState {
  const x = { ...EMPTY, ...s }
  return {
    ...x,
    paths: strings(x.paths),
    collapsed: strings(x.collapsed),
    filter: { ...NO_FILTER, ...(x.filter ?? {}) },
    pending: Array.isArray(x.pending) ? x.pending : [],
    log: Array.isArray(x.log) ? x.log : [],
    open: typeof x.open === 'string' ? x.open : null,
    // A sheet kept by a version before progress marks has neither field; it reads as declaring none.
    sheet: x.sheet ? { ...x.sheet, progress: x.sheet.progress ?? null, rows: x.sheet.rows.map(r => ({ ...r, progress: r.progress ?? {} })) } : null,
  }
}

export function rowById(sheet: Worksheet, id: string): Row | undefined {
  return sheet.rows.find(r => r.id === id)
}

/** The rows the filter keeps, in worksheet order. */
export function filterRows(sheet: Worksheet, f: Filter): Row[] {
  const text = f.text.trim().toLowerCase()
  return sheet.rows.filter(r => {
    if (f.membership && (r.suite.membership || 'none') !== f.membership) return false
    if (f.category && !r.suite.categories.includes(f.category)) return false
    if (f.priority === UNSET ? r.priority !== '' : f.priority && r.priority !== f.priority) return false
    if (f.proposed === 'any' && !r.proposed.priority) return false
    if (f.proposed === 'differs' && (!r.proposed.priority || r.proposed.priority === r.priority)) return false
    if (f.progress && !progressMatches(r, f.progress)) return false
    if (text) {
      const evidence = Object.values(r.progress).map(m => m.evidence)
      const hay = [r.id, r.title, r.role, r.comment, r.proposed.reason, ...r.references.map(x => x.id), ...evidence].join(' ').toLowerCase()
      if (!hay.includes(text)) return false
    }
    return true
  })
}

/** A progress filter, `role=state`, `role!=state` or `role=` (unknown), taken apart; null if malformed. */
export function parseProgressFilter(f: string): { role: string; state: string; not: boolean } | null {
  const at = f.indexOf('=')
  if (at <= 0) return null
  const not = f[at - 1] === '!'
  const role = f.slice(0, not ? at - 1 : at)
  return role ? { role, state: f.slice(at + 1), not } : null
}

export function progressFilter(role: string, state: string, not = false): string {
  return `${role}${not ? '!=' : '='}${state}`
}

function progressMatches(r: Row, f: string): boolean {
  const p = parseProgressFilter(f)
  if (!p) return true
  const state = r.progress[p.role]?.state ?? ''
  return p.not ? state !== p.state : state === p.state
}

/** How many rows are in each state, per role; '' counts the unknown. */
export function progressCounts(sheet: Worksheet): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const role of sheet.progress?.roles ?? []) {
    const tally: Record<string, number> = {}
    for (const r of sheet.rows) {
      const state = r.progress[role]?.state ?? ''
      tally[state] = (tally[state] ?? 0) + 1
    }
    out[role] = tally
  }
  return out
}

/** The rows whose marks name a state the worksheet does not declare, as `row role "state"`. */
export function undeclaredMarks(sheet: Worksheet): string[] {
  const decl = sheet.progress
  if (!decl) return []
  return sheet.rows.flatMap(r => decl.roles.flatMap(role => {
    const m = r.progress[role]
    return m && !decl.states.includes(m.state) ? [`${r.id} ${role} "${m.state}"`] : []
  }))
}

export type Counts = { byPriority: Record<string, number>; unset: number; proposals: number; differs: number }

export function counts(sheet: Worksheet): Counts {
  const byPriority: Record<string, number> = Object.fromEntries(sheet.choices.map(c => [c, 0]))
  let unset = 0
  let proposals = 0
  let differs = 0
  for (const r of sheet.rows) {
    if (r.priority) byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1
    else unset += 1
    if (r.proposed.priority) {
      proposals += 1
      if (r.proposed.priority !== r.priority) differs += 1
    }
  }
  return { byPriority, unset, proposals, differs }
}

/** The state after an edit: the sheet changed optimistically and the change queued for the file. Same value, no change. */
export function edit(s: SheetState, id: string, field: Change['field'], to: string): SheetState {
  if (!s.sheet) return s
  const row = rowById(s.sheet, id)
  if (!row) return s
  const value = field === 'comment' ? to.slice(0, MAX_COMMENT) : to
  const from = field === 'priority' ? row.priority : row.comment
  if (from === value) return s
  const rows = s.sheet.rows.map(r => (r.id === id ? { ...r, [field]: value } : r))
  // One pending change per row and field: a later edit replaces the earlier, keeping the original `from`.
  const earlier = s.pending.find(c => c.id === id && c.field === field)
  const change: Change = { id, field, from: earlier ? earlier.from : from, to: value }
  const pending = [...s.pending.filter(c => !(c.id === id && c.field === field)), change]
  return { ...s, sheet: { ...s.sheet, rows }, pending }
}

/** Applies changes to a worksheet file's parsed JSON, in place; unknown rows are reported. */
export function patchFile(data: unknown, changes: readonly Change[]): string[] {
  const rows = ((data ?? {}) as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return changes.map(c => c.id)
  const missing: string[] = []
  for (const c of changes) {
    const row = rows.find(r => (r as { id?: unknown })?.id === c.id) as Record<string, unknown> | undefined
    if (!row) {
      missing.push(c.id)
      continue
    }
    row[c.field] = c.to
  }
  return missing
}

export type Proposal = { id: string; priority: string; reason: string }

/** Applies Claude's proposals to a worksheet file's parsed JSON; rows it cannot find come back. */
export function applyProposals(data: unknown, proposals: readonly Proposal[], choices: readonly string[]): { applied: number; missing: string[]; refused: string[] } {
  const rows = ((data ?? {}) as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return { applied: 0, missing: proposals.map(p => p.id), refused: [] }
  const missing: string[] = []
  const refused: string[] = []
  let applied = 0
  for (const p of proposals) {
    const priority = p.priority.trim().toLowerCase()
    if (priority && !choices.includes(priority)) {
      refused.push(`${p.id}: ${p.priority}`)
      continue
    }
    const row = rows.find(r => (r as { id?: unknown })?.id === p.id) as Record<string, unknown> | undefined
    if (!row) {
      missing.push(p.id)
      continue
    }
    row.proposed = { priority, reason: p.reason.trim().slice(0, MAX_REASON) }
    applied += 1
  }
  return { applied, missing, refused }
}

/** The message Claude receives: one line per changed row, its proposal beside it. */
/** The pending changes still unsaved after a batch was written: matched by content, since state
 *  round-trips through JSON and object identity does not survive it. A newer edit of the same row
 *  and field, made while the batch was being written, stays pending. */
export function remaining(pending: readonly Change[], batch: readonly Change[]): Change[] {
  return pending.filter(c => !batch.some(b => b.id === c.id && b.field === c.field && b.to === c.to))
}

/** The log with a batch recorded: one entry per row and field, keeping the earliest `from` and the
 *  latest `to`, so a comment saved twice reaches Claude once, in its final form. */
export function recorded(log: readonly Change[], batch: readonly Change[]): Change[] {
  const out = [...log]
  for (const b of batch) {
    const i = out.findIndex(c => c.id === b.id && c.field === b.field)
    if (i === -1) out.push(b)
    else out[i] = { ...b, from: out[i].from }
  }
  return out
}

export function summary(sheet: Worksheet, path: string, log: readonly Change[]): string {
  const byRow = new Map<string, Change[]>()
  for (const c of log) byRow.set(c.id, [...(byRow.get(c.id) ?? []), c])
  const priorities = log.filter(c => c.field === 'priority').length
  const comments = log.filter(c => c.field === 'comment').length
  const head = `Worksheet changes for "${sheet.title}" (${path}): ${priorities} priorit${priorities === 1 ? 'y' : 'ies'}, ${comments} comment${comments === 1 ? '' : 's'}.`
  const lines = [...byRow.entries()].map(([id, changes]) => {
    const row = rowById(sheet, id)
    const parts = changes.map(c =>
      c.field === 'priority'
        ? `priority ${c.from || UNSET} → ${c.to || UNSET}${row?.proposed.priority ? ` (proposed ${row.proposed.priority})` : ''}`
        : `comment: ${JSON.stringify(c.to.replace(/\s+/g, ' ').trim())}`,
    )
    return `- ${id} ${row?.title ?? ''}: ${parts.join('; ')}`
  })
  return [head, ...lines].join('\n')
}

/** The worksheet paths a project config names: `{ "worksheets": [...] }`. */
export function parseConfig(json: string | null): string[] {
  if (!json) return []
  try {
    const list = (JSON.parse(json) as { worksheets?: unknown })?.worksheets
    return strings(list).map(p => p.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function isWorksheetName(name: string): boolean {
  return /-worksheet\.json$/.test(name)
}

export const GLYPH: Record<string, string> = { must: '●', needed: '◐', later: '○', no: '✕' }

export function glyph(priority: Priority): string {
  return GLYPH[priority] ?? '·'
}

/** The glyph for a progress state: the four agreed ones; another declared state shows its first
 *  letter, capitalised; a state the worksheet does not declare shows `?`; unknown (no mark) a blank. */
export const PROGRESS_GLYPH: Record<string, string> = { done: '✓', 'in-progress': '◐', 'not-started': '·', 'n/a': '–' }
export const UNDECLARED = '?'

export function progressGlyph(state: string, states: readonly string[]): string {
  if (!state) return ' '
  if (!states.includes(state)) return UNDECLARED
  return PROGRESS_GLYPH[state] ?? [...state][0]!.toUpperCase()
}

/** One glyph per declared role, in the declared order, for a row's line. */
export function progressMarks(sheet: Worksheet, r: Row): string {
  const decl = sheet.progress
  if (!decl) return ''
  return decl.roles.map(role => progressGlyph(r.progress[role]?.state ?? '', decl.states)).join('')
}

/** The legend: each declared state's glyph and name, then what blank and `?` mean. */
export function progressLegend(decl: Progress): string {
  return [...decl.states.map(st => `${progressGlyph(st, decl.states)} ${st}`), 'blank unknown', `${UNDECLARED} not a declared state`].join('  ')
}

export function label(choice: string): string {
  return choice ? choice[0]!.toUpperCase() + choice.slice(1) : ''
}

export function membershipLabel(s: Suite): string {
  if (s.membership === 'required') return s.categories.map((c, i) => `${c} ${s.levels[i] ?? s.levels[0] ?? ''}`.trim()).join(', ') + (s.flags.length ? ` [${s.flags.join('')}]` : '')
  if (s.membership === 'note') return 'suite note'
  if (s.membership === 'future') return 'suite future'
  if (s.membership === 'additional') return 'additional'
  return ''
}

export const TOOL_DESCRIPTION = [
  "Records your proposed priority and reason on rows of the person's JSON worksheet, shown beside their own decision in the",
  'Worksheet pane. Each proposal names a row id, a priority from the worksheet\'s choices (or empty to withdraw), and one',
  'line on why to include, defer or ignore it. The person decides in the pane; a proposal never changes their priority.',
  'Pass path to address a worksheet other than the one shown.',
].join(' ')
