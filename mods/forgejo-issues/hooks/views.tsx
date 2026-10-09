import type { Elements } from 'claude-code'

import type { Data, Detail, Issue, Ui } from '../types'
import { ago, linkifyRefs, scopeOf } from './forge'
import type { CardProps } from './card'
import type { PillProps } from './pill'
import { filterIssues, groupRows } from './search'

/** The elements both drawing surfaces with a pane share. */
export type El = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Link' | 'Markdown' | 'Client'>

/** What the native controls (Input, Select) call; every pressable control is a pill posting its id. */
export type ListActions = {
  query: (text: string) => void
  openFirst: () => void
  milestone: (value: string) => void
}

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
  for (const name of counts.keys()) if (!known.has(name)) known.set(name, { name, color: '#888888', exclusive: false, description: '' })
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

export function detailView(el: El, data: Data, issue: Issue, detail: Detail | null, now: number) {
  const { Box, Text, Link, Markdown } = el
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
        {issue.milestone && <Text dimColor>⚑ {issue.milestone}</Text>}
        <Text dimColor>
          {issue.author} · updated {ago(issue.updatedAt, now)} ago
        </Text>
      </Box>
      {refs.length > 0 && (
        <Box key="refs" flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text dimColor>Mentions</Text>
          {refs.map(n => pill(el, { id: `open:${n}`, kind: 'chip', label: `#${n} ${titleOf(n).slice(0, 40)}${titleOf(n).length > 40 ? '…' : ''}` }))}
        </Box>
      )}
      <Markdown key="body" text={linkifyRefs(issue.body.trim() || '_No description._', base)} />
      <Text key="c-head" dimColor>
        {issue.comments === 1 ? '1 comment' : `${issue.comments} comments`}
      </Text>
      {comments?.status === 'loading' && <Text dimColor>Loading comments…</Text>}
      {comments?.message && <Text color="error">{comments.message}</Text>}
      {(comments?.comments ?? []).map((c, i) => (
        <Box key={`cm${i}`} flexDirection="column">
          <Box flexDirection="row">
            <Text bold>{c.author}</Text>
            <Text dimColor> · {ago(c.createdAt, now)} ago</Text>
          </Box>
          <Markdown key={`cb${i}`} text={linkifyRefs(c.body, base)} />
        </Box>
      ))}
    </Box>
  )
}
