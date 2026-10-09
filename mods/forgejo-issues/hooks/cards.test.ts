import { describe, expect, test } from 'claude-code/testing'

import { packLabels, wrapTitle } from './cards'

describe('wrapTitle', () => {
  test('short_fits_one_line', async () => {
    expect(wrapTitle('Fix the bar', 20)).toEqual([{ text: 'Fix the bar', start: 0 }])
  })
  test('wraps_at_words_and_keeps_offsets', async () => {
    expect(wrapTitle('alpha beta gamma delta', 11)).toEqual([
      { text: 'alpha beta', start: 0 },
      { text: 'gamma delta', start: 11 },
    ])
  })
  test('third_line_is_cut_with_an_ellipsis', async () => {
    const lines = wrapTitle('aa bb cc dd ee ff gg hh', 5)
    expect(lines.length).toBe(3)
    expect(lines[2]!.text.endsWith('…')).toBe(true)
  })
  test('long_word_is_split', async () => {
    expect(wrapTitle('abcdefghij', 4, 5).map(l => l.text)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('packLabels', () => {
  test('scopes_split_and_lines_fill', async () => {
    const lines = packLabels(
      [
        { name: 'kind/bug', color: '#f00' },
        { name: 'enhancement', color: '#0f0' },
      ],
      2,
      26,
    )
    expect(lines.length).toBe(2)
    expect(lines[0]![0]).toMatchObject({ kind: 'label', scope: 'kind/', leaf: 'bug' })
    expect(lines[1]!.map(i => (i.kind === 'label' ? i.name : i.text))).toEqual(['enhancement', '2 comments'])
  })
  test('nothing_to_show_is_no_line', async () => {
    expect(packLabels([], 0, 40)).toEqual([])
  })
})
