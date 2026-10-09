import type { ClientModule } from 'claude-code'

import { packLabels, wrapTitle } from './cards'

export type CardProps = {
  number: number
  title: string
  /** Title characters the search matched, drawn highlighted. */
  positions: number[]
  labels: { name: string; color: string }[]
  age: string
  comments: number
  closed: boolean
  numberWidth: number
  /** Border colour at rest. */
  border: string
  /** Characters per cell: above 1 where the surface draws a proportional font (the desktop). */
  textScale: number
}

type Local = { hover: boolean }

const AGE_COLS = 5
// The card's border and one-cell padding, each side.
const FRAME_COLS = 4

function segments(text: string, start: number, hits: Set<number>): { t: string; hi: boolean }[] {
  const out: { t: string; hi: boolean }[] = []
  ;[...text].forEach((ch, i) => {
    const hi = hits.has(start + i)
    const last = out[out.length - 1]
    if (last && last.hi === hi) last.t += ch
    else out.push({ t: ch, hi })
  })
  return out
}

/**
 * One issue as a card. Each card is its own Client, so a hover or a click
 * belongs to the card under the pointer whatever the surface makes of
 * borders and spacing (on the desktop a border is a thin line, not a row).
 */
const Card: ClientModule<CardProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { hover: false }
  // Listeners are set once, on the first draw: each set is a message to the
  // page, and a list of a hundred cards re-setting them on every redraw gets
  // its Clients unmounted for flooding it. A card's key is its issue number,
  // so the number the listeners close over never changes.
  if (surface.state === undefined) {
    const number = props.number
    surface.onPointer(e => {
      const cur = surface.state ?? { hover: false }
      if (e.type === 'leave') {
        if (cur.hover) surface.setState({ hover: false })
      } else if (!cur.hover) {
        surface.setState({ hover: true })
      }
      if (e.type === 'down' && (e.button ?? 'left') === 'left') surface.post({ open: number })
    })
    surface.onKey(e => {
      if (e.key === 'return') surface.post({ open: number })
    })
    surface.setState(state)
  }

  const inner = Math.max(20, (surface.columns || 80) - FRAME_COLS)
  const numberCols = props.numberWidth + 2
  const titleCols = Math.max(10, inner - numberCols - AGE_COLS)
  const titleLines = wrapTitle(props.title, Math.floor(titleCols * props.textScale))
  const labelLines = packLabels(props.labels, props.comments, Math.floor((inner - numberCols) * props.textScale))
  const hits = new Set(props.positions)
  const lit = state.hover

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={lit ? 'suggestion' : props.border} paddingX={1}>
      {titleLines.map((line, li) => (
        <Box key={`t${li}`} flexDirection="row">
          <Box width={numberCols} flexShrink={0}>
            <Text dimColor>{li === 0 ? `#${props.number}` : ''}</Text>
          </Box>
          <Box width={titleCols} flexShrink={0} flexDirection="row" overflow="hidden">
            {segments(line.text, line.start, hits).map((s, j) => (
              <Text
                key={`s${j}`}
                bold={s.hi || lit}
                color={s.hi ? 'warning' : undefined}
                dimColor={props.closed && !s.hi}
                strikethrough={props.closed}
                wrap="truncate-end"
              >
                {s.t}
              </Text>
            ))}
          </Box>
          <Box width={AGE_COLS} flexShrink={0} justifyContent="flex-end">
            <Text dimColor>{li === 0 ? props.age : ''}</Text>
          </Box>
        </Box>
      ))}
      {labelLines.map((line, li) => (
        <Box key={`l${li}`} flexDirection="row" paddingLeft={numberCols} overflow="hidden">
          {line.map(item =>
            item.kind === 'label' ? (
              <Box key={`lb${item.name}`} flexDirection="row" marginRight={2}>
                <Text color={item.color}>● </Text>
                {item.scope && <Text dimColor>{item.scope}</Text>}
                <Text dimColor wrap="truncate-end">
                  {item.leaf}
                </Text>
              </Box>
            ) : (
              <Text key="cm" dimColor>
                {item.text}
              </Text>
            ),
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Card
