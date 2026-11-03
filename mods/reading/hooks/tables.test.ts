import { expect, test } from 'claude-code/testing'

import { tablesToLists } from './tables'

test('a_pipe_table_becomes_a_list_with_its_headers', () => {
  const md = ['# Ledger', '', '| Date | Decision | Status |', '| --- | --- | --- |', '| 2026-11-02 | Own the client | agreed |', '| 2026-11-03 | JSON, not TOML | proposed |', '', 'After.'].join('\n')
  expect(tablesToLists(md)).toBe(
    ['# Ledger', '', '- **2026-11-02** — Decision: Own the client · Status: agreed', '- **2026-11-03** — Decision: JSON, not TOML · Status: proposed', '', 'After.'].join('\n'),
  )
})

test('escaped_pipes_and_empty_cells_are_kept_and_fences_are_left_alone', () => {
  const md = ['| A | B |', '| --- | --- |', '| x \\| y |  |', '', '```', '| not | a table |', '| --- | --- |', '```'].join('\n')
  expect(tablesToLists(md)).toBe(['- **x | y**', '', '```', '| not | a table |', '| --- | --- |', '```'].join('\n'))
})

test('text_without_tables_is_unchanged', () => {
  const md = 'one\n| lone pipe line\ntwo'
  expect(tablesToLists(md)).toBe(md)
})
