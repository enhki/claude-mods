import type { On } from 'claude-code'
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

// A session with a status line command, answered by fakes: the line reads "status".
function fakeSession(on: On) {
  on('session.id', () => ({ value: 's' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.root', () => ({ value: '/r' }) as never)
  on('session.model', () => ({ value: { id: 'm', displayName: 'M' } }) as never)
  on('session.version', () => ({ value: { version: '1' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { percent: 1, window: 1 } } }) as never)
  on('fs.read', ($, e) => {
    if ((e as { path: string }).path === '/r/.claude/settings.json') {
      return { value: JSON.stringify({ statusLine: { type: 'command', command: 'line' } }) } as never
    }
    throw new Error('ENOENT')
  })
  on('process.run', ($, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    return { value: { exitCode: 0, stdout: argv[0] === 'printenv' ? '/h' : 'status', stderr: '' } } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
}

test('desktop_stacks_what_is_beneath_above_the_line', async ($, on) => {
  fakeSession(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as never)
  const ui = await $.ui.mount({ plugin: 'statusline-desktop', surface: 'desktop', component: 'AbovePrompt', props: props as never })
  expect(await ui.find({ text: 'status' })).toBeDefined()
  expect(await ui.find({ text: 'beneath' })).toBeDefined()
})
