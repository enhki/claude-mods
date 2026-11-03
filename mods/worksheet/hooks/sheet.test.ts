import { expect, test } from 'claude-code/testing'

import { applyProposals, counts, edit, EMPTY, filterRows, membershipLabel, parseConfig, parseWorksheet, patchFile, summary, whole } from './sheet'

const FILE = {
  schema: 1,
  title: 'Sheet',
  choices: ['must', 'needed', 'later', 'no'],
  render: 'scripts/render-worksheet',
  export: 'docs/x.md',
  sections: [
    { id: 'core', title: 'Core', kind: 'capabilities' },
    { id: 'extra', title: 'Extra', kind: 'capabilities' },
  ],
  rows: [
    {
      id: 'xep-0030',
      section: 'core',
      title: 'Discover features',
      references: [{ id: 'XEP-0030', url: 'https://example.test/30', version: '2.5.0', status: 'Final' }],
      role: 'Core C/S',
      suite: { membership: 'required', categories: ['Core'], levels: ['C/S'], flags: [] },
      priority: '',
      comment: '',
      proposed: { priority: 'must', reason: 'the experiment already needs it' },
    },
    {
      id: 'xep-0280',
      section: 'extra',
      title: 'Carbons',
      references: [{ id: 'XEP-0280', url: 'https://example.test/280', version: '1.0.1', status: 'Stable' }],
      role: 'IM C/S',
      suite: { membership: 'required', categories: ['IM'], levels: ['C/S'], flags: [] },
      priority: 'later',
      comment: 'one device first',
      proposed: { priority: 'needed', reason: 'multi-device' },
    },
    {
      id: 'xep-0449',
      section: 'extra',
      title: 'Stickers',
      references: [{ id: 'XEP-0449', url: 'https://example.test/449', version: '0.2.0', status: 'Experimental' }],
      role: 'Additional candidate',
      suite: { membership: 'additional', categories: [], levels: [], flags: [] },
      priority: '',
      comment: '',
      proposed: { priority: '', reason: '' },
    },
  ],
}

function sheet() {
  const p = parseWorksheet(JSON.stringify(FILE))
  if ('error' in p) throw new Error(p.error)
  return p.sheet
}

test('a_worksheet_needs_schema_one_choices_sections_and_rows', () => {
  expect(parseWorksheet('nope')).toEqual({ error: 'not JSON: JSON Parse error: Unexpected identifier "nope"' })
  expect(parseWorksheet('{}')).toEqual({ error: 'schema undefined is not 1' })
  expect(parseWorksheet(JSON.stringify({ schema: 1, choices: [] }))).toEqual({ error: 'choices is empty' })
  expect(parseWorksheet(JSON.stringify({ ...FILE, rows: [FILE.rows[0], FILE.rows[0]] }))).toEqual({ error: 'row id xep-0030 repeats' })
  const s = sheet()
  expect(s.rows.map(r => r.priority)).toEqual(['', 'later', ''])
  expect(s.rows[0]?.suite.categories).toEqual(['Core'])
  expect(s.render).toBe('scripts/render-worksheet')
})

test('filters_narrow_by_membership_category_priority_proposal_and_text', () => {
  const s = sheet()
  const f = { text: '', membership: '', category: '', priority: '', proposed: '' }
  expect(filterRows(s, f).map(r => r.id)).toEqual(['xep-0030', 'xep-0280', 'xep-0449'])
  expect(filterRows(s, { ...f, membership: 'additional' }).map(r => r.id)).toEqual(['xep-0449'])
  expect(filterRows(s, { ...f, category: 'IM' }).map(r => r.id)).toEqual(['xep-0280'])
  expect(filterRows(s, { ...f, priority: 'unset' }).map(r => r.id)).toEqual(['xep-0030', 'xep-0449'])
  expect(filterRows(s, { ...f, priority: 'later' }).map(r => r.id)).toEqual(['xep-0280'])
  expect(filterRows(s, { ...f, proposed: 'any' }).map(r => r.id)).toEqual(['xep-0030', 'xep-0280'])
  expect(filterRows(s, { ...f, proposed: 'differs' }).map(r => r.id)).toEqual(['xep-0030', 'xep-0280'])
  expect(filterRows(s, { ...f, text: '0280' }).map(r => r.id)).toEqual(['xep-0280'])
  expect(filterRows(s, { ...f, text: 'multi-device' }).map(r => r.id)).toEqual(['xep-0280'])
})

test('counts_tally_priorities_and_proposals', () => {
  expect(counts(sheet())).toEqual({ byPriority: { must: 0, needed: 0, later: 1, no: 0 }, unset: 2, proposals: 2, differs: 2 })
})

test('an_edit_changes_the_sheet_and_queues_one_change_per_row_and_field', () => {
  let s = { ...EMPTY, sheet: sheet(), path: 'x.json' }
  s = edit(s, 'xep-0030', 'priority', 'must')
  s = edit(s, 'xep-0030', 'priority', 'needed')
  s = edit(s, 'xep-0030', 'comment', 'fine')
  s = edit(s, 'missing', 'priority', 'must')
  expect(s.sheet?.rows[0]?.priority).toBe('needed')
  expect(s.pending).toEqual([
    { id: 'xep-0030', field: 'priority', from: '', to: 'needed' },
    { id: 'xep-0030', field: 'comment', from: '', to: 'fine' },
  ])
  expect(edit(s, 'xep-0030', 'comment', 'fine')).toBe(s)
})

test('a_patch_writes_the_changes_into_the_file_and_names_unknown_rows', () => {
  const data = JSON.parse(JSON.stringify(FILE))
  const missing = patchFile(data, [
    { id: 'xep-0280', field: 'priority', from: 'later', to: 'needed' },
    { id: 'xep-0280', field: 'comment', from: '', to: 'go' },
    { id: 'nope', field: 'priority', from: '', to: 'must' },
  ])
  expect(missing).toEqual(['nope'])
  expect(data.rows[1].priority).toBe('needed')
  expect(data.rows[1].comment).toBe('go')
  expect(data.export).toBe('docs/x.md')
})

test('proposals_land_beside_the_decision_and_refuse_unknown_choices', () => {
  const data = JSON.parse(JSON.stringify(FILE))
  const out = applyProposals(
    data,
    [
      { id: 'xep-0449', priority: 'No', reason: 'not now' },
      { id: 'xep-0280', priority: '', reason: '' },
      { id: 'nope', priority: 'must', reason: 'x' },
    ],
    ['must', 'needed', 'later', 'no'],
  )
  expect(out).toEqual({ applied: 2, missing: ['nope'], refused: [] })
  expect(data.rows[2].proposed).toEqual({ priority: 'no', reason: 'not now' })
  expect(data.rows[1].proposed).toEqual({ priority: '', reason: '' })
  expect(data.rows[1].priority).toBe('later')
  expect(applyProposals(data, [{ id: 'xep-0449', priority: 'maybe', reason: '' }], ['must']).refused).toEqual(['xep-0449: maybe'])
})

test('the_summary_names_each_changed_row_with_its_proposal', () => {
  const text = summary(sheet(), 'docs/x-worksheet.json', [
    { id: 'xep-0030', field: 'priority', from: '', to: 'must' },
    { id: 'xep-0280', field: 'priority', from: 'later', to: 'needed' },
    { id: 'xep-0280', field: 'comment', from: 'one device first', to: 'two  devices\nnow' },
  ])
  expect(text.split('\n')).toEqual([
    'Worksheet changes for "Sheet" (docs/x-worksheet.json): 2 priorities, 1 comment.',
    '- xep-0030 Discover features: priority unset → must (proposed must)',
    '- xep-0280 Carbons: priority later → needed (proposed needed); comment: "two devices now"',
  ])
})

test('config_and_saved_state_are_read_leniently', () => {
  expect(parseConfig('{"worksheets": ["a.json", " b.json ", 3]}')).toEqual(['a.json', 'b.json'])
  expect(parseConfig('{')).toEqual([])
  expect(parseConfig(null)).toEqual([])
  expect(whole(undefined)).toEqual(EMPTY)
  expect(whole({ paths: ['x'] as never, filter: { text: 'q' } as never }).filter).toEqual({ text: 'q', membership: '', category: '', priority: '', proposed: '' })
  expect(membershipLabel({ membership: 'required', categories: ['Mobile', 'IM'], levels: ['C/S', 'AC/AS'], flags: ['P'] })).toBe('Mobile C/S, IM AC/AS [P]')
  expect(membershipLabel({ membership: 'future', categories: [], levels: [], flags: [] })).toBe('suite future')
})
