import { expect, mock, test } from 'claude-code/testing'

const pane = { plugin: 'forgejo-issues', component: 'Pane', requestId: 'forgejo-issues', props: { bodyColumns: 80 } as never } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}_pane_invites_a_load_before_the_first_run`, async ($, on) => {
    mock.clock(on)
    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ text: "Run /issues to load this repo's issues." })).toBeDefined()
    expect(await ui.find({ key: 'p-refresh' })).toBeDefined()
  })

  // Controls are Clients posting { press } because the desktop drops Button presses.
  test(`${surface}_pill_press_toggles_grouping`, async ($, on) => {
    mock.clock(on)
    const ui = await $.ui.mount({ ...pane, surface })
    const props = async () => (await ui.find({ key: 'p-grouped' }))?.props.props as { active?: boolean } | undefined
    expect((await props())?.active).toBe(true)
    await ui.post({ press: 'grouped' }, { in: 'p-grouped' })
    expect((await props())?.active).toBe(false)
  })
}
