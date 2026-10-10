import { expect, test } from 'claude-code/testing'

import { EMPTY, mark, note, openStep, parse, results, tally, toggle, whole } from './walk'

const INPUT = {
  title: 'Sidebar resize',
  steps: [
    { title: 'Start the demo', run: 'make demo', where: '/r, 120x40', expect: 'Two panes' },
    { title: 'Shrink to 80x24', expect: 'The sidebar keeps 20 columns' },
    { title: 'Quit', expect: 'q exits cleanly' },
  ],
}

function walk() {
  const p = parse(INPUT)
  if ('error' in p) throw new Error(p.error)
  return p.walkthrough
}

test('a_walkthrough_needs_a_title_and_steps_that_say_what_to_expect', () => {
  expect(parse({ steps: INPUT.steps })).toEqual({ error: 'title is required' })
  expect('error' in parse({ title: 't', steps: [] })).toBe(true)
  expect(parse({ title: 't', steps: [{ title: 'x' }] })).toEqual({ error: 'step 1 ("x") says nothing about what to expect' })
  const w = walk()
  expect(w.marks).toEqual(['pending', 'pending', 'pending'])
  expect(w.steps[1]?.run).toBe('')
})

test('the_open_step_follows_the_first_unmarked_one', () => {
  let w = walk()
  expect(openStep(w)).toBe(0)
  w = mark(w, 0, 'pass')
  expect(openStep(w)).toBe(1)
  w = toggle(w, 2)
  expect(openStep(w)).toBe(2)
  w = toggle(w, 2)
  expect(openStep(w)).toBe(null)
  w = mark(w, 1, 'fail')
  expect(openStep(w)).toBe(2)
})

test('marking_a_step_the_same_way_again_takes_the_mark_back', () => {
  const w = mark(mark(walk(), 0, 'skip'), 0, 'skip')
  expect(w.marks[0]).toBe('pending')
  expect(mark(walk(), 9, 'pass')).toEqual(walk())
})

test('results_carry_every_step_with_its_note', () => {
  let w = mark(walk(), 0, 'pass')
  w = note(mark(w, 1, 'fail'), 1, '  sidebar\n overlaps ')
  expect(tally(w)).toEqual({ pending: 1, pass: 1, fail: 1, skip: 0 })
  expect(results(w)).toBe(
    [
      'Walkthrough results for "Sidebar resize": 1 passed, 1 failed, 1 not done.',
      '1. PASS: Start the demo',
      '2. FAIL: Shrink to 80x24 (note: sidebar overlaps)',
      '3. NOT DONE: Quit',
    ].join('\n'),
  )
})

test('saved_state_is_made_whole', () => {
  expect(whole(undefined)).toEqual(EMPTY)
  const w = whole({ title: 't', steps: walk().steps, marks: ['pass'] })
  expect(w.marks).toEqual(['pass', 'pending', 'pending'])
  expect(w.notes).toEqual(['', '', ''])
})
