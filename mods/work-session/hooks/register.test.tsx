import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const band = {
  plugin: 'work-session',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
} as const

type Engine = { runs: string[]; bound: boolean; files: string[]; appTitles: string[]; appTool: boolean; unbound: boolean; clock: ReturnType<typeof mock.clock> }

// The engine beneath the mod: which commands exist, a record of the ones run,
// and the session's usage. Like the real engine, it lists commands only once the
// session is bound, which is after SessionStart (`unbound`: never, as headless).
function fakeEngine(on: On, commands: string[] = ['cws', 'ews'], percent = 10): Engine {
  const eng: Engine = { runs: [], bound: false, files: [], appTitles: [], appTool: false, unbound: false, clock: mock.clock(on) }
  const runs = eng.runs
  on('command.list', () => {
    if (!eng.bound) throw new Error('$.command.list is not available in this mode: no session is bound in this process')
    return { value: commands.map(name => ({ name, description: '', source: 'projectSettings' })) } as never
  })
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('fs.exists', ($, e) => ({ value: eng.files.includes(e.path) }) as never)
  on('tool.list', () => ({ value: eng.appTool ? [{ name: 'mcp__ccd_session_mgmt__set_session_title' }] : [] }) as never)
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__set_session_title' }, ($, e) => {
    eng.appTitles.push((e as unknown as { title: string }).title)
    return { result: 'renamed' } as never
  })
  on('classic.SessionStart', () => {
    eng.bound = !eng.unbound
    return {}
  })
  on('command.run', ($, e) => {
    runs.push(e.command)
    return { text: '' } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { percent, window: 200_000 } } }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  // No settings hooks configured: the classic events answer empty.
  on('classic.UserPromptSubmit', () => ({}))
  // What the engine (or a plugin beneath, like a desktop status line) draws in the band.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  return eng
}

// A fresh start, then the moment the terminal mounts and the settle timer finds the commands.
async function start($: Parameters<TestBody>[0], eng: Engine) {
  await $.classic.SessionStart({ source: 'startup' } as never)
  await eng.clock.advance(250)
}

// The person sends a message from the composer: prompt.submit, then the classic hook.
async function send($: Parameters<TestBody>[0], text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  return $.classic.UserPromptSubmit({ prompt: text } as never)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}_offers_the_kickoff_on_a_fresh_start`, async ($, on) => {
    const eng = fakeEngine(on)
    await start($, eng)
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ text: /Kick off this session with \/cws/ })).toBeDefined()
    // Stacked over what is beneath, not drawn instead of it.
    expect(await ui.find({ text: 'beneath' })).toBeDefined()
  })

  test(`${surface}_pressing_the_kickoff_runs_the_start_command_and_hides_the_band`, async ($, on) => {
    const eng = fakeEngine(on)
    const { runs } = eng
    await start($, eng)
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
    const eng = fakeEngine(on)
    const { runs } = eng
    await start($, eng)
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

// The desktop app starts the session with the first message, so nothing could be
// offered before it: that message settles the kickoff instead of skipping it.
test('desktop_first_message_settles_the_kickoff_and_tells_the_model', async ($, on) => {
  fakeEngine(on)
  await $.classic.SessionStart({ source: 'startup' } as never)
  const first = await send($, 'hey')
  expect(first.additionalContext?.some(c => c.includes('/cws'))).toBe(true)
  const ui = await $.ui.mount({ ...band, surface: 'desktop' })
  expect(await ui.find({ text: /Kick off this session with \/cws/ })).toBeDefined()
  // The next message is the person choosing to do something else.
  const second = await send($, 'something else')
  expect(second.additionalContext ?? []).toEqual([])
  expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
})

test('terminal_typing_instead_skips_the_band_but_still_tells_the_model', async ($, on) => {
  const eng = fakeEngine(on)
  await start($, eng)
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  const first = await send($, 'hey')
  expect(first.additionalContext?.some(c => c.includes('/cws'))).toBe(true)
  expect(await ui.find({ text: /Kick off/ })).toBeUndefined()
})

test('the_last_settle_try_reads_the_project_files', async ($, on) => {
  const eng = fakeEngine(on)
  eng.unbound = true
  eng.files.push('/r/.claude/skills/cws/SKILL.md')
  await $.classic.SessionStart({ source: 'startup' } as never)
  await eng.clock.advance(250 * 20)
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ text: /Kick off this session with \/cws/ })).toBeDefined()
})

test('session_start_survives_an_unbound_command_list', async ($, on) => {
  const eng = fakeEngine(on)
  eng.unbound = true
  await $.classic.SessionStart({ source: 'startup' } as never)
  // Still unbound at the first prompt: the project's command file answers.
  eng.files.push('/r/.claude/commands/cws.md')
  const first = await send($, 'hey')
  expect(first.additionalContext?.some(c => c.includes('/cws'))).toBe(true)
})

test('no_kickoff_where_the_project_has_no_start_command', async ($, on) => {
  const eng = fakeEngine(on, ['ews'])
  await start($, eng)
  const first = await send($, 'hey')
  expect(first.additionalContext ?? []).toEqual([])
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
  const eng = fakeEngine(on)
  await start($, eng)
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(eng.runs).toEqual(['cws'])
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

test('the_title_tool_also_renames_the_session_in_the_desktop_app', async ($, on) => {
  const eng = fakeEngine(on)
  eng.appTool = true
  await $.tool.call({ tool: 'mcp__work-session__set_session_title', title: 'Atlas S12 · x' } as never)
  expect(eng.appTitles).toEqual(['Atlas S12 · x'])
})

test('the_title_tool_leaves_the_app_alone_where_it_has_no_rename_tool', async ($, on) => {
  const eng = fakeEngine(on)
  await $.tool.call({ tool: 'mcp__work-session__set_session_title', title: 'Atlas S12 · x' } as never)
  expect(eng.appTitles).toEqual([])
})

const nudged = (r: { additionalContext?: string[] }) => (r.additionalContext ?? []).some(c => c.includes('has no title yet'))

test('the_message_after_the_kickoff_reminds_the_model_to_title', async ($, on) => {
  const eng = fakeEngine(on)
  await start($, eng)
  await $.command.run({ command: 'cws', args: '' } as never)
  const kickoff = await $.classic.UserPromptSubmit({ prompt: '/cws' } as never)
  expect(kickoff.additionalContext?.some(c => c.includes('kicks off'))).toBe(true)
  expect(nudged(kickoff)).toBe(false)
  expect(nudged(await send($, 'the parser'))).toBe(true)
  await $.tool.call({ tool: 'mcp__work-session__set_session_title', title: 'P S7 · Parser' } as never)
  expect(nudged(await send($, 'next'))).toBe(false)
})

test('title_reminders_stop_after_two', async ($, on) => {
  const eng = fakeEngine(on)
  await start($, eng)
  await $.command.run({ command: 'cws', args: '' } as never)
  await $.classic.UserPromptSubmit({ prompt: '/cws' } as never)
  const results = [await send($, 'a'), await send($, 'b'), await send($, 'c')]
  expect(results.map(nudged)).toEqual([true, true, false])
})

test('no_title_reminder_without_the_kickoff', async ($, on) => {
  const eng = fakeEngine(on)
  await start($, eng)
  await send($, 'hey')
  expect(nudged(await send($, 'more'))).toBe(false)
})
