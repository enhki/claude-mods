import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ACTIVE_PLAN, CATALOGUE, CHECK_OUTPUT, PARKED_PLAN, README, SPEC_ACCEPTED, SPEC_DRAFT, WORKSHEET } from './fixtures'

const BAND = {
  plugin: 'progress',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 } as never,
} as const

const LAB = {
  options: {
    worksheet: 'docs/prd/messaging-capability-worksheet.json',
    worksheetLabel: 'XEP',
    catalogue: 'docs/specs/catalogue.json',
    catalogueLabel: 'ILE',
  },
}

// The engine beneath the mod: the plans folder, the maps, git, the forge and a Bash tool.
function fakeEngine(on: On, opts: { forgeFails?: boolean | (() => boolean); noPlans?: boolean } = {}): string[][] {
  const runs: string[][] = []
  mock.clock(on)
  on('fs.list', ($, e) => {
    if (opts.noPlans) throw new Error('missing')
    // The engine resolves paths against the session's cwd before a hook sees them.
    if (e.path.endsWith('context/plans')) {
      return { value: [{ name: 'README.md', kind: 'file', size: 1 }, { name: 'solo.md', kind: 'file', size: 1 }, { name: 'stocktake.md', kind: 'file', size: 1 }] } as never
    }
    throw new Error('missing')
  })
  on('fs.exists', ($, e) => ({ value: !e.path.includes('ZZZ') }) as never)
  on('fs.read', ($, e) => {
    const files: Record<string, string> = {
      'context/plans/README.md': README,
      'context/plans/solo.md': PARKED_PLAN,
      'context/plans/stocktake.md': ACTIVE_PLAN,
      'docs/prd/messaging-capability-worksheet.json': WORKSHEET,
      'docs/specs/catalogue.json': CATALOGUE,
      'docs/specs/ILE-EXT-0001.md': SPEC_DRAFT,
      'docs/specs/ILE-OPS-0001.md': SPEC_ACCEPTED,
    }
    const text = Object.entries(files).find(([name]) => e.path.endsWith(name))?.[1]
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'connection refused' : '' } }) as never
    if (e.argv[0] === 'git' && e.argv[1] === 'remote') return out('ssh://git@git.abzu.dev:2222/Enunki/illusion-lab.git\n')
    if (e.argv[0] === 'git') return out('abc1234\n')
    const failing = typeof opts.forgeFails === 'function' ? opts.forgeFails() : opts.forgeFails === true
    if (failing) return out('', 1)
    if (e.argv.includes('issue')) return out('NUMBER  TITLE\n#150    review the contract   open\n#18     coordinate   open\n')
    return out('No open pull requests in Enunki/illusion-lab\n')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' }, text: CHECK_OUTPUT }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  return runs
}

const START = { cwd: '/r', surface: null, isInteractive: true }

// The test environment has a real timer; the engine's types leave it out.
declare const setTimeout: (fn: () => void, ms: number) => unknown

type Findable = { find: (q: { text: RegExp | string }) => Promise<unknown> }

// The forge refresh runs unawaited at start: wait for what it draws.
async function eventually(ui: Findable, text: RegExp): Promise<unknown> {
  for (let i = 0; i < 50; i++) {
    const found = await ui.find({ text })
    if (found) return found
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
  return undefined
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}_shows_the_active_plan_the_maps_and_the_queue_after_start`, LAB, async ($, on) => {
    fakeEngine(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /Stocktake follow-through/ })).toBeDefined()
    expect(await ui.find({ text: /slice 2 Progress mod · 1\/4 done · next G1/ })).toBeDefined()
    expect(await ui.find({ text: /must 1 · needed 1 · later 1 · no 0/ })).toBeDefined()
    expect(await ui.find({ text: /1 open/ })).toBeDefined()
    expect(await ui.find({ text: /3: accepted 1 · draft 1 · external 1/ })).toBeDefined()
    expect(await eventually(ui, /2 #150 #18/)).toBeDefined()
    expect(await ui.find({ text: 'beneath' })).toBeDefined()
  })

  test(`${surface}_a_check_run_becomes_the_gate_line`, LAB, async ($, on) => {
    fakeEngine(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: './scripts/check' } as never)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: 'check ExitSuccess 483/483' })).toBeDefined()
    expect(await ui.find({ text: /@abc1234/ })).toBeDefined()
  })
}

test('other_commands_leave_the_gate_alone', LAB, async ($, on) => {
  fakeEngine(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /ExitSuccess/ })).toBeUndefined()
})

test('a_forge_that_never_answered_stays_out_and_the_band_still_draws', LAB, async ($, on) => {
  fakeEngine(on, { forgeFails: true })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /slice 2/ })).toBeDefined()
  expect(await eventually(ui, /must 1/)).toBeDefined()
  expect(await ui.find({ text: /forge:/ })).toBeUndefined()
  expect(await ui.find({ text: /PRs/ })).toBeUndefined()
})

test('a_forge_that_answered_before_says_when_a_refresh_fails', LAB, async ($, on) => {
  const state = { fail: false }
  fakeEngine(on, { forgeFails: () => state.fail })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await eventually(ui, /2 #150 #18/)).toBeDefined()
  state.fail = true
  await $.tool.call({ tool: 'Bash', command: 'afj pr merge 169 -R Enunki/illusion-lab' } as never)
  expect(await eventually(ui, /forge: connection refused/)).toBeDefined()
  expect(await ui.find({ text: /2 #150 #18/ })).toBeDefined()
})

test('a_label_edit_refreshes_the_queue', LAB, async ($, on) => {
  const runs = fakeEngine(on)
  await $.session.start(START)
  const before = runs.filter(r => r[0] === 'fgj').length
  await $.tool.call({ tool: 'Bash', command: 'afj issue edit 150 -R Enunki/illusion-lab --remove-label status/review' } as never)
  expect(runs.filter(r => r[0] === 'fgj').length).toBe(before + 2)
})

test('without_a_plans_folder_or_maps_the_band_keeps_only_what_it_has', async ($, on) => {
  fakeEngine(on, { noPlans: true })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /slice/ })).toBeUndefined()
  expect(await ui.find({ text: /XEP/ })).toBeUndefined()
  expect(await eventually(ui, /review 2/)).toBeDefined()
})
