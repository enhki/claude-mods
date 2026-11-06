import { expect, test } from 'claude-code/testing'

import { ACTIVE_PLAN, APPLICATION_OUTPUT, CATALOGUE, CHECK_OUTPUT, PARKED_PLAN, RUNNER_OUTPUT, WORKSHEET } from './fixtures'
import {
  age,
  catalogueSpecs,
  choosePlan,
  DEFAULT_GATE,
  exitStatus,
  frontmatter,
  gate,
  gateName,
  gateText,
  listedNumbers,
  parseRemote,
  queueText,
  sheetSummary,
  specsSummary,
  summaryLine,
  testCounts,
  touchesQueue,
  verdict,
} from './progress'

const GATE = new RegExp(DEFAULT_GATE)

test('frontmatter_reads_simple_pairs_only', () => {
  expect(frontmatter('---\ntitle: A plan\nstatus: Active\n---\nbody')).toEqual({ title: 'A plan', status: 'Active' })
  expect(frontmatter('# no frontmatter\n')).toEqual({})
  expect(frontmatter('---\nunterminated: yes\n')).toEqual({})
})

test('the_active_plan_is_chosen_among_several_with_its_slice_tally_and_gate', () => {
  const files = [
    { file: 'context/plans/solo.md', md: PARKED_PLAN },
    { file: 'context/plans/stocktake.md', md: ACTIVE_PLAN },
  ]
  expect(choosePlan(files)).toEqual({
    name: 'Stocktake follow-through',
    file: 'context/plans/stocktake.md',
    current: { id: '2', name: 'Progress mod' },
    done: 1,
    total: 4,
    nextGate: 'G1',
    plans: 2,
    active: 1,
  })
})

test('plans_without_an_active_one_say_so_and_an_explicit_file_wins', () => {
  const parked = [{ file: 'context/plans/solo.md', md: PARKED_PLAN }]
  expect(choosePlan(parked)).toMatchObject({ name: '', plans: 1, active: 0 })
  expect(choosePlan(parked, 'context/plans/solo.md')).toMatchObject({ name: 'Solo experiment', total: 1, current: null })
  expect(choosePlan([{ file: 'x.md', md: '# notes\nno table' }])).toBe(null)
  expect(choosePlan([])).toBe(null)
})

test('gate_names_come_from_cabal_and_the_check_scripts', () => {
  expect(gateName('cabal test > t.log 2>&1; echo $?', GATE)).toBe('cabal test')
  expect(gateName('cabal v2-build all --ghc-options=-Werror', GATE)).toBe('cabal build')
  expect(gateName('./scripts/check', GATE)).toBe('check')
  expect(gateName('cd /r && ILLUSION_CACHE=/x ./scripts/check-forge 2>&1 | tail -5', GATE)).toBe('check-forge')
  expect(gateName('scripts/check-illusion run --tier deterministic --output o', GATE)).toBe('check-illusion')
  expect(gateName('git status', GATE)).toBe(null)
  expect(gateName('cat scripts/check-forge', GATE)).toBe(null)
  expect(gateName('time ./scripts/check test', GATE)).toBe('check')
  expect(gateName('X=1 Y=2 scripts/check-application', GATE)).toBe('check-application')
})

test('the_exit_status_is_what_the_run_echoed_or_the_tool_said_and_null_when_piped', () => {
  const cmd = 'cabal build all --ghc-options=-Werror > /h/b.log 2>&1; echo "exit=$?"'
  expect(exitStatus(cmd, 'exit=0\n', false, GATE)).toBe(0)
  expect(exitStatus(cmd, 'exit=1\n', false, GATE)).toBe(1)
  expect(exitStatus('./scripts/check 2>&1 | tail -5', 'Requested checks complete: ExitSuccess', false, GATE)).toBe(null)
  expect(exitStatus('set -o pipefail; ./scripts/check 2>&1 | tail -5', '', false, GATE)).toBe(0)
  expect(exitStatus('./scripts/check', 'Exit code 1\nRequested checks complete: ExitFailure 1', true, GATE)).toBe(1)
  expect(exitStatus('./scripts/check && echo done', '', false, GATE)).toBe(0)
})

test('test_counts_sum_tasty_and_unittest_summaries', () => {
  expect(testCounts(CHECK_OUTPUT)).toEqual({ total: 483, failed: 0 })
  expect(testCounts(APPLICATION_OUTPUT)).toEqual({ total: 33, failed: 0 })
  expect(testCounts('3 out of 4679 tests failed (12s)')).toEqual({ total: 4679, failed: 3 })
  expect(testCounts('Ran 34 tests in 5.2s\n\nFAILED (failures=1, errors=2)')).toEqual({ total: 34, failed: 3 })
  expect(testCounts('Up to date')).toBe(null)
})

test('summary_lines_come_from_the_check_script_and_the_profile_runner', () => {
  expect(summaryLine(CHECK_OUTPUT)).toBe('ExitSuccess')
  expect(summaryLine('Requested checks complete: ExitFailure 1')).toBe('ExitFailure 1')
  expect(summaryLine(RUNNER_OUTPUT)).toBe('profile partial')
  expect(summaryLine('Selected checks passed: False; application profile: fail')).toBe('profile fail, selected failed')
  expect(summaryLine('All 4 tests passed')).toBe('')
})

test('a_gate_reads_its_outcome_and_words_itself', () => {
  const check = gate('check', './scripts/check', CHECK_OUTPUT, false, 'abc1234', 5, GATE)
  expect(check).toEqual({ name: 'check', exit: 0, total: 483, failed: 0, summary: 'ExitSuccess', werror: false, sha: 'abc1234', where: '', at: 5 })
  expect(verdict(check)).toBe('pass')
  expect(gateText(check)).toBe('check ExitSuccess 483/483')

  const failed = gate('check', './scripts/check', 'Test: ExitFailure 1\nRequested checks complete: ExitFailure 1', true, '', 0, GATE)
  expect(verdict(failed)).toBe('fail')
  expect(gateText(failed)).toBe('check ExitFailure 1 exit 1')

  const tests = gate('cabal test', 'cd ../FTWH-claude && cabal test 2>&1 > t.log; echo $?', 'All 10 tests passed\n0', false, 'abc', 5, GATE)
  expect(gateText(tests)).toBe('tests 10/10')
  expect(tests.where).toBe('FTWH-claude')

  const piped = gate('cabal build', 'cabal build all --ghc-options=-Werror | tail', '', false, '', 0, GATE)
  expect(verdict(piped)).toBe('unknown')
  expect(gateText(piped)).toBe('build -Werror (piped, exit unverified)')

  const runner = gate('check-illusion', 'scripts/check-illusion run --tier deterministic --output o', RUNNER_OUTPUT, true, '', 0, GATE)
  expect(gateText(runner)).toBe('check-illusion profile partial exit 1')
  expect(verdict(runner)).toBe('fail')
})

test('the_worksheet_tally_counts_choices_open_rows_and_overrides', () => {
  expect(sheetSummary(WORKSHEET, 'XEP')).toEqual({
    label: 'XEP',
    counts: [
      { choice: 'must', n: 1 },
      { choice: 'needed', n: 1 },
      { choice: 'later', n: 1 },
      { choice: 'no', n: 0 },
    ],
    open: 1,
    overrides: 1,
  })
  expect(sheetSummary('not json', 'XEP')).toBe(null)
  expect(sheetSummary('{"rows":[]}', 'XEP')).toBe(null)
})

test('the_catalogue_tally_ranks_specification_statuses', () => {
  const cat = catalogueSpecs(CATALOGUE)
  expect(cat).toEqual({ paths: ['docs/specs/ILE-EXT-0001.md', 'docs/specs/ILE-OPS-0001.md', 'docs/specs/ILE-ZZZ-0001.md'], areas: 3 })
  const specs = specsSummary(cat!.paths, cat!.areas, { 'docs/specs/ILE-EXT-0001.md': 'draft', 'docs/specs/ILE-OPS-0001.md': 'draft', 'docs/specs/ILE-ZZZ-0001.md': 'external' }, 'ILE')
  expect(specs).toEqual({ label: 'ILE', total: 3, statuses: [{ status: 'draft', n: 2 }, { status: 'external', n: 1 }], areas: 3 })
  expect(catalogueSpecs('[]')).toEqual({ paths: [], areas: 0 })
})

test('forge_lists_remotes_and_the_commands_that_change_the_queue', () => {
  expect(listedNumbers('NUMBER  TITLE\n#164    assess   open\n#150    review  open\n\nShowing page 1')).toEqual([164, 150])
  expect(listedNumbers('No open pull requests in Enunki/illusion-lab')).toEqual([])
  expect(touchesQueue('afj issue edit 150 --remove-label status/review')).toBe(true)
  expect(touchesQueue('afj pr merge 169 --merge-method rebase -R Enunki/illusion-lab')).toBe(true)
  expect(touchesQueue('afj issue list -R Enunki/illusion-lab')).toBe(false)
  expect(parseRemote('ssh://git@git.abzu.dev:2222/Enunki/illusion-lab.git')).toEqual({ host: 'git.abzu.dev', owner: 'Enunki', repo: 'illusion-lab' })
  expect(parseRemote('git@github.com:enhki/claude-mods.git')).toEqual({ host: 'github.com', owner: 'enhki', repo: 'claude-mods' })
  expect(parseRemote('not a remote')).toBe(null)
})

test('ages_and_queues_read_short', () => {
  expect(age(30_000)).toBe('now')
  expect(age(12 * 60_000)).toBe('12m')
  expect(age(5 * 3_600_000)).toBe('5h')
  expect(age(3 * 86_400_000)).toBe('3d')
  expect(queueText([1, 2, 3, 4, 5])).toBe('#1 #2 #3 +2')
})
