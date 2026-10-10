import { describe, expect, test } from 'claude-code/testing'

import { applyFormat, applyKey, caretPosition, editorArgv, insert } from './editing'
import type { Buffer } from './editing'

const at = (text: string, caret = text.length): Buffer => ({ text, caret })
const key = (b: Buffer, k: string, mods: { ctrl?: boolean } = {}, multiline = true) => applyKey(b, k, mods, multiline)

describe('applyKey', () => {
  test('typing_and_space', async () => {
    expect(key(key(at('ab', 1), 'x')!, 'space')).toEqual({ text: 'ax b', caret: 3 })
  })
  test('return_is_a_newline_in_multiline_else_submit', async () => {
    expect(key(at('ab'), 'return')).toEqual({ text: 'ab\n', caret: 3 })
    expect(key(at('ab'), 'return', {}, false)).toBe(null)
    expect(key(at('ab'), 'return', { ctrl: true })).toBe(null)
  })
  test('backspace_and_delete_with_word_variants', async () => {
    expect(key(at('one two'), 'backspace')).toEqual({ text: 'one tw', caret: 6 })
    expect(key(at('one two'), 'backspace', { ctrl: true })).toEqual({ text: 'one ', caret: 4 })
    expect(key(at('one two', 0), 'delete')).toEqual({ text: 'ne two', caret: 0 })
    expect(key(at('', 0), 'backspace')).toEqual({ text: '', caret: 0 })
  })
  test('arrows_home_end_keep_columns_across_lines', async () => {
    const b = at('abcd\nxy\nlonger', 3)
    expect(key(b, 'down')).toEqual({ ...b, caret: 7 })
    expect(key({ ...b, caret: 7 }, 'down')).toEqual({ ...b, caret: 10 })
    expect(key({ ...b, caret: 10 }, 'up')).toEqual({ ...b, caret: 7 })
    expect(key({ ...b, caret: 6 }, 'home')).toEqual({ ...b, caret: 5 })
    expect(key({ ...b, caret: 6 }, 'end')).toEqual({ ...b, caret: 7 })
    expect(key(b, 'up')).toEqual({ ...b, caret: 0 })
  })
  test('control_chords_are_not_text', async () => {
    expect(key(at('a'), 'b', { ctrl: true })).toBe(null)
    expect(key(at('a'), 'pageup')).toBe(null)
  })
})

describe('applyFormat', () => {
  test('inline_marks_wrap_the_caret', async () => {
    expect(applyFormat(at('x ', 2), 'bold')).toEqual({ text: 'x ****', caret: 4 })
    expect(applyFormat(at('', 0), 'link')).toEqual({ text: '[](url)', caret: 1 })
  })
  test('line_marks_prefix_once', async () => {
    const b = applyFormat(at('a\nitem', 4), 'list')
    expect(b).toEqual({ text: 'a\n- item', caret: 6 })
    expect(applyFormat(b, 'list')).toEqual(b)
  })
})

describe('caretPosition', () => {
  test('line_and_column', async () => {
    expect(caretPosition(at('ab\ncd', 4))).toEqual({ line: 1, col: 1 })
    expect(caretPosition(insert(at('', 0), 'x'))).toEqual({ line: 0, col: 1 })
  })
})

describe('editorArgv', () => {
  test('replaces_file_and_honours_quotes', async () => {
    expect(editorArgv('ghostty --class=x -e nvim {file}', '/t/a.md')).toEqual(['ghostty', '--class=x', '-e', 'nvim', '/t/a.md'])
    expect(editorArgv('"my editor" --wait', '/t/a.md')).toEqual(['my editor', '--wait', '/t/a.md'])
  })
})
