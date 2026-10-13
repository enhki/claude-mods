import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// A forge with two repos, `me/r` (the session's) and `me/infra`, each with one
// issue, and a project file listing the second.
function issue(n: number, title: string, repo: string) {
  return {
    number: n,
    title,
    body: '',
    state: 'open',
    comments: 0,
    updated_at: '2026-01-01T00:00:00Z',
    html_url: `https://forge.example/me/${repo}/issues/${n}`,
    user: { login: 'me' },
    labels: [],
    milestone: null,
  }
}

function twoRepos(on: On, reposFile: string | null): string[] {
  const urls: string[] = []
  mock.clock(on)
  mock.env(on, { HOME: '/h' })
  mock.store(on)
  on('session.cwd', () => ({ value: '/h/r' }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'git@forge.example:me/r.git\n', stderr: '' } }) as never)
  on('fs.read', ($, e) => {
    if (e.path.endsWith('/forgejo.env')) return { value: 'FORGEJO_TOKEN_FORGE_EXAMPLE=t\n' }
    if (e.path === '/h/r/.claude/forgejo-issues.json' && reposFile !== null) return { value: reposFile }
    throw new Error('missing')
  })
  on('http.fetch', ($, e) => {
    urls.push(e.url)
    const ok = (json: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(json) } })
    const m = /\/repos\/me\/([^/]+)\/issues\?.*page=1/.exec(e.url)
    if (m?.[1] === 'r') return ok([issue(1, 'App thing', 'r')])
    if (m?.[1] === 'infra') return ok([issue(2, 'Infra thing', 'infra')])
    return ok([])
  })
  return urls
}

const pane = { plugin: 'forgejo-issues', component: 'Pane', requestId: 'forgejo-issues', props: { bodyColumns: 80 } as never } as const
const LIST = JSON.stringify({ repos: ['me/infra'] })

test('no_project_file_draws_no_switcher', async ($, on) => {
  twoRepos(on, null)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ key: 'card-1' })).toBeDefined()
  expect(await ui.find({ key: 'p-repo:me/infra' })).toBeUndefined()
})

test('a_press_switches_repo_and_lights_its_button', async ($, on) => {
  const urls = twoRepos(on, LIST)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ key: 'card-1' })).toBeDefined()

  await ui.post({ press: 'repo:me/infra' }, { in: 'p-repo:me/infra' })
  expect(await ui.find({ key: 'card-2' })).toBeDefined()
  expect(await ui.find({ key: 'card-1' })).toBeUndefined()
  expect(urls.some(u => u.includes('/repos/me/infra/labels'))).toBe(true)
  const lit = async (key: string) => ((await ui.find({ key }))?.props.props as { active?: boolean } | undefined)?.active
  expect(await lit('p-repo:me/infra')).toBe(true)
  expect(await lit('p-repo:me/r')).toBe(false)
})

test('the_pick_is_remembered_for_the_next_load', async ($, on) => {
  twoRepos(on, LIST)
  await $.command.run({ command: 'issues', args: 'infra' } as never)
  await $.command.run({ command: 'issues', args: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ key: 'card-2' })).toBeDefined()
})

test('an_unknown_repo_name_says_what_the_choices_are', async ($, on) => {
  twoRepos(on, LIST)
  await $.command.run({ command: 'issues', args: 'nope' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ text: /No repo matches "nope".*me\/r, me\/infra/ })).toBeDefined()
})

test('a_repo_name_without_a_project_file_says_how_to_add_one', async ($, on) => {
  twoRepos(on, null)
  await $.command.run({ command: 'issues', args: 'infra' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
  expect(await ui.find({ text: /lists no other repos.*forgejo-issues\.json/ })).toBeDefined()
})
