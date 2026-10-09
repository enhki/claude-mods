export type LabelItem =
  | { kind: 'label'; name: string; color: string; scope: string | null; leaf: string }
  | { kind: 'comments'; text: string }

const MAX_TITLE_LINES = 3

/** Word-wraps `text` to lines of at most `width` characters, the last one cut with an ellipsis. */
export function wrapTitle(text: string, width: number, maxLines = MAX_TITLE_LINES): { text: string; start: number }[] {
  const lines: { text: string; start: number }[] = []
  let start = 0
  while (start < text.length && lines.length < maxLines) {
    while (text[start] === ' ') start++
    const rest = text.length - start
    if (rest <= width) {
      lines.push({ text: text.slice(start), start })
      return lines
    }
    if (lines.length === maxLines - 1) {
      lines.push({ text: `${text.slice(start, start + width - 1).trimEnd()}…`, start })
      return lines
    }
    const space = text.lastIndexOf(' ', start + width)
    const end = space > start ? space : start + width
    lines.push({ text: text.slice(start, end), start })
    start = end
  }
  return lines
}

/** Packs labels, then the comment count, into lines of at most `width` characters. */
export function packLabels(labels: { name: string; color: string }[], comments: number, width: number): LabelItem[][] {
  const items: LabelItem[] = labels.map(l => {
    const at = l.name.lastIndexOf('/')
    return at > 0
      ? { kind: 'label', name: l.name, color: l.color, scope: l.name.slice(0, at + 1), leaf: l.name.slice(at + 1) }
      : { kind: 'label', name: l.name, color: l.color, scope: null, leaf: l.name }
  })
  if (comments > 0) items.push({ kind: 'comments', text: comments === 1 ? '1 comment' : `${comments} comments` })
  const lines: LabelItem[][] = []
  let used = 0
  for (const item of items) {
    // "● name" plus the two-cell gap after it.
    const w = item.kind === 'label' ? item.name.length + 4 : item.text.length
    if (lines.length === 0 || used + w > width) {
      lines.push([item])
      used = w
    } else {
      lines[lines.length - 1]!.push(item)
      used += w
    }
  }
  return lines
}
