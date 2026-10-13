/** Pure text editing for the note Client: a text and a caret (an index into it). Ported from forgejo-issues. */
export type Buffer = { text: string; caret: number }

function lineStart(text: string, at: number): number {
  return text.lastIndexOf('\n', at - 1) + 1
}

function lineEnd(text: string, at: number): number {
  const end = text.indexOf('\n', at)
  return end === -1 ? text.length : end
}

export function insert(b: Buffer, s: string): Buffer {
  return { text: b.text.slice(0, b.caret) + s + b.text.slice(b.caret), caret: b.caret + s.length }
}

function wordStart(text: string, at: number): number {
  let i = at
  while (i > 0 && /\s/.test(text[i - 1]!)) i--
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--
  return i
}

function wordEnd(text: string, at: number): number {
  let i = at
  while (i < text.length && /\s/.test(text[i]!)) i++
  while (i < text.length && !/\s/.test(text[i]!)) i++
  return i
}

/** Applies one key the Client received; null when the key is not an edit (submit, focus moves). */
export function applyKey(b: Buffer, key: string, mods: { ctrl?: boolean; meta?: boolean }, multiline: boolean): Buffer | null {
  const { text, caret } = b
  const word = Boolean(mods.ctrl || mods.meta)
  switch (key) {
    case 'left':
      return { text, caret: word ? wordStart(text, caret) : Math.max(0, caret - 1) }
    case 'right':
      return { text, caret: word ? wordEnd(text, caret) : Math.min(text.length, caret + 1) }
    case 'home':
      return { text, caret: lineStart(text, caret) }
    case 'end':
      return { text, caret: lineEnd(text, caret) }
    case 'up':
    case 'down': {
      const start = lineStart(text, caret)
      const col = caret - start
      if (key === 'up') {
        if (start === 0) return { text, caret: 0 }
        const prev = lineStart(text, start - 1)
        return { text, caret: Math.min(prev + col, start - 1) }
      }
      const end = lineEnd(text, caret)
      if (end === text.length) return { text, caret: text.length }
      const nextEnd = lineEnd(text, end + 1)
      return { text, caret: Math.min(end + 1 + col, nextEnd) }
    }
    case 'backspace': {
      if (caret === 0) return b
      const from = word ? wordStart(text, caret) : caret - 1
      return { text: text.slice(0, from) + text.slice(caret), caret: from }
    }
    case 'delete': {
      if (caret === text.length) return b
      const to = word ? wordEnd(text, caret) : caret + 1
      return { text: text.slice(0, caret) + text.slice(to), caret }
    }
    case 'return':
      return multiline && !word ? insert(b, '\n') : null
    case 'tab':
      return multiline ? insert(b, '  ') : null
    case 'space':
      return insert(b, ' ')
    default:
      // A printable character arrives as itself; any other named key is ignored.
      if ([...key].length === 1 && !mods.ctrl && !mods.meta) return insert(b, key)
      return null
  }
}

/** The caret's line and column, for drawing it. */
export function caretPosition(b: Buffer): { line: number; col: number } {
  const before = b.text.slice(0, b.caret)
  const line = before.split('\n').length - 1
  return { line, col: b.caret - lineStart(b.text, b.caret) }
}
