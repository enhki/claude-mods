import type { JsonValue, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'reading',
  component: 'Pane',
  requestId: 'reading',
  props: { title: 'Reading', bodyColumns: 100 } as never,
} as const

const LIST = {
  tool: 'mcp__reading__publish_reading',
  title: 'Session inputs',
  items: [
    { title: 'The ledger', path: 'docs/decisions.md', why: 'what is agreed' },
    { title: 'A note', text: 'Read **this**.' },
  ],
}

const REMOTE = 'git@forge.test:owner/repo.git\n'

// The engine beneath the mod: the pane opens, files and commands answer, prompts are recorded.
function fakeEngine(on: On, opts: { process?: (argv: string[]) => string } = {}): { prompts: string[]; settle: () => Promise<void> } {
  const clock = mock.clock(on)
  const seen = { prompts: [] as string[], settle: () => clock.settle() }
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: { command: 'reading' } }) as never)
  on('tool.register', () => ({ value: { tool: 'publish_reading' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  on('fs.read', () => ({ value: '# Ledger\n\nOne row.\n' }) as never)
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    const out = opts.process ? opts.process(argv) : REMOTE
    return { value: { exitCode: 0, stdout: out, stderr: '' } } as never
  })
  return seen
}

type Pressable = {
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  post: (data: JsonValue, scope?: { in: string }) => Promise<void>
}

const LEDGER = 'file:docs/decisions.md'

for (const surface of ['terminal', 'desktop'] as const) {
  // A press as the person makes it on this surface: a Button, or a Client's post.
  const pressOn = (ui: Pressable, id: string) =>
    surface === 'terminal' ? ui.press({ key: id }) : ui.post({ press: id }, { in: id })
  // A comment as typed: the terminal's Input, or the desktop editor's post (keyed by the publish rev).
  const commentOn = (ui: Pressable, key: string, text: string, rev = 1) =>
    surface === 'terminal' ? ui.input({ key: `comment:${key}`, text }) : ui.post({ comment: key, text }, { in: `comment:${rev}:${key}` })

  test(`${surface}_an_empty_pane_says_what_it_is_for`, async $ => {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /No reading list yet/ })).toBeDefined()
  })

  test(`${surface}_publishing_draws_the_list_closed`, async ($, on) => {
    fakeEngine(on)
    const result = await $.tool.call(LIST as never)
    expect(JSON.stringify(result)).toContain('Published 2 items; the list holds 2')
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: 'Session inputs' })).toBeDefined()
    expect(await ui.find({ text: /0 acknowledged, 0 read, 2 unread/ })).toBeDefined()
    expect(await ui.find({ text: /One row/ })).toBeUndefined()
  })

  test(`${surface}_opening_loads_the_file_and_marking_and_sending_report_it`, async ($, on) => {
    const seen = fakeEngine(on)
    await $.tool.call(LIST as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, `open:${LEDGER}`)
    expect(await ui.find({ text: /Loading/ })).toBeDefined()
    // The load runs on a timer of its own, not inside the press.
    await seen.settle()
    expect(await ui.find({ text: /docs\/decisions\.md/ })).toBeDefined()
    expect(await ui.find({ text: /what is agreed/ })).toBeDefined()
    expect(await ui.find({ text: /Loading/ })).toBeUndefined()
    await pressOn(ui, `acknowledged:${LEDGER}`)
    await commentOn(ui, LEDGER, 'fine by me')
    expect(await ui.find({ text: /1 acknowledged, 0 read, 1 unread/ })).toBeDefined()
    await pressOn(ui, 'send')
    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0]).toContain('Reading results for "Session inputs": 1 acknowledged, 0 read, 1 unread.')
    expect(seen.prompts[0]).toContain('1. ACKNOWLEDGED: The ledger [docs/decisions.md] (comment: fine by me)')
    expect(seen.prompts[0]).toContain('2. UNREAD: A note [note]')
  })

  test(`${surface}_a_republish_keeps_the_marks_and_adds_the_new_item`, async ($, on) => {
    fakeEngine(on)
    await $.tool.call(LIST as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, `open:${LEDGER}`)
    await pressOn(ui, `discuss:${LEDGER}`)
    await $.tool.call({ ...LIST, title: 'Round two', items: [{ title: 'New', issue: 7 }] } as never)
    expect(await ui.find({ text: 'Round two' })).toBeDefined()
    expect(await ui.find({ text: /1 to discuss, 2 unread/ })).toBeDefined()
    await $.tool.call({ ...LIST, replace: true, items: [{ title: 'Only', url: 'https://example.test/x' }] } as never)
    expect(await ui.find({ text: /0 acknowledged, 0 read, 1 unread/ })).toBeDefined()
  })
}

test('an_item_without_a_source_is_refused', async ($, on) => {
  fakeEngine(on)
  const result = await $.tool.call({ ...LIST, items: [{ title: 'x' }] } as never)
  expect(JSON.stringify(result)).toContain('give exactly one of path, issue, url or text')
})

test('an_issue_item_runs_the_issue_command_and_shows_what_it_printed', async ($, on) => {
  const seen = fakeEngine(on, { process: argv => (argv[0] === 'git' ? REMOTE : `ran ${argv.join(' ')}`) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ ...LIST, items: [{ title: 'The issue', issue: 12 }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open:issue:#12' })
  await seen.settle()
  expect(await ui.find({ text: /ran fgj --hostname forge.test issue view 12 -R owner\/repo/ })).toBeDefined()
})
