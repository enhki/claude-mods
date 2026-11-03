/**
 * Markdown pipe tables as lists: a pane is narrow, and the Markdown element
 * draws a wide table as a wrapped tangle. Each body row becomes a bullet whose
 * first cell leads and whose other cells follow as `header: cell`. Code
 * fences are left alone.
 */

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cur = ''
  let escaped = false
  for (const ch of trimmed) {
    if (escaped) {
      cur += ch
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

export function tablesToLists(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(line)
      i += 1
      continue
    }
    const next = lines[i + 1] ?? ''
    if (!inFence && line.trim().startsWith('|') && SEPARATOR.test(next)) {
      const headers = splitRow(line)
      i += 2
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const cells = splitRow(lines[i] ?? '')
        const [first, ...rest] = cells
        const tail = rest
          .map((c, j) => (c ? `${headers[j + 1] ?? `col ${j + 2}`}: ${c}` : ''))
          .filter(Boolean)
          .join(' · ')
        out.push(`- **${first ?? ''}**${tail ? ` — ${tail}` : ''}`)
        i += 1
      }
      // A blank line ends the list unless the source already has one.
      if (i >= lines.length || (lines[i] ?? '').trim() !== '') out.push('')
      continue
    }
    out.push(line)
    i += 1
  }
  return out.join('\n')
}
