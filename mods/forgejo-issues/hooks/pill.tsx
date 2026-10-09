import type { ClientModule } from 'claude-code'

/**
 * A pressable control drawn as a Client: a click posts `{ press: id }` to the
 * hooks module. Used in place of Button because the desktop app drops Button
 * presses for plugin panes (`ui_press not handled`), while Client messages
 * arrive; each control is its own Client so a click needs no hit-testing.
 */
export type PillProps = {
  id: string
  label: string
  /** `button`: a bordered control; `chip`: a coloured dot and text. */
  kind: 'button' | 'chip'
  active?: boolean
  /** A label colour, drawn as the chip's dot. */
  dot?: string
  /** A count drawn dim after the label. */
  count?: number
  /** Border colour at rest (buttons). */
  border?: string
}

type Local = { hover: boolean }

const Pill: ClientModule<PillProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { hover: false }
  // Set once on the first draw (each set is a message to the page; see
  // card.tsx). The id is the Client's key, so it never changes under them.
  if (surface.state === undefined) {
    const id = props.id
    surface.onPointer(e => {
      const cur = surface.state ?? { hover: false }
      if (e.type === 'leave') {
        if (cur.hover) surface.setState({ hover: false })
      } else if (!cur.hover) {
        surface.setState({ hover: true })
      }
      if (e.type === 'down' && (e.button ?? 'left') === 'left') surface.post({ press: id })
    })
    surface.onKey(e => {
      if (e.key === 'return' || e.key === ' ') surface.post({ press: id })
    })
    surface.setState(state)
  }

  const lit = state.hover
  const count = props.count === undefined ? null : <Text dimColor> {props.count}</Text>

  if (props.kind === 'chip') {
    return (
      <Box flexDirection="row">
        {props.dot && <Text color={props.dot}>● </Text>}
        <Text bold={props.active} underline={lit} dimColor={!props.active && !lit}>
          {props.active ? `✓ ${props.label}` : props.label}
        </Text>
        {count}
      </Box>
    )
  }
  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor={props.active || lit ? 'suggestion' : (props.border ?? 'subtle')}
      paddingX={1}
    >
      <Text bold={props.active} color={props.active ? 'suggestion' : undefined}>
        {props.label}
      </Text>
      {count}
    </Box>
  )
}

export default Pill
