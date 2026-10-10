import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const band = {
  plugin: 'work-session',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
} as const

// The engine beneath the mod: which commands exist, a record of the ones run,
// and the session's usage.
function fakeEngine(on: On, commands: string[] = ['cws', 'ews'], percent = 10): string[] {
  const runs: string[] = []
  mock.clock(on)
  on('command.list', () => ({ value: commands.map(name => ({ name, description: '', source: 'projectSettings' })) }) as never)
  on('command.run', ($, e) => {
    runs.push(e.command)
    return { text: '' } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { percent, window: 200_000 } } }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  // No settings hooks configured: the classic events answer empty.
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  // What the engine (or a plugin beneath, like a desktop status line) draws in the band.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  return runs
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}_offers_the_kickoff_on_a_fresh_start`, async ($, on) => {
    fakeEngine(on)
    const result = await $.classic.SessionStart({ source: 'startup' } as never)
    expect(result.additionalContext?.some(c => c.includes('/cws'))).toBe(true)
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ text: /Kick off this session with \/cws/ })).toBeDefined()
    // Stacked over what is beneath, not drawn instead of it.
    expect(await ui.find({ text: 'beneath' })).toBeDefined()
  })

  test(`${surface}_pressing_the_kickoff_runs_the_start_command_and_hides_the_band`, async ($, on) => {
    const runs = fakeEngine(on)
    await $.classic.SessionStart({ source: 'startup' } as never)
    const ui = await $.ui.mount({ ...band, surface })
    if (surface === 'terminal') {
      await ui.press({ key: 'work-session:kickoff' })
    } else {
      await ui.post({ press: 'work-session:kickoff' }, { in: 'work-session:kickoff' })
    }
    expect(runs).toEqual(['cws'])
    expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
  })

  test(`${surface}_skip_hides_the_band_without_running_anything`, async ($, on) => {
    const runs = fakeEngine(on)
    await $.classic.SessionStart({ source: 'startup' } as never)
    const ui = await $.ui.mount({ ...band, surface })
    if (surface === 'terminal') {
      await ui.press({ key: 'work-session:skip' })
    } else {
      await ui.post({ press: 'work-session:skip' }, { in: 'work-session:skip' })
    }
    expect(runs).toEqual([])
    expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
  })

  test(`${surface}_offers_the_wrap_once_the_context_is_full`, async ($, on) => {
    fakeEngine(on, ['cws', 'ews'], 80)
    await $.classic.SessionStart({ source: 'resume' } as never)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as never)
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ text: /context 80% full/ })).toBeDefined()
  })
}

test('no_kickoff_where_the_project_has_no_start_command', async ($, on) => {
  fakeEngine(on, ['ews'])
  const result = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(result.additionalContext ?? []).toEqual([])
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
})

test('no_kickoff_on_resume', async ($, on) => {
  fakeEngine(on)
  await $.classic.SessionStart({ source: 'resume' } as never)
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
})

test('auto_mode_runs_the_start_command_without_a_band', { options: { kickoff: 'auto' } }, async ($, on) => {
  const runs = fakeEngine(on)
  await $.classic.SessionStart({ source: 'startup' } as never)
  expect(runs).toEqual(['cws'])
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
})

test('the_title_tool_sets_the_title_sent_with_each_prompt', async ($, on) => {
  fakeEngine(on)
  const before = await $.classic.UserPromptSubmit({ prompt: 'hi' } as never)
  expect(before.sessionTitle).toBeUndefined()
  await $.tool.call({ tool: 'mcp__work-session__set_session_title', title: ' Atlas S12 · Search filters ' } as never)
  const after = await $.classic.UserPromptSubmit({ prompt: 'next' } as never)
  expect(after.sessionTitle).toBe('Atlas S12 · Search filters')
})

test('a_rename_by_hand_hands_the_title_back', async ($, on) => {
  fakeEngine(on)
  await $.tool.call({ tool: 'mcp__work-session__set_session_title', title: 'Atlas S12 · x' } as never)
  await $.command.run({ command: 'rename', args: 'mine' } as never)
  const after = await $.classic.UserPromptSubmit({ prompt: 'next' } as never)
  expect(after.sessionTitle).toBeUndefined()
})
