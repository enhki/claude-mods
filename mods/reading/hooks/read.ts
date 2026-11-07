/** Pure decisions behind the pane: what a reading list holds, how a republish merges, what goes back. */

import type { Item, Mark, Reading, Source } from '../types'

export const MAX_ITEMS = 60
export const MAX_CONTENT = 60_000
const MAX_TEXT = 4_000

export const EMPTY: Reading = { title: '', intro: '', items: [], open: null, sent: 0, rev: 0 }
export const MARKS: readonly Mark[] = ['read', 'acknowledged', 'agreed', 'discuss']

function text(raw: unknown, max = MAX_TEXT): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

/** A short stable hash, so an inline note gets a key of its own. */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** `5-15` or `12` as an inclusive 1-based range; null when it is not one. */
export function parseLines(raw: unknown): [number, number] | null {
  const s = typeof raw === 'number' ? String(raw) : text(raw, 40)
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(s)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] === undefined ? a : Number(m[2])
  return a >= 1 && b >= a ? [a, b] : null
}

const REPO = /^[\w.-]+\/[\w.-]+$/

/** One item's source from the tool's fields, or why it is refused. */
export function parseSource(s: Record<string, unknown>): { source: Source } | { error: string } {
  const path = text(s.path, 400)
  const url = text(s.url, 2048)
  const body = text(s.text, MAX_CONTENT)
  const issue = typeof s.issue === 'number' && Number.isInteger(s.issue) && s.issue > 0 ? s.issue : null
  const given = Number(path !== '') + Number(url !== '') + Number(body !== '') + Number(issue !== null)
  if (given !== 1) return { error: 'give exactly one of path, issue, url or text' }
  if (path) {
    let lines: [number, number] | null = null
    if (s.lines !== undefined && s.lines !== null && s.lines !== '') {
      lines = parseLines(s.lines)
      if (!lines) return { error: `lines must look like 5-15, not ${JSON.stringify(s.lines)}` }
    }
    const heading = text(s.heading, 200)
    return { source: { kind: 'file', path, ...(lines ? { lines } : {}), ...(heading ? { heading } : {}) } }
  }
  if (issue !== null) {
    const repo = text(s.repo, 200).replace(/\.git$/, '')
    if (repo && !REPO.test(repo)) return { error: `repo must be owner/repo, not ${JSON.stringify(repo)}` }
    return { source: { kind: 'issue', repo, number: issue } }
  }
  if (url) {
    if (!/^https?:\/\//i.test(url)) return { error: 'url must start with http:// or https://' }
    return { source: { kind: 'url', url } }
  }
  return { source: { kind: 'text', text: body } }
}

/** What a republish merges on. */
export function keyOf(src: Source): string {
  switch (src.kind) {
    case 'file': {
      const range = src.lines ? `:${src.lines[0]}-${src.lines[1]}` : ''
      const head = src.heading ? `#${src.heading.toLowerCase()}` : ''
      return `file:${src.path}${range}${head}`
    }
    case 'issue':
      return `issue:${src.repo}#${src.number}`
    case 'url':
      return `url:${src.url}`
    case 'text':
      return `text:${hash(src.text)}`
  }
}

/** The source as the pane and the results name it. */
export function label(src: Source): string {
  switch (src.kind) {
    case 'file': {
      const range = src.lines ? `:${src.lines[0]}${src.lines[1] !== src.lines[0] ? `-${src.lines[1]}` : ''}` : ''
      return `${src.path}${range}${src.heading ? ` § ${src.heading}` : ''}`
    }
    case 'issue':
      return `${src.repo ? `${src.repo}#` : '#'}${src.number}`
    case 'url':
      return src.url
    case 'text':
      return 'note'
  }
}

/** A reading list from the tool's input, or why it is refused. */
export function parse(input: unknown): { reading: Reading; replace: boolean } | { error: string } {
  const o = (input ?? {}) as { title?: unknown; intro?: unknown; items?: unknown; replace?: unknown }
  const title = text(o.title, 120)
  if (!title) return { error: 'title is required' }
  if (!Array.isArray(o.items) || o.items.length === 0) return { error: 'items must be a non-empty list' }
  if (o.items.length > MAX_ITEMS) return { error: `${o.items.length} items; keep it to ${MAX_ITEMS} or split it` }
  const items: Item[] = []
  for (const [i, raw] of o.items.entries()) {
    const s = (raw ?? {}) as Record<string, unknown>
    const itemTitle = text(s.title, 160)
    if (!itemTitle) return { error: `item ${i + 1} has no title` }
    const parsed = parseSource(s)
    if ('error' in parsed) return { error: `item ${i + 1} ("${itemTitle}"): ${parsed.error}` }
    const key = keyOf(parsed.source)
    if (items.some(x => x.key === key)) return { error: `item ${i + 1} ("${itemTitle}") repeats ${label(parsed.source)}` }
    items.push({ key, title: itemTitle, why: text(s.why, 300), source: parsed.source, mark: 'unread', comment: '' })
  }
  return { reading: { ...EMPTY, title, intro: text(o.intro), items }, replace: o.replace === true }
}

/** Saved state from an older version, or a half-written one, made whole. */
export function whole(r: Partial<Reading> | undefined): Reading {
  const x = { ...EMPTY, ...r }
  const items = Array.isArray(x.items) ? x.items.filter(it => it && typeof it.key === 'string' && it.source) : []
  return {
    ...x,
    items: items.map(it => ({
      ...it,
      why: typeof it.why === 'string' ? it.why : '',
      mark: it.mark === 'read' || it.mark === 'acknowledged' || it.mark === 'agreed' || it.mark === 'discuss' ? it.mark : 'unread',
      comment: typeof it.comment === 'string' ? it.comment : '',
    })),
    open: typeof x.open === 'string' ? x.open : null,
  }
}

/** A republish merges by source: kept items keep their mark, comment and content; new ones join at the end. */
export function merge(prev: Reading, next: Reading, replace: boolean): Reading {
  const rev = prev.rev + 1
  if (replace || prev.items.length === 0) return { ...next, open: null, sent: 0, rev }
  const incoming = new Map(next.items.map(it => [it.key, it] as const))
  const kept = prev.items.map(old => {
    const fresh = incoming.get(old.key)
    if (!fresh) return old
    incoming.delete(old.key)
    return { ...fresh, mark: old.mark, comment: old.comment, ...(old.content !== undefined ? { content: old.content } : {}) }
  })
  return { ...prev, title: next.title, intro: next.intro, items: [...kept, ...incoming.values()], open: null, rev }
}

function edit(r: Reading, key: string, fn: (it: Item) => Item): Reading {
  return { ...r, items: r.items.map(it => (it.key === key ? fn(it) : it)) }
}

/** Marks an item; marking it the same way again takes the mark back. */
export function mark(r: Reading, key: string, m: Mark): Reading {
  return edit(r, key, it => ({ ...it, mark: it.mark === m ? 'unread' : m }))
}

export function comment(r: Reading, key: string, value: string): Reading {
  return edit(r, key, it => ({ ...it, comment: value.slice(0, MAX_TEXT) }))
}

/** Opens an item, or closes it again when it is the one open. */
export function toggle(r: Reading, key: string): Reading {
  if (!r.items.some(it => it.key === key)) return r
  return { ...r, open: r.open === key ? null : key }
}

/** Marks an item as loading, with any earlier error cleared. */
export function setLoading(r: Reading, key: string): Reading {
  return edit(r, key, it => {
    const { error: _e, loading: _l, ...rest } = it
    return { ...rest, loading: true }
  })
}

/** Records what loading an item's content came to; the item is no longer loading. */
export function setContent(r: Reading, key: string, loaded: { content?: string; error?: string }): Reading {
  return edit(r, key, it => {
    const { content: _c, error: _e, loading: _l, ...rest } = it
    return { ...rest, ...(loaded.content !== undefined ? { content: loaded.content } : {}), ...(loaded.error ? { error: loaded.error } : {}) }
  })
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** The part of a file an item names: its line range, or its heading's section, else all of it. */
export function slice(content: string, src: Source): string {
  if (src.kind !== 'file') return content
  const lines = content.split('\n')
  if (src.lines) return lines.slice(src.lines[0] - 1, src.lines[1]).join('\n')
  if (src.heading) {
    const want = src.heading.trim().toLowerCase()
    const titles = lines.map(l => HEADING.exec(l)?.[2]?.trim().toLowerCase() ?? null)
    let start = titles.findIndex(t => t === want)
    if (start === -1) start = titles.findIndex(t => t !== null && t.includes(want))
    if (start === -1) return content
    const level = (HEADING.exec(lines[start] ?? '')?.[1] ?? '#').length
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      const m = /^(#{1,6})\s/.exec(lines[i] ?? '')
      if (m && (m[1] ?? '').length <= level) {
        end = i
        break
      }
    }
    return lines.slice(start, end).join('\n')
  }
  return content
}

export type Tally = Record<Mark, number>

export function tally(r: Reading): Tally {
  const t: Tally = { unread: 0, read: 0, acknowledged: 0, agreed: 0, discuss: 0 }
  for (const it of r.items) t[it.mark] += 1
  return t
}

const WORD: Record<Mark, string> = { unread: 'UNREAD', read: 'READ', acknowledged: 'ACKNOWLEDGED', agreed: 'AGREED', discuss: 'DISCUSS' }
export const GLYPH: Record<Mark, string> = { unread: '·', read: '○', acknowledged: '✓', agreed: '★', discuss: '?' }

export function summary(t: Tally): string {
  const parts = [`${t.agreed} agreed`, `${t.acknowledged} acknowledged`, `${t.read} read`]
  if (t.discuss) parts.push(`${t.discuss} to discuss`)
  if (t.unread) parts.push(`${t.unread} unread`)
  return parts.join(', ')
}

/** The message the results go back as: one line per item, its comment beside it. */
export function results(r: Reading): string {
  const lines = r.items.map((it, i) => {
    const c = it.comment.replace(/\s+/g, ' ').trim()
    return `${i + 1}. ${WORD[it.mark]}: ${it.title} [${label(it.source)}]${c ? ` (comment: ${c})` : ''}`
  })
  return [`Reading results for "${r.title}": ${summary(tally(r))}.`, ...lines].join('\n')
}

export type Remote = { host: string; repo: string }

/** The host and owner/repo of a git remote URL: scp-like ssh, ssh://, http or https. */
export function parseRemote(url: string): Remote | null {
  const m = /^(?:(?:ssh|git|https?):\/\/)?(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  const host = m[1] ?? ''
  const repo = m[2] ?? ''
  return host && REPO.test(repo) ? { host, repo } : null
}

/** The command that prints an issue: the template with {number} and {repo} filled, else fgj against the remote's host. */
export function issueArgv(template: string, remote: Remote | null, repo: string, number: number): string[] | null {
  const target = repo || remote?.repo || ''
  if (!target) return null
  const t = template.trim()
  if (t) return t.split(/\s+/).map(a => a.replaceAll('{number}', String(number)).replaceAll('{repo}', target))
  return remote ? ['fgj', '--hostname', remote.host, 'issue', 'view', String(number), '-R', target] : null
}

export const TOOL_DESCRIPTION = [
  "Publishes a reading list to the person's Reading pane: documents, sections of them, issues or notes you want them",
  'to read, each with one line on why. They read each item in the pane, mark it read, acknowledged, agreed or to discuss,',
  'add a comment, and send the results back to you as one message. Use it instead of pasting long material into chat.',
  'An item names exactly one source: a file path (with optional lines like "5-15" or a heading), an issue number',
  '(with owner/repo when it is not the session repository), a URL, or inline text. Publishing again merges by source',
  'and keeps their marks and comments; set replace to start a new list.',
].join(' ')
