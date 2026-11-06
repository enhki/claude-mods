/** Plans in the shape of a context/plans folder, a worksheet, a catalogue and its specifications. */

export const ACTIVE_PLAN = [
  '---',
  'title: Stocktake follow-through',
  'status: active',
  '---',
  '',
  '# Stocktake follow-through',
  '',
  '| # | Slice | Depends on | Status |',
  '|---|-------|------------|--------|',
  '| 1 | **Land the held baseline.** #154 then #153 | — | done #169 |',
  '| 2 | **Progress mod**, a band for plans, gates and maps | 1 | current |',
  '| 3 | **Solo experiment brief** under #147 and #24 | 2 | |',
  '| 4 | **G1 review gate** (a short session) | 3 | |',
].join('\n')

export const PARKED_PLAN = [
  '---',
  'title: Solo experiment',
  'status: parked',
  '---',
  '',
  '| # | Slice | Status |',
  '|---|-------|--------|',
  '| 1 | **Native loop** as the runtime | |',
].join('\n')

export const README = '# Plans\n\nOne file per plan; `status: active` marks the one the band shows.\n'

export const WORKSHEET = JSON.stringify({
  schema: 1,
  choices: ['must', 'needed', 'later', 'no'],
  rows: [
    { id: 'a', priority: 'must', proposed: { priority: 'must', reason: 'core' } },
    { id: 'b', priority: 'needed', proposed: { priority: 'later', reason: 'soon' } },
    { id: 'c', priority: '', proposed: { priority: 'no', reason: 'skip' } },
    { id: 'd', priority: 'later', proposed: { priority: 'later', reason: 'later' } },
  ],
})

export const CATALOGUE = JSON.stringify({
  schema_version: 1,
  canonical_repository: 'Enunki/illusion-lab',
  areas: { KRN: { title: 'Kernel' }, MSG: { title: 'Messaging' }, OPS: { title: 'Operations' } },
  specifications: [
    { id: 'ILE-EXT-0001', repository: 'Enunki/illusion-lab', path: 'docs/specs/ILE-EXT-0001.md', version: '0.1.0' },
    { id: 'ILE-OPS-0001', repository: 'Enunki/illusion-lab', path: 'docs/specs/ILE-OPS-0001.md', version: '0.1.0' },
    { id: 'ILE-ZZZ-0001', repository: 'Other/repo', path: 'docs/specs/ILE-ZZZ-0001.md', version: '0.1.0' },
  ],
})

export const SPEC_DRAFT = '---\nid: ILE-EXT-0001\nstatus: draft\n---\n# Spec\n'
export const SPEC_ACCEPTED = '---\nid: ILE-OPS-0001\nstatus: accepted\n---\n# Spec\n'

export const CHECK_OUTPUT = [
  '=== Test ===',
  'All 462 tests passed (3.82s)',
  'Test suite xmpp-tests: PASS',
  'All 21 tests passed (0.08s)',
  'Test: ExitSuccess',
  'Docs: ExitSuccess',
  '',
  'Requested checks complete: ExitSuccess',
].join('\n')

export const APPLICATION_OUTPUT = [
  '.............',
  '----------------------------------------------------------------------',
  'Ran 13 tests in 0.300s',
  '',
  'OK',
  '....................',
  '----------------------------------------------------------------------',
  'Ran 20 tests in 0.014s',
  '',
  'OK',
].join('\n')

export const RUNNER_OUTPUT = [
  'RUN runner-tests (deterministic; 120s limit)',
  'PASS runner-tests',
  'R009 pass: Fresh evidence, explicit gaps and owned processes',
  'Selected checks passed: True; application profile: partial',
  'Report: /tmp/x/report.json',
].join('\n')
