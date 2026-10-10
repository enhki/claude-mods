import type { JsonValue, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'walkthrough',
  component: 'Pane',
  requestId: 'walkthrough',
  props: { title: 'Walkthrough', bodyColumns: 100 } as never,
} as const

const STEPS = {
  tool: 'mcp__walkthrough__publish_walkthrough',
  title: 'Sidebar resize',
  steps: [
    { title: 'Start the demo', run: 'make demo', where: '/r, 120x40', expect: 'Two panes' },
    { title: 'Shrink to 80x24', expect: 'The sidebar keeps 20 columns' },
  ],
}

// The engine beneath the mod: the pane opens, and prompts and copies are recorded.
function fakeEngine(on: On): { prompts: string[]; copies: string[] } {
  const seen = { prompts: [] as string[], copies: [] as string[] }
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  on('ui.copy', ($, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true } } as never
  })
  return seen
}

type Pressable = {
  press: (target: { key: string }) => Promise<unknown>
  post: (data: JsonValue, scope?: { in: string }) => Promise<void>
}

for (const surface of ['terminal', 'desktop'] as const) {
  // A press as the person makes it on this surface: a Button, or a Client's post.
  const pressOn = (ui: Pressable, id: string) =>
    surface === 'terminal' ? ui.press({ key: id }) : ui.post({ press: id }, { in: id })

  test(`${surface}_an_empty_pane_says_what_it_is_for`, async $ => {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /No walkthrough yet/ })).toBeDefined()
  })

  test(`${surface}_publishing_draws_the_first_step_open`, async ($, on) => {
    fakeEngine(on)
    const result = await $.tool.call(STEPS as never)
    expect(JSON.stringify(result)).toContain('Published 2 steps')
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: 'Sidebar resize' })).toBeDefined()
    expect(await ui.find({ text: /Expect: Two panes/ })).toBeDefined()
    expect(await ui.find({ text: /Expect: The sidebar/ })).toBeUndefined()
  })

  test(`${surface}_marking_moves_on_and_sending_submits_the_results`, async ($, on) => {
    const seen = fakeEngine(on)
    await $.tool.call(STEPS as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, 'pass:0')
    expect(await ui.find({ text: /Expect: The sidebar/ })).toBeDefined()
    await ui.input({ key: 'note:1', text: 'overlaps' })
    await pressOn(ui, 'fail:1')
    expect(await ui.find({ text: /1 passed, 1 failed/ })).toBeDefined()
    await pressOn(ui, 'send')
    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0]).toContain('2. FAIL: Shrink to 80x24 (note: overlaps)')
  })

  test(`${surface}_copy_puts_the_command_on_the_clipboard`, async ($, on) => {
    const seen = fakeEngine(on)
    await $.tool.call(STEPS as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await pressOn(ui, 'copy:0')
    expect(seen.copies).toEqual(['make demo'])
  })
}

test('a_step_without_an_expectation_is_refused', async ($, on) => {
  fakeEngine(on)
  const result = await $.tool.call({ ...STEPS, steps: [{ title: 'x' }] } as never)
  expect(JSON.stringify(result)).toContain('says nothing about what to expect')
})
