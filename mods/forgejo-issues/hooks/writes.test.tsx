import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// A fake forge: the remote, a token in the secrets file, and an API that
// records every request and answers like Forgejo would.
const ISSUE = {
  number: 7,
  title: 'Thing',
  body: '',
  state: 'open',
  comments: 0,
  updated_at: '2026-01-01T00:00:00Z',
  html_url: 'https://forge.example/me/r/issues/7',
  user: { login: 'me' },
  labels: [],
  milestone: null,
}

type Call = { method: string; url: string; body: unknown }

function fakeForge(on: On): Call[] {
  const calls: Call[] = []
  mock.clock(on)
  mock.env(on, { HOME: '/h' })
  // Hooks standing in for the engine answer { value }.
  on('session.cwd', () => ({ value: '/h/r' }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'git@forge.example:me/r.git\n', stderr: '' } }) as never)
  on('fs.read', ($, e) => {
    if (e.path.endsWith('/forgejo.env')) return { value: 'FORGEJO_TOKEN_FORGE_EXAMPLE=t\n' }
    throw new Error('missing')
  })
  // The forge's own state, so a write is seen by the reads after it.
  let issue: Record<string, unknown> = { ...ISSUE }
  on('http.fetch', ($, e) => {
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(String(e.init.body)) : undefined
    const url = e.url.replace('https://forge.example/api/v1/repos/me/r', '')
    calls.push({ method, url: e.url, body })
    const ok = (json: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(json) } })
    if (method === 'GET' && url.startsWith('/issues?')) return ok(url.includes('page=1') ? [issue] : [])
    if (method === 'GET' && url.startsWith('/labels')) return ok(url.includes('page=1') ? LABELS : [])
    if (method === 'GET' && url.startsWith('/milestones')) return ok(url.includes('page=1') ? MILESTONES : [])
    if (method === 'GET' && url === '/issues/7') return ok(issue)
    if (method === 'GET') return ok([])
    if (method === 'POST' && url === '/issues/7/comments') {
      return ok({ user: { login: 'me' }, body: (body as { body: string }).body, created_at: '2026-01-02T00:00:00Z' })
    }
    if (method === 'PATCH' && url === '/issues/7') {
      const b = body as { state?: string; milestone?: number }
      issue = {
        ...issue,
        ...(b.state ? { state: b.state } : {}),
        ...(b.milestone !== undefined ? { milestone: MILESTONES.find(m => m.id === b.milestone) ?? null } : {}),
      }
      return ok(issue)
    }
    if (method === 'PUT' && url === '/issues/7/labels') {
      issue = { ...issue, labels: LABELS.filter(l => (body as { labels: number[] }).labels.includes(l.id)) }
      return ok(issue.labels)
    }
    if (method === 'POST' && url === '/issues') {
      const b = body as { title: string; body: string; labels: number[]; milestone?: number }
      return ok({
        ...ISSUE,
        number: 8,
        title: b.title,
        body: b.body,
        html_url: 'https://forge.example/me/r/issues/8',
        labels: LABELS.filter(l => b.labels.includes(l.id)),
        milestone: MILESTONES.find(m => m.id === b.milestone) ?? null,
      })
    }
    return { value: { status: 500, ok: false, headers: {}, text: '' } }
  })
  return calls
}

const LABELS = [
  { id: 1, name: 'bug', color: 'ee0701' },
  { id: 2, name: 'kind/bug', color: 'ee0701', exclusive: true },
  { id: 3, name: 'kind/feature', color: '00aa00', exclusive: true },
]
const MILESTONES = [{ id: 9, title: 'Theming', state: 'open', open_issues: 1, closed_issues: 0 }]

const pane = { plugin: 'forgejo-issues', component: 'Pane', requestId: 'forgejo-issues', props: { bodyColumns: 80 } as never } as const
const writes = (calls: Call[]) => calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.url.replace('https://forge.example/api/v1', '')}`)

test('close_needs_a_comment_then_a_confirm_and_posts_it_first', async ($, on) => {
  const calls = fakeForge(on)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.post({ open: 7 }, { in: 'card-7' })

  // No comment: refused, nothing sent.
  await ui.post({ press: 'close' }, { in: 'p-close' })
  expect(await ui.find({ text: /Write a comment first/ })).toBeDefined()
  expect(writes(calls)).toEqual([])

  // With a comment: the first press only arms it.
  await ui.input({ key: 'draft', text: 'Fixed in abc123', kind: 'change' })
  await ui.post({ press: 'close' }, { in: 'p-close' })
  expect(await ui.find({ text: /Close #7 with this comment\?/ })).toBeDefined()
  expect(writes(calls)).toEqual([])

  // Confirm: comment first, then the close.
  await ui.post({ press: 'confirm' }, { in: 'p-confirm' })
  expect(writes(calls)).toEqual(['POST /repos/me/r/issues/7/comments', 'PATCH /repos/me/r/issues/7'])
  expect(calls.find(c => c.method === 'POST')?.body).toEqual({ body: 'Fixed in abc123' })
  expect(await ui.find({ text: 'Closed #7 with a comment.' })).toBeDefined()
  expect(await ui.find({ key: 'p-reopen' })).toBeDefined()
})

test('cancel_sends_nothing', async ($, on) => {
  const calls = fakeForge(on)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.post({ open: 7 }, { in: 'card-7' })
  await ui.input({ key: 'draft', text: 'never mind', kind: 'change' })
  await ui.post({ press: 'close' }, { in: 'p-close' })
  await ui.post({ press: 'cancel' }, { in: 'p-cancel' })
  expect(writes(calls)).toEqual([])
  expect(await ui.find({ key: 'p-close' })).toBeDefined()
})

test('enter_in_the_composer_posts_a_comment', async ($, on) => {
  const calls = fakeForge(on)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.post({ open: 7 }, { in: 'card-7' })
  await ui.input({ key: 'draft', text: 'A note', kind: 'change' })
  await ui.input({ key: 'draft', text: 'A note', kind: 'submit' })
  expect(writes(calls)).toEqual(['POST /repos/me/r/issues/7/comments'])
  expect(await ui.find({ text: 'Commented on #7.' })).toBeDefined()
})

const writesBody = (calls: Call[], method: string) => calls.find(c => c.method === method)?.body

test('labels_save_as_ids_and_exclusive_scopes_keep_one', async ($, on) => {
  const calls = fakeForge(on)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.post({ open: 7 }, { in: 'card-7' })
  await ui.post({ press: 'labels:edit' }, { in: 'p-labels:edit' })
  await ui.post({ press: 'labels:toggle:kind/bug' }, { in: 'p-labels:toggle:kind/bug' })
  await ui.post({ press: 'labels:toggle:kind/feature' }, { in: 'p-labels:toggle:kind/feature' })
  await ui.post({ press: 'labels:toggle:bug' }, { in: 'p-labels:toggle:bug' })
  expect(writes(calls)).toEqual([])
  await ui.post({ press: 'labels:save' }, { in: 'p-labels:save' })
  expect(writes(calls)).toEqual(['PUT /repos/me/r/issues/7/labels'])
  expect(writesBody(calls, 'PUT')).toEqual({ labels: [3, 1] })
  expect(await ui.find({ text: 'Labels saved on #7.' })).toBeDefined()
  expect(await ui.find({ key: 'p-labels:edit' })).toBeDefined()
})

test('milestone_select_patches_by_id', async ($, on) => {
  const calls = fakeForge(on)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.post({ open: 7 }, { in: 'card-7' })
  await ui.select({ key: 'issue-milestone', value: 'Theming' })
  expect(writes(calls)).toEqual(['PATCH /repos/me/r/issues/7'])
  expect(writesBody(calls, 'PATCH')).toEqual({ milestone: 9 })
  expect(await ui.find({ text: '#7 moved to Theming.' })).toBeDefined()
})

test('new_issue_is_refused_untitled_then_filed_and_opened', async ($, on) => {
  const calls = fakeForge(on)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.post({ press: 'new:start' }, { in: 'p-new:start' })
  await ui.post({ press: 'new:create' }, { in: 'p-new:create' })
  expect(await ui.find({ text: 'Give the issue a title.' })).toBeDefined()
  expect(writes(calls)).toEqual([])

  await ui.input({ key: 'new-title', text: 'Shiny new thing', kind: 'change' })
  await ui.post({ press: 'new:toggle:bug' }, { in: 'p-new:toggle:bug' })
  await ui.select({ key: 'new-milestone', value: 'Theming' })
  await ui.post({ press: 'new:create' }, { in: 'p-new:create' })
  expect(writes(calls)).toEqual(['POST /repos/me/r/issues'])
  expect(writesBody(calls, 'POST')).toEqual({ title: 'Shiny new thing', body: '', labels: [1], milestone: 9 })
  expect(await ui.find({ text: 'Filed #8.' })).toBeDefined()
  expect(await ui.find({ text: /Shiny new thing/ })).toBeDefined()
})
