/** Pure decisions behind the pane: reading a worksheet, filtering it, applying edits, summarising them. */

import type { Change, Filter, Priority, Row, Section, SheetState, Suite, Worksheet } from '../types'

const MAX_COMMENT = 4_000
const MAX_REASON = 1_000

export const NO_FILTER: Filter = { text: '', membership: '', category: '', priority: '', proposed: '' }

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
    })
  }
  return { sheet: { title: str(o.title, 200) || 'Worksheet', choices, render: str(o.render, 400), sections, rows } }
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
    if (text) {
      const hay = [r.id, r.title, r.role, r.comment, r.proposed.reason, ...r.references.map(x => x.id)].join(' ').toLowerCase()
      if (!hay.includes(text)) return false
    }
    return true
  })
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
