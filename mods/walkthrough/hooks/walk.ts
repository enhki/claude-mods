/** Pure decisions behind the pane: what a walkthrough may hold, where it stands, what goes back. */

import type { Mark, Step, Walkthrough } from '../types'

export const MAX_STEPS = 40
const MAX_TEXT = 2_000

export const EMPTY: Walkthrough = { title: '', intro: '', steps: [], marks: [], notes: [], open: null, sent: 0 }

function text(raw: unknown, max = MAX_TEXT): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

/** A walkthrough from the tool's input, or why it is refused. */
export function parse(input: unknown): { walkthrough: Walkthrough } | { error: string } {
  const o = (input ?? {}) as { title?: unknown; intro?: unknown; steps?: unknown }
  const title = text(o.title, 120)
  if (!title) return { error: 'title is required' }
  if (!Array.isArray(o.steps) || o.steps.length === 0) return { error: 'steps must be a non-empty list' }
  if (o.steps.length > MAX_STEPS) return { error: `${o.steps.length} steps; keep it to ${MAX_STEPS} or split it` }
  const steps: Step[] = []
  for (const [i, raw] of o.steps.entries()) {
    const s = (raw ?? {}) as Record<string, unknown>
    const step = { title: text(s.title, 160), run: text(s.run), where: text(s.where, 300), expect: text(s.expect) }
    if (!step.title) return { error: `step ${i + 1} has no title` }
    if (!step.expect) return { error: `step ${i + 1} ("${step.title}") says nothing about what to expect` }
    steps.push(step)
  }
  return {
    walkthrough: {
      ...EMPTY,
      title,
      intro: text(o.intro),
      steps,
      marks: steps.map((): Mark => 'pending'),
      notes: steps.map(() => ''),
    },
  }
}

/** Saved state from an older version, or a half-written one, made whole. */
export function whole(w: Partial<Walkthrough> | undefined): Walkthrough {
  const x = { ...EMPTY, ...w }
  const steps = Array.isArray(x.steps) ? x.steps : []
  return {
    ...x,
    steps,
    marks: steps.map((_, i) => x.marks?.[i] ?? 'pending'),
    notes: steps.map((_, i) => x.notes?.[i] ?? ''),
  }
}

/** The step drawn open: the one the person picked, else the first not yet marked. */
export function openStep(w: Walkthrough): number | null {
  if (w.open === -1) return null
  if (w.open !== null && w.open >= 0 && w.open < w.steps.length) return w.open
  const i = w.marks.indexOf('pending')
  return i === -1 ? null : i
}

/** Marks a step; marking it again the same way takes the mark back. The open step moves on. */
export function mark(w: Walkthrough, i: number, m: Mark): Walkthrough {
  if (i < 0 || i >= w.steps.length) return w
  const marks = w.marks.map((cur, j) => (j === i ? (cur === m ? 'pending' : m) : cur))
  return { ...w, marks, open: null }
}

export function note(w: Walkthrough, i: number, value: string): Walkthrough {
  if (i < 0 || i >= w.steps.length) return w
  return { ...w, notes: w.notes.map((cur, j) => (j === i ? value.slice(0, MAX_TEXT) : cur)) }
}

/** Opens a step, or closes it again when it is the one open. */
export function toggle(w: Walkthrough, i: number): Walkthrough {
  if (i < 0 || i >= w.steps.length) return w
  return { ...w, open: openStep(w) === i ? -1 : i }
}

export type Tally = Record<Mark, number>

export function tally(w: Walkthrough): Tally {
  const t: Tally = { pending: 0, pass: 0, fail: 0, skip: 0 }
  for (const m of w.marks) t[m] += 1
  return t
}

const WORD: Record<Mark, string> = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', pending: 'NOT DONE' }
export const GLYPH: Record<Mark, string> = { pass: '✓', fail: '✗', skip: '–', pending: '·' }

export function summary(t: Tally): string {
  const parts = [`${t.pass} passed`, `${t.fail} failed`]
  if (t.skip) parts.push(`${t.skip} skipped`)
  if (t.pending) parts.push(`${t.pending} not done`)
  return parts.join(', ')
}

/** The message the results go back as: one line per step, notes beside their step. */
export function results(w: Walkthrough): string {
  const lines = w.steps.map((s, i) => {
    const n = (w.notes[i] ?? '').replace(/\s+/g, ' ').trim()
    return `${i + 1}. ${WORD[w.marks[i] ?? 'pending']}: ${s.title}${n ? ` (note: ${n})` : ''}`
  })
  return [`Walkthrough results for "${w.title}": ${summary(tally(w))}.`, ...lines].join('\n')
}

export const TOOL_DESCRIPTION = [
  "Publishes a manual test checklist to the person's Walkthrough pane. They mark each step pass, fail or skip,",
  'add a note, and send the results back to you as one message.',
  'Use it whenever you ask the person to check something by hand, instead of listing the steps in chat.',
  'One step per thing to check. Each step says the exact command to run (run), where to run it (where: the directory,',
  'worktree, terminal, window size), and what the person should see when it works (expect), concretely enough for',
  'someone who did not follow the conversation. Publishing replaces the walkthrough shown before.',
].join(' ')
