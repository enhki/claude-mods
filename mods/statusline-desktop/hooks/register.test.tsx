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

// A session with a status line command, answered by fakes: the line reads
// "status". Returns what the command was piped on its last run.
function fakeSession(on: On): () => Record<string, unknown> {
  let stdin = '{}'
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
    const run = e as unknown as { argv: string[]; init?: { stdin?: string } }
    if (run.argv[0] === 'printenv') return { value: { exitCode: 0, stdout: '/h', stderr: '' } } as never
    stdin = run.init?.stdin ?? '{}'
    return { value: { exitCode: 0, stdout: 'status', stderr: '' } } as never
  })
  on('clock.now', () => ({ value: 61000 }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  return () => JSON.parse(stdin)
}

// Ends a turn and waits for the refresh it starts, which nothing awaits.
async function endTurn($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as never)
  const ui = await $.ui.mount({ plugin: 'statusline-desktop', surface: 'desktop', component: 'AbovePrompt', props: props as never })
  expect(await ui.find({ text: 'status' })).toBeDefined()
}

async function step($: Parameters<Parameters<typeof test>[1]>[0], input: Record<string, unknown>) {
  const stream = $.turn.step({ model: 'm', ...input } as never)
  for await (const _ of stream as AsyncIterable<unknown>) {
    // The chunks are not what this reads.
  }
}

// Stands for the engine's own drawing beneath the band.
function drawBeneath(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
}

test('the_line_gets_the_session_length', async ($, on) => {
  const piped = fakeSession(on)
  drawBeneath(on)
  await endTurn($)
  expect(piped().cost).toEqual({ total_duration_ms: 61000 })
})

test('the_line_gets_the_main_loops_effort_not_a_subagents', async ($, on) => {
  const piped = fakeSession(on)
  drawBeneath(on)
  on('turn.step', async function* () {
    return { answer: '', toolUses: [] } as never
  })
  await step($, { effort: 'high' })
  await step($, { effort: 'low', agentId: 'a' })
  await endTurn($)
  expect(piped().effort).toEqual({ level: 'high' })
})

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
