import type { Elements } from 'claude-code'

import type { Data, Detail, Issue, NewIssue, Ui } from '../types'
import { ago, linkifyRefs, scopeOf } from './forge'
import type { CardProps } from './card'
import type { PillProps } from './pill'
import { filterIssues, groupRows } from './search'
import type { TriageRules } from './triage'
import type { EditorProps } from './editor'
import type { Format } from '../types'

/** The elements both drawing surfaces with a pane share. */
export type El = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Link' | 'Markdown' | 'Client'>

/** What the native controls (Input, Select) call; every pressable control is a pill posting its id. */
export type ListActions = {
  query: (text: string) => void
  openFirst: () => void
  milestone: (value: string) => void
}

/** What the detail view's composer calls. */
export type DetailActions = { milestone: (title: string) => void }

/** What the new-issue form's native controls call. */
export type NewIssueActions = { milestone: (title: string) => void }

/** A pressable control: a Client posting `{ press: id }` (see pill.tsx for why not a Button). */
function pill(el: El, props: PillProps) {
  const { Client } = el
  return <Client key={`p-${props.id}`} module="./pill.tsx" props={props} />
}

const SEARCH_HINT = 'Search · label: · milestone: · is:'

export function repoUrl(data: Data): string {
  return data.repo ? `${data.repo.webBase}/${data.repo.owner}/${data.repo.repo}` : ''
}

function header(el: El, data: Data, ui: Ui, shown: number) {
  const { Box, Text, Link } = el
  const total = data.issues.filter(i => ui.state === 'all' || i.state === ui.state).length
  return (
    <Box key="head" flexDirection="row" justifyContent="space-between" flexWrap="wrap" alignItems="center">
      <Box flexDirection="row">
        {data.repo ? <Link href={repoUrl(data)} label={`${data.repo.owner}/${data.repo.repo}`} /> : <Text bold>Issues</Text>}
        <Text dimColor>
          {data.status === 'ready' ? ` · ${shown === total ? total : `${shown} of ${total}`} ${ui.state === 'all' ? '' : ui.state}` : ''}
        </Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {(['open', 'closed', 'all'] as const).map(st =>
          pill(el, { id: `state:${st}`, kind: 'button', label: st[0]!.toUpperCase() + st.slice(1), active: ui.state === st, border: data.border }),
        )}
        {pill(el, { id: 'grouped', kind: 'button', label: 'Grouped', active: ui.grouped, border: data.border })}
        {pill(el, { id: 'refresh', kind: 'button', label: data.status === 'loading' ? 'Loading…' : 'Refresh', border: data.border })}
        {pill(el, { id: 'new:start', kind: 'button', label: 'New issue', border: data.border })}
      </Box>
    </Box>
  )
}

/** Label chips with counts over the issues in the current state; scoped labels sit under their scope. */
function chips(el: El, data: Data, ui: Ui) {
  const { Box, Text } = el
  const counts = new Map<string, number>()
  for (const i of data.issues) {
    if (ui.state !== 'all' && i.state !== ui.state) continue
    for (const l of i.labels) counts.set(l.name, (counts.get(l.name) ?? 0) + 1)
  }
  const known = new Map(data.labels.map(l => [l.name, l]))
  for (const name of counts.keys()) if (!known.has(name)) known.set(name, { id: -1, name, color: '#888888', exclusive: false, description: '' })
  const shown = [...known.values()].filter(l => counts.has(l.name) || ui.chips.includes(l.name))
  const scopes = new Map<string, typeof shown>()
  for (const l of shown) {
    const scope = scopeOf(l.name).scope ?? ''
    scopes.set(scope, [...(scopes.get(scope) ?? []), l])
  }
  const order = [...scopes.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  return (
    <Box key="chips" flexDirection="column">
      {order.map(scope => (
        <Box key={`scope-${scope}`} flexDirection="row" flexWrap="wrap" columnGap={2}>
          {scope && <Text dimColor>{scope}/</Text>}
          {scopes.get(scope)!.sort((a, b) => a.name.localeCompare(b.name)).map(l => {
            return pill(el, {
              id: `chip:${l.name}`,
              kind: 'chip',
              label: scopeOf(l.name).leaf,
              dot: l.color,
              count: counts.get(l.name) ?? 0,
              active: ui.chips.includes(l.name),
            })
          })}
        </Box>
      ))}
    </Box>
  )
}

function milestonePicker(el: El, data: Data, ui: Ui, act: ListActions) {
  const { Select } = el
  const options = [
    { value: '', label: 'Any milestone' },
    { value: '-', label: 'No milestone' },
    ...data.milestones.map(m => ({ value: m.title, label: `${m.title} (${ui.state === 'closed' ? m.closed : ui.state === 'all' ? m.open + m.closed : m.open})` })),
  ]
  return <Select key="milestone" options={options} value={ui.milestone} onSelect={act.milestone} />
}

export function listView(el: El, data: Data, ui: Ui, now: number, proportional: boolean, act: ListActions) {
  const { Box, Text, Input, Client } = el
  const rows = filterIssues(data.issues, ui)
  const numberWidth = Math.max(2, ...data.issues.map(i => String(i.number).length))
  // Desktop text is proportional, about a fifth narrower than its cell grid.
  const textScale = proportional ? 1.2 : 1
  const card = (r: (typeof rows)[number]) => {
    const props: CardProps = {
      number: r.issue.number,
      title: r.issue.title,
      positions: r.positions,
      labels: r.issue.labels,
      age: ago(r.issue.updatedAt, now),
      comments: r.issue.comments,
      closed: r.issue.state === 'closed',
      numberWidth,
      textScale,
      border: data.border,
    }
    return <Client key={`card-${r.issue.number}`} module="./card.tsx" props={props} width="100%" />
  }
  // A search ranks by match, so it reads best flat; groups return when it clears.
  const groups = ui.grouped && !ui.query.trim() ? groupRows(rows, data.milestones) : [{ title: '', rows }]
  const list = (
    <Box key="list" flexDirection="column" gap={2}>
      {groups.map(g => (
        <Box key={`g-${g.title}`} flexDirection="column" gap={1}>
          {g.title && (
            <Box flexDirection="row">
              <Text bold>{g.title}</Text>
              <Text dimColor>  {g.rows.length}</Text>
            </Box>
          )}
          {g.rows.map(card)}
        </Box>
      ))}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {header(el, data, ui, rows.length)}
      <Box key="search-row" flexDirection="row">
        <Box flexGrow={1} flexDirection="column">
          <Input key="search" placeholder={SEARCH_HINT} value={ui.query} onInput={act.query} onSubmit={act.openFirst} />
        </Box>
      </Box>
      {data.status === 'ready' && chips(el, data, ui)}
      {data.status === 'ready' && milestonePicker(el, data, ui, act)}
      {data.status === 'loading' && <Text dimColor>Loading issues…</Text>}
      {data.status === 'idle' && <Text dimColor>Run /issues to load this repo's issues.</Text>}
      {data.message && <Text color="error">{data.message}</Text>}
      {data.status === 'ready' && rows.length === 0 && <Text dimColor>No issues match. Clear a filter to see more.</Text>}
      {rows.length > 0 && list}
    </Box>
  )
}

/** Issues `text` mentions as `#N`, outside code, that exist here, in order of first mention. */
function mentions(texts: string[], data: Data, self: number): number[] {
  const known = new Set(data.issues.map(i => i.number))
  const seen: number[] = []
  for (const t of texts) {
    const plain = t.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '')
    for (const m of plain.matchAll(/(?:^|[^\w&#/])#(\d+)\b/g)) {
      const n = Number(m[1])
      if (n !== self && known.has(n) && !seen.includes(n)) seen.push(n)
    }
  }
  return seen
}

export function detailView(el: El, data: Data, issue: Issue, detail: Detail | null, ui: Ui, now: number, hasEditor: boolean, act: DetailActions) {
  const { Box, Text, Link, Markdown, Select } = el
  const base = `${repoUrl(data)}/issues`
  const comments = detail?.number === issue.number ? detail : null
  const refs = mentions([issue.body, ...(comments?.comments ?? []).map(c => c.body)], data, issue.number)
  const titleOf = (n: number) => data.issues.find(i => i.number === n)?.title ?? ''

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="top" flexDirection="row" justifyContent="space-between" alignItems="center">
        {pill(el, { id: 'back', kind: 'button', label: '← Issues', border: data.border })}
        <Link href={issue.url} label="Open on web" />
      </Box>
      <Box key="title" flexDirection="row" flexWrap="wrap">
        <Text bold>{issue.title}</Text>
        <Text dimColor> #{issue.number}</Text>
      </Box>
      <Box key="meta" flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text color={issue.state === 'open' ? 'success' : 'merged'}>{issue.state === 'open' ? '● Open' : '● Closed'}</Text>
        {issue.labels.map(l => (
          <Box key={`ml-${l.name}`} flexDirection="row">
            <Text color={l.color}>● </Text>
            <Text dimColor>{l.name}</Text>
          </Box>
        ))}
        <Text dimColor>
          {issue.author} · updated {ago(issue.updatedAt, now)} ago
        </Text>
      </Box>
      <Box key="triage" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
        <Select
          key="issue-milestone"
          options={milestoneOptions(data, issue.milestone)}
          value={issue.milestone ?? ''}
          onSelect={act.milestone}
        />
        {ui.editingLabels === null && pill(el, { id: 'labels:edit', kind: 'button', label: 'Edit labels', border: data.border })}
      </Box>
      {ui.editingLabels !== null && (
        <Box key="label-editor" flexDirection="column" gap={1} borderStyle="round" borderColor={data.border} paddingX={1}>
          {labelPicker(el, data, ui.editingLabels, 'labels:toggle:')}
          <Box flexDirection="row" gap={1}>
            {pill(el, { id: 'labels:save', kind: 'button', label: ui.busy ? 'Saving…' : 'Save labels', active: true, border: data.border })}
            {pill(el, { id: 'labels:cancel', kind: 'button', label: 'Cancel', border: data.border })}
          </Box>
        </Box>
      )}
      {refs.length > 0 && (
        <Box key="refs" flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text dimColor>Mentions</Text>
          {refs.map(n => pill(el, { id: `open:${n}`, kind: 'chip', label: `#${n} ${titleOf(n).slice(0, 40)}${titleOf(n).length > 40 ? '…' : ''}` }))}
        </Box>
      )}
      {/* The issue itself on a raised panel, so it reads apart from the thread below. */}
      <Box
        key="body"
        flexDirection="column"
        borderStyle="round"
        borderColor={data.border}
        backgroundColor={data.raised}
        paddingX={2}
        paddingY={1}
      >
        <Markdown key="body-md" text={linkifyRefs(issue.body.trim() || '_No description._', base)} />
      </Box>
      <Box key="c-head" flexDirection="row" marginTop={1}>
        <Text bold>{issue.comments === 1 ? '1 comment' : `${issue.comments} comments`}</Text>
      </Box>
      {comments?.status === 'loading' && <Text dimColor>Loading comments…</Text>}
      {comments?.message && <Text color="error">{comments.message}</Text>}
      {(comments?.comments ?? []).map((c, i) => (
        <Box key={`cm${i}`} flexDirection="column" borderStyle="round" borderColor={data.border} paddingX={1}>
          <Box flexDirection="row">
            <Text bold>{c.author}</Text>
            <Text dimColor> · {ago(c.createdAt, now)} ago</Text>
          </Box>
          <Markdown key={`cb${i}`} text={linkifyRefs(c.body, base)} />
        </Box>
      ))}
      {composer(el, data, issue, ui, hasEditor)}
    </Box>
  )
}

/** The comment field and the write actions: comment, then close or reopen behind a Confirm. */
function composer(el: El, data: Data, issue: Issue, ui: Ui, hasEditor: boolean) {
  const { Box, Text, Input } = el
  const hasDraft = ui.draft.trim().length > 0
  const isOpen = issue.state === 'open'
  const closeLabel = hasDraft ? 'Comment and close' : 'Close issue'
  const b = data.border
  return (
    <Box key="composer" flexDirection="column" gap={1} marginTop={1}>
      {editor(el, data, ui, 'comment', 'Leave a comment · Ctrl+Enter posts it', true, 3)}
      {editorTools(el, data, ui, 'comment', hasEditor)}
      {ui.armed ? (
        <Box key="confirm" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text>
            {ui.armed === 'close' ? `Close #${issue.number}${hasDraft ? ' with this comment' : ''}?` : `Reopen #${issue.number}${hasDraft ? ' with this comment' : ''}?`}
          </Text>
          {pill(el, { id: 'confirm', kind: 'button', label: ui.busy ? 'Working…' : 'Confirm', active: true, border: b })}
          {pill(el, { id: 'cancel', kind: 'button', label: 'Cancel', border: b })}
        </Box>
      ) : (
        <Box key="actions" flexDirection="row" gap={1} flexWrap="wrap">
          {pill(el, { id: 'comment', kind: 'button', label: ui.busy ? 'Working…' : 'Comment', border: b })}
          {isOpen
            ? pill(el, { id: 'close', kind: 'button', label: closeLabel, border: b })
            : pill(el, { id: 'reopen', kind: 'button', label: hasDraft ? 'Comment and reopen' : 'Reopen issue', border: b })}
        </Box>
      )}
      {ui.notice && <Text color={ui.notice.tone === 'ok' ? 'success' : 'error'}>{ui.notice.text}</Text>}
    </Box>
  )
}

/** The milestone picker's options: none, then the open milestones (and the current one if closed). */
function milestoneOptions(data: Data, current: string | null) {
  const shown = data.milestones.filter(m => m.state === 'open' || m.title === current)
  return [{ value: '', label: 'No milestone' }, ...shown.map(m => ({ value: m.title, label: m.title }))]
}

/** Every repo label as a toggle chip, scoped ones under their scope; each posts `<idPrefix><name>`. */
function labelPicker(el: El, data: Data, selected: string[], idPrefix: string) {
  const { Box, Text } = el
  const scopes = new Map<string, typeof data.labels>()
  for (const l of data.labels) {
    const scope = scopeOf(l.name).scope ?? ''
    scopes.set(scope, [...(scopes.get(scope) ?? []), l])
  }
  const order = [...scopes.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  return (
    <Box key="picker" flexDirection="column">
      {order.map(scope => (
        <Box key={`pk-${scope}`} flexDirection="row" flexWrap="wrap" columnGap={2}>
          {scope && <Text dimColor>{scope}/</Text>}
          {scopes
            .get(scope)!
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(l =>
              pill(el, { id: `${idPrefix}${l.name}`, kind: 'chip', label: scopeOf(l.name).leaf, dot: l.color, active: selected.includes(l.name) }),
            )}
        </Box>
      ))}
    </Box>
  )
}

/** The new-issue form: title, a one-line body, labels and a milestone. */
export function newIssueView(el: El, data: Data, ui: Ui, draft: NewIssue, rules: TriageRules, hasEditor: boolean, act: NewIssueActions) {
  const { Box, Text, Input, Select } = el
  const need = [rules.requireMilestone ? 'a milestone' : '', rules.requireLabelFrom.length ? `one of ${rules.requireLabelFrom.join(', ')}` : '']
    .filter(Boolean)
    .join(' and ')
  return (
    <Box flexDirection="column" gap={1}>
      <Box key="top" flexDirection="row" justifyContent="space-between" alignItems="center">
        {pill(el, { id: 'new:back', kind: 'button', label: '← Issues', border: data.border })}
        <Text bold>New issue{data.repo ? ` in ${data.repo.owner}/${data.repo.repo}` : ''}</Text>
      </Box>
      {editor(el, data, ui, 'new-title', 'Title · Enter files the issue', false, 1)}
      {editor(el, data, ui, 'new-body', 'Description in Markdown · Ctrl+Enter files the issue', true, 6)}
      {editorTools(el, data, ui, 'new-body', hasEditor)}
      <Text dimColor>Labels</Text>
      {labelPicker(el, data, draft.labels, 'new:toggle:')}
      <Select key="new-milestone" options={milestoneOptions(data, null)} value={draft.milestone} onSelect={act.milestone} />
      {need && <Text dimColor>This repo's issues need {need}.</Text>}
      <Box key="actions" flexDirection="row" gap={1}>
        {pill(el, { id: 'new:create', kind: 'button', label: ui.busy ? 'Filing…' : 'Create issue', active: true, border: data.border })}
        {pill(el, { id: 'new:cancel', kind: 'button', label: 'Cancel', border: data.border })}
      </Box>
      {ui.notice && <Text color={ui.notice.tone === 'ok' ? 'success' : 'error'}>{ui.notice.text}</Text>}
    </Box>
  )
}

/** One editor Client: its text comes from the field behind `id`; see editor.tsx. */
function editor(el: El, data: Data, ui: Ui, id: string, placeholder: string, multiline: boolean, minRows: number) {
  const { Client } = el
  const value = id === 'comment' ? ui.draft : id === 'new-title' ? (ui.creating?.title ?? '') : (ui.creating?.body ?? '')
  const props: EditorProps = {
    id,
    value,
    sync: ui.sync[id] ?? 0,
    placeholder,
    multiline,
    preview: ui.preview[id] === true,
    minRows,
    border: data.border,
    cmd: ui.fmt[id] ?? null,
  }
  return <Client key={`ed-${id}`} module="./editor.tsx" props={props} width="100%" />
}

const FORMATS: [Format, string][] = [
  ['bold', 'Bold'],
  ['italic', 'Italic'],
  ['code', 'Code'],
  ['link', 'Link'],
  ['heading', 'Heading'],
  ['list', 'List'],
  ['quote', 'Quote'],
]

/** The toolbar under a multi-line editor: Markdown marks, Write/Preview, and the external editor. */
function editorTools(el: El, data: Data, ui: Ui, id: string, hasEditor: boolean) {
  const { Box } = el
  const previewing = ui.preview[id] === true
  const out = ui.external?.id === id
  return (
    <Box key={`tools-${id}`} flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
      {!previewing && FORMATS.map(([f, label]) => pill(el, { id: `fmt:${id}:${f}`, kind: 'chip', label }))}
      {pill(el, { id: `preview:${id}`, kind: 'chip', label: previewing ? 'Write' : 'Preview', active: previewing })}
      {hasEditor && !out && pill(el, { id: `editor:${id}`, kind: 'chip', label: 'Open in editor' })}
      {out && pill(el, { id: 'editor-pull', kind: 'chip', label: 'Use editor text', active: true })}
    </Box>
  )
}
