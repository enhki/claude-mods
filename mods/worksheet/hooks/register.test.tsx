import type { JsonValue, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'worksheet',
  component: 'Pane',
  requestId: 'worksheet',
  props: { title: 'Worksheet', bodyColumns: 120 } as never,
} as const

const PATH = 'docs/prd/msg-worksheet.json'

const FILE = {
  schema: 1,
  title: 'MSG worksheet',
  choices: ['must', 'needed', 'later', 'no'],
  render: 'scripts/render-worksheet',
  export: 'docs/prd/msg.md',
  sections: [{ id: 'core', title: 'Core', kind: 'capabilities' }],
  rows: [
    {
      id: 'xep-0030',
      section: 'core',
      title: 'Discover features',
      references: [{ id: 'XEP-0030', url: 'https://example.test/30', version: '2.5.0', status: 'Final' }],
      role: 'Core C/S',
      suite: { membership: 'required', categories: ['Core'], levels: ['C/S'], flags: [] },
      priority: '',
      comment: '',
      proposed: { priority: 'must', reason: 'already used' },
    },
    {
      id: 'xep-0449',
      section: 'core',
      title: 'Stickers',
      references: [],
      role: 'Additional candidate',
      suite: { membership: 'additional', categories: [], levels: [], flags: [] },
      priority: '',
      comment: '',
      proposed: { priority: '', reason: '' },
    },
  ],
}

type Fake = { prompts: string[]; writes: { path: string; text: string }[]; runs: string[][]; settle: () => Promise<void>; advance: (ms: number) => Promise<void> }

// The engine beneath the mod: one worksheet in docs/prd, a file that remembers what was written, commands that succeed.
function fakeEngine(on: On): Fake {
  const clock = mock.clock(on)
  let text = JSON.stringify(FILE, null, 2)
  const seen: Fake = { prompts: [], writes: [], runs: [], settle: () => clock.settle(), advance: ms => clock.advance(ms) }
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: { command: 'worksheet' } }) as never)
  on('tool.register', () => ({ value: { tool: 'propose_worksheet' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  on('fs.read', ($, e) => {
    const path = (e as { path: string }).path
    // The engine resolves a relative path against the session folder before a stub sees it.
    return { value: path.endsWith(PATH) ? text : '' } as never
  })
  on('fs.list', () => ({ value: [{ name: 'msg-worksheet.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }) as never)
  on('fs.write', ($, e) => {
    const w = e as { path: string; text: string }
    seen.writes.push(w)
    if (w.path.endsWith(PATH)) text = w.text
    return { value: undefined } as never
  })
  on('process.run', ($, e) => {
    seen.runs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  return seen
}

type Pressable = {
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  post: (data: JsonValue, scope?: { in: string }) => Promise<void>
}

for (const surface of ['terminal', 'desktop'] as const) {
  const pressOn = (ui: Pressable, id: string) =>
    surface === 'terminal' ? ui.press({ key: id }) : ui.post({ press: id }, { in: id })
  const commentOn = (ui: Pressable, row: string, text: string, rev: number) =>
    surface === 'terminal' ? ui.input({ key: `comment:${row}`, text }) : ui.post({ comment: row, text }, { in: `comment:${rev}:${row}` })

  test(`${surface}_the_command_opens_the_discovered_worksheet`, async ($, on) => {
    fakeEngine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
    const ran = await $.command.run({ command: 'worksheet' } as never)
    expect(JSON.stringify(ran)).toContain(`Worksheet pane opened on ${PATH}`)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: 'MSG worksheet' })).toBeDefined()
    expect(await ui.find({ text: /Must 0 · Needed 0 · Later 0 · No 0 · unset 2 · proposals 1 \(1 differ\)/ })).toBeDefined()
    await pressOn(ui, 'open:xep-0030')
    expect(await ui.find({ text: /Core C\/S/ })).toBeDefined()
  })

  test(`${surface}_a_priority_is_written_to_the_file_and_the_export_rendered`, async ($, on) => {
    const seen = fakeEngine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
    await $.command.run({ command: 'worksheet' } as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, 'open:xep-0030')
    expect(await ui.find({ text: /Claude proposes Must: already used/ })).toBeDefined()
    await pressOn(ui, 'pri:needed:xep-0030')
    expect(await ui.find({ text: /Must 0 · Needed 1 · Later 0 · No 0 · unset 1/ })).toBeDefined()
    expect(seen.writes).toHaveLength(0)
    await seen.advance(500)
    expect(seen.writes).toHaveLength(1)
    const written = JSON.parse(seen.writes[0]?.text ?? '{}')
    expect(written.rows[0].priority).toBe('needed')
    expect(written.rows[0].proposed).toEqual({ priority: 'must', reason: 'already used' })
    expect(written.export).toBe('docs/prd/msg.md')
    expect(seen.runs).toEqual([['scripts/render-worksheet']])
    expect(seen.prompts).toHaveLength(0)
    // The foot's controls are Buttons in the terminal and Clients on the desktop.
    if (surface === 'terminal') expect(await ui.find({ text: /Send 1 change/ })).toBeDefined()
    else expect((await ui.findAll({ type: 'Client' })).some(c => JSON.stringify(c.props).includes('Send 1 change'))).toBe(true)
  })

  test(`${surface}_send_reports_the_saved_changes_and_notify_sends_them_by_itself`, async ($, on) => {
    const seen = fakeEngine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
    await $.command.run({ command: 'worksheet' } as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, 'open:xep-0449')
    await pressOn(ui, 'pri:no:xep-0449')
    await commentOn(ui, 'xep-0449', 'not for a work tool', 1)
    await seen.advance(500)
    await pressOn(ui, 'send')
    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0]).toContain(`Worksheet changes for "MSG worksheet" (${PATH}): 1 priority, 1 comment.`)
    expect(seen.prompts[0]).toContain('- xep-0449 Stickers: priority unset → no; comment: "not for a work tool"')
    await pressOn(ui, 'notify')
    await pressOn(ui, 'open:xep-0030')
    await pressOn(ui, 'pri:must:xep-0030')
    await seen.advance(500)
    expect(seen.prompts).toHaveLength(1)
    await seen.advance(3_100)
    expect(seen.prompts).toHaveLength(2)
    expect(seen.prompts[1]).toContain('- xep-0030 Discover features: priority unset → must (proposed must)')
  })

  test(`${surface}_filters_narrow_the_rows`, async ($, on) => {
    fakeEngine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
    await $.command.run({ command: 'worksheet' } as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, 'fm:additional')
    expect(await ui.find({ text: /1 of 2 rows/ })).toBeDefined()
    expect(await ui.find({ text: /xep-0030/ })).toBeUndefined()
    await pressOn(ui, 'clearfilter')
    expect(await ui.find({ text: /2 of 2 rows/ })).toBeDefined()
  })
}

test('the_tool_records_proposals_without_touching_the_decision', async ($, on) => {
  const seen = fakeEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const result = await $.tool.call({ tool: 'mcp__worksheet__propose_worksheet', proposals: [{ id: 'xep-0449', priority: 'later', reason: 'novelty' }, { id: 'nope', priority: 'must', reason: 'x' }] } as never)
  expect(JSON.stringify(result)).toContain('Recorded 1 proposal')
  expect(JSON.stringify(result)).toContain('Unknown rows: nope')
  const written = JSON.parse(seen.writes[0]?.text ?? '{}')
  expect(written.rows[1].proposed).toEqual({ priority: 'later', reason: 'novelty' })
  expect(written.rows[1].priority).toBe('')
  expect(seen.runs).toEqual([['scripts/render-worksheet']])
  const refused = await $.tool.call({ tool: 'mcp__worksheet__propose_worksheet', proposals: [{ id: 'xep-0449', priority: 'maybe', reason: '' }] } as never)
  expect(JSON.stringify(refused)).toContain('priority must be one of must, needed, later, no')
})
