import { expect, test } from 'claude-code/testing'

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
}

for (const surface of ['terminal', 'desktop'] as const) {
  // Terminal: the real status line already shows. Desktop: nothing until the
  // first run lands. Either way the engine's own band is what draws.
  test(`${surface}_leaves_the_engine_band_until_a_line_exists`, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const ui = await $.ui.mount({
      plugin: 'statusline-desktop',
      surface,
      component: 'AbovePrompt',
      props: props as never,
    })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  })
}
