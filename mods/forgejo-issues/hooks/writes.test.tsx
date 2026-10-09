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
  on('http.fetch', ($, e) => {
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(String(e.init.body)) : undefined
    calls.push({ method, url: e.url, body })
    const ok = (json: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(json) } })
    if (method === 'GET' && e.url.includes('/issues?')) return ok([ISSUE])
    if (method === 'GET') return ok([])
    if (method === 'POST' && e.url.endsWith('/issues/7/comments')) {
      return ok({ user: { login: 'me' }, body: (body as { body: string }).body, created_at: '2026-01-02T00:00:00Z' })
    }
    if (method === 'PATCH' && e.url.endsWith('/issues/7')) return ok({ ...ISSUE, state: (body as { state: string }).state })
    return { value: { status: 500, ok: false, headers: {}, text: '' } }
  })
  return calls
}

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
