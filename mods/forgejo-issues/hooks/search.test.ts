import { describe, expect, test } from 'claude-code/testing'

import type { Issue, Ui } from '../types'
import { filterIssues, fuzzy, groupRows, parseQuery } from './search'

const issue = (number: number, title: string, labels: string[], milestone: string | null, extra: Partial<Issue> = {}): Issue => ({
  number,
  title,
  body: '',
  state: 'open',
  comments: 0,
  updatedAt: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`,
  url: '',
  author: 'me',
  labels: labels.map(name => ({ name, color: '#888888' })),
  milestone,
  ...extra,
})

const ISSUES = [
  issue(1, 'Theme mode axis', ['enhancement', 'kind/feature'], 'Theming'),
  issue(2, 'Handshake timeouts at boot', ['bug', 'kind/bug'], 'Networking'),
  issue(3, 'Folder icons follow the theme accent', ['enhancement', 'research'], 'Theming'),
  issue(4, 'Old closed thing', ['bug'], null, { state: 'closed' }),
]
const UI: Pick<Ui, 'query' | 'chips' | 'milestone' | 'state'> = { query: '', chips: [], milestone: '', state: 'open' }
const numbers = (q: Partial<typeof UI>) => filterIssues(ISSUES, { ...UI, ...q }).map(r => r.issue.number)

describe('parseQuery', () => {
  test('filters_terms_and_quotes', async () => {
    expect(parseQuery('theme label:bug -l:research milestone:"Theming System" is:all axis')).toEqual({
      terms: ['theme', 'axis'],
      labels: ['bug'],
      notLabels: ['research'],
      milestones: ['theming system'],
      state: 'all',
    })
  })

  test('unknown_keys_stay_search_terms', async () => {
    expect(parseQuery('foo:bar').terms).toEqual(['foo:bar'])
  })
})

describe('fuzzy', () => {
  test('subsequence_with_positions', async () => {
    expect(fuzzy('Theme mode', 'thm')?.positions).toEqual([0, 1, 3])
  })

  test('no_match_is_null', async () => {
    expect(fuzzy('Theme', 'xyz')).toBe(null)
  })

  test('word_starts_and_runs_score_higher', async () => {
    const tight = fuzzy('mode axis', 'axis')!.score
    const scattered = fuzzy('a long x i s', 'axis')!.score
    expect(tight).toBeGreaterThan(scattered)
  })
})

describe('filterIssues', () => {
  test('open_by_default_newest_first', async () => {
    expect(numbers({})).toEqual([3, 2, 1])
  })

  test('state_from_toggle_or_query', async () => {
    expect(numbers({ state: 'closed' })).toEqual([4])
    expect(numbers({ query: 'is:all' })).toEqual([4, 3, 2, 1])
  })

  test('fuzzy_ranks_and_reports_title_positions', async () => {
    const rows = filterIssues(ISSUES, { ...UI, query: 'theme' })
    expect(rows.map(r => r.issue.number)).toEqual([1, 3])
    expect(rows[0]!.positions).toEqual([0, 1, 2, 3, 4])
  })

  test('issue_number_is_searchable', async () => {
    expect(numbers({ query: '#2' })).toEqual([2])
  })

  test('label_syntax_and_scopes', async () => {
    expect(numbers({ query: 'label:bug' })).toEqual([2])
    expect(numbers({ query: 'label:kind/' })).toEqual([2, 1])
    expect(numbers({ query: 'label:kind' })).toEqual([2, 1])
    expect(numbers({ query: 'label:feature' })).toEqual([1])
    expect(numbers({ query: '-label:enhancement' })).toEqual([2])
  })

  test('chips_and_milestones', async () => {
    expect(numbers({ chips: ['enhancement', 'research'] })).toEqual([3])
    expect(numbers({ milestone: 'Theming' })).toEqual([3, 1])
    expect(numbers({ milestone: '-', state: 'all' })).toEqual([4])
    expect(numbers({ query: 'm:netw' })).toEqual([2])
  })
})

describe('groupRows', () => {
  test('milestone_order_then_none_last', async () => {
    const rows = filterIssues(ISSUES, { ...UI, state: 'all' })
    const groups = groupRows(rows, [
      { title: 'Networking', open: 1, closed: 0 },
      { title: 'Theming', open: 2, closed: 0 },
    ])
    expect(groups.map(g => [g.title, g.rows.map(r => r.issue.number)])).toEqual([
      ['Networking', [2]],
      ['Theming', [3, 1]],
      ['No milestone', [4]],
    ])
  })
})
