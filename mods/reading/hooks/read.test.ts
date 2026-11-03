import { expect, test } from 'claude-code/testing'

import { EMPTY, issueArgv, keyOf, label, mark, merge, parse, parseLines, parseRemote, results, slice, tally, whole } from './read'

const INPUT = {
  title: 'Session inputs',
  items: [
    { title: 'The ledger', path: 'docs/decisions.md', why: 'index of what is agreed' },
    { title: 'A section', path: 'docs/plan.md', heading: 'Scope' },
    { title: 'Some lines', path: 'docs/plan.md', lines: '5-15' },
    { title: 'The issue', issue: 12 },
    { title: 'A link', url: 'https://example.test/page' },
    { title: 'A note', text: 'Read **this**.' },
  ],
}

function list() {
  const p = parse(INPUT)
  if ('error' in p) throw new Error(p.error)
  return p.reading
}

test('a_list_needs_a_title_and_items_with_exactly_one_source', () => {
  expect(parse({ items: INPUT.items })).toEqual({ error: 'title is required' })
  expect('error' in parse({ title: 't', items: [] })).toBe(true)
  expect(parse({ title: 't', items: [{ title: 'x' }] })).toEqual({ error: 'item 1 ("x"): give exactly one of path, issue, url or text' })
  expect(parse({ title: 't', items: [{ title: 'x', path: 'a.md', issue: 3 }] })).toEqual({
    error: 'item 1 ("x"): give exactly one of path, issue, url or text',
  })
  expect(parse({ title: 't', items: [{ title: 'x', path: 'a.md', lines: 'five' }] })).toEqual({
    error: 'item 1 ("x"): lines must look like 5-15, not "five"',
  })
  expect(parse({ title: 't', items: [{ title: 'x', url: 'ftp://nope' }] })).toEqual({
    error: 'item 1 ("x"): url must start with http:// or https://',
  })
  expect(parse({ title: 't', items: [{ title: 'x', path: 'a.md' }, { title: 'y', path: 'a.md' }] })).toEqual({
    error: 'item 2 ("y") repeats a.md',
  })
  const r = list()
  expect(r.items.map(it => it.mark)).toEqual(['unread', 'unread', 'unread', 'unread', 'unread', 'unread'])
  expect(r.items[2]?.source).toEqual({ kind: 'file', path: 'docs/plan.md', lines: [5, 15] })
  expect(r.items[3]?.source).toEqual({ kind: 'issue', repo: '', number: 12 })
})

test('lines_parse_as_inclusive_ranges', () => {
  expect(parseLines('5-15')).toEqual([5, 15])
  expect(parseLines('12')).toEqual([12, 12])
  expect(parseLines(7)).toEqual([7, 7])
  expect(parseLines('15-5')).toBe(null)
  expect(parseLines('0-3')).toBe(null)
})

test('keys_and_labels_name_the_source', () => {
  const r = list()
  expect(r.items.map(it => keyOf(it.source))).toEqual([
    'file:docs/decisions.md',
    'file:docs/plan.md#scope',
    'file:docs/plan.md:5-15',
    'issue:#12',
    'url:https://example.test/page',
    `text:${keyOf({ kind: 'text', text: 'Read **this**.' }).slice(5)}`,
  ])
  expect(r.items.map(it => label(it.source))).toEqual([
    'docs/decisions.md',
    'docs/plan.md § Scope',
    'docs/plan.md:5-15',
    '#12',
    'https://example.test/page',
    'note',
  ])
  expect(label({ kind: 'issue', repo: 'o/r', number: 4 })).toBe('o/r#4')
})

test('a_republish_merges_by_source_and_keeps_marks_and_comments', () => {
  let prev = mark(list(), 'file:docs/decisions.md', 'acknowledged')
  prev = { ...prev, items: prev.items.map(it => (it.key === 'issue:#12' ? { ...it, comment: 'why 12?', content: 'body' } : it)) }
  const next = parse({ title: 'Round two', items: [{ title: 'The issue, retitled', issue: 12 }, { title: 'New', path: 'new.md' }] })
  if ('error' in next) throw new Error(next.error)
  const merged = merge(prev, next.reading, false)
  expect(merged.title).toBe('Round two')
  expect(merged.rev).toBe(1)
  expect(merged.items.map(it => it.key)).toEqual([...prev.items.map(it => it.key), 'file:new.md'])
  const issue = merged.items.find(it => it.key === 'issue:#12')
  expect(issue?.title).toBe('The issue, retitled')
  expect(issue?.comment).toBe('why 12?')
  expect(issue?.content).toBe('body')
  expect(merged.items[0]?.mark).toBe('acknowledged')
  const replaced = merge(prev, next.reading, true)
  expect(replaced.items.map(it => it.key)).toEqual(['issue:#12', 'file:new.md'])
  expect(replaced.items[0]?.comment).toBe('')
})

test('marking_an_item_the_same_way_again_takes_the_mark_back', () => {
  const r = mark(mark(list(), 'issue:#12', 'discuss'), 'issue:#12', 'discuss')
  expect(r.items[3]?.mark).toBe('unread')
  expect(mark(list(), 'missing', 'read')).toEqual(list())
})

test('a_slice_takes_a_line_range_or_a_heading_section', () => {
  const doc = ['# Title', 'intro', '## Scope', 'one', 'two', '### Detail', 'three', '## Next', 'four'].join('\n')
  expect(slice(doc, { kind: 'file', path: 'p', lines: [2, 4] })).toBe('intro\n## Scope\none')
  expect(slice(doc, { kind: 'file', path: 'p', heading: 'scope' })).toBe('## Scope\none\ntwo\n### Detail\nthree')
  expect(slice(doc, { kind: 'file', path: 'p', heading: 'Detail' })).toBe('### Detail\nthree')
  expect(slice(doc, { kind: 'file', path: 'p', heading: 'Nex' })).toBe('## Next\nfour')
  expect(slice(doc, { kind: 'file', path: 'p', heading: 'absent' })).toBe(doc)
  expect(slice(doc, { kind: 'file', path: 'p' })).toBe(doc)
})

test('results_carry_every_item_with_its_mark_and_comment', () => {
  let r = mark(list(), 'file:docs/decisions.md', 'acknowledged')
  r = mark(r, 'issue:#12', 'discuss')
  r = { ...r, items: r.items.map(it => (it.key === 'issue:#12' ? { ...it, comment: '  needs\n a date ' } : it)) }
  expect(tally(r)).toEqual({ unread: 4, read: 0, acknowledged: 1, discuss: 1 })
  expect(results(r).split('\n').slice(0, 5)).toEqual([
    'Reading results for "Session inputs": 1 acknowledged, 0 read, 1 to discuss, 4 unread.',
    '1. ACKNOWLEDGED: The ledger [docs/decisions.md]',
    '2. UNREAD: A section [docs/plan.md § Scope]',
    '3. UNREAD: Some lines [docs/plan.md:5-15]',
    '4. DISCUSS: The issue [#12] (comment: needs a date)',
  ])
})

test('saved_state_is_made_whole', () => {
  expect(whole(undefined)).toEqual(EMPTY)
  const w = whole({ title: 't', items: [{ key: 'file:a', title: 'a', source: { kind: 'file', path: 'a' } } as never, null as never] })
  expect(w.items).toEqual([{ key: 'file:a', title: 'a', source: { kind: 'file', path: 'a' }, why: '', mark: 'unread', comment: '' }])
  expect(w.open).toBe(null)
})

test('a_git_remote_names_its_host_and_repo', () => {
  expect(parseRemote('git@forge.test:owner/repo.git\n')).toEqual({ host: 'forge.test', repo: 'owner/repo' })
  expect(parseRemote('ssh://git@forge.test:2222/owner/repo.git')).toEqual({ host: 'forge.test', repo: 'owner/repo' })
  expect(parseRemote('https://forge.test/owner/repo')).toEqual({ host: 'forge.test', repo: 'owner/repo' })
  expect(parseRemote('not a remote')).toBe(null)
})

test('the_issue_command_fills_its_template_or_falls_back_to_fgj', () => {
  const remote = { host: 'forge.test', repo: 'owner/repo' }
  expect(issueArgv('', remote, '', 12)).toEqual(['fgj', '--hostname', 'forge.test', 'issue', 'view', '12', '-R', 'owner/repo'])
  expect(issueArgv('', remote, 'other/one', 3)).toEqual(['fgj', '--hostname', 'forge.test', 'issue', 'view', '3', '-R', 'other/one'])
  expect(issueArgv('mycli issue show {number} --repo {repo}', null, 'o/r', 5)).toEqual(['mycli', 'issue', 'show', '5', '--repo', 'o/r'])
  expect(issueArgv('', null, '', 5)).toBe(null)
  expect(issueArgv('', null, 'o/r', 5)).toBe(null)
})
