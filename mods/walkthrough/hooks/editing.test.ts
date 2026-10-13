import { describe, expect, test } from 'claude-code/testing'

import { applyKey, caretPosition, insert } from './editing'
import type { Buffer } from './editing'

const at = (text: string, caret = text.length): Buffer => ({ text, caret })
const key = (b: Buffer, k: string, mods: { ctrl?: boolean } = {}) => applyKey(b, k, mods, true)

describe('applyKey', () => {
  test('typing_space_and_return_build_a_multiline_note', async () => {
    expect(key(key(key(at('ab', 1), 'x')!, 'space')!, 'return')).toEqual({ text: 'ax \nb', caret: 4 })
  })
  test('backspace_and_delete_with_word_variants', async () => {
    expect(key(at('one two'), 'backspace')).toEqual({ text: 'one tw', caret: 6 })
    expect(key(at('one two'), 'backspace', { ctrl: true })).toEqual({ text: 'one ', caret: 4 })
    expect(key(at('one two', 0), 'delete')).toEqual({ text: 'ne two', caret: 0 })
    expect(key(at('', 0), 'backspace')).toEqual({ text: '', caret: 0 })
  })
  test('arrows_keep_columns_across_lines', async () => {
    const b = at('abcd\nxy\nlonger', 3)
    expect(key(b, 'down')).toEqual({ ...b, caret: 7 })
    expect(key({ ...b, caret: 10 }, 'up')).toEqual({ ...b, caret: 7 })
    expect(key({ ...b, caret: 6 }, 'home')).toEqual({ ...b, caret: 5 })
  })
  test('control_chords_are_not_text', async () => {
    expect(key(at('a'), 'b', { ctrl: true })).toBe(null)
    expect(key(at('a'), 'pageup')).toBe(null)
  })
})

describe('caretPosition', () => {
  test('line_and_column', async () => {
    expect(caretPosition(at('ab\ncd', 4))).toEqual({ line: 1, col: 1 })
    expect(caretPosition(insert(at('', 0), 'x'))).toEqual({ line: 0, col: 1 })
  })
})
