import type { ClientModule } from 'claude-code'

/**
 * A pressable control drawn as a Client: a click, Enter or Space posts
 * `{ press: id }` to the hooks module. The desktop app drops Button presses
 * from plugin panes, while Client messages arrive (claude-mods' desktop rules);
 * the terminal draws real Buttons instead, for their hotkeys.
 */
export type PillProps = {
  id: string
  label: string
  /** `button`: a bordered control; `row`: a line of text, underlined on hover. */
  kind: 'button' | 'row'
  /** A colour for the border at rest (buttons) or the text (rows). */
  tone?: string
  dim?: boolean
}

type Local = { hover: boolean }

const Pill: ClientModule<PillProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { hover: false }
  // Listeners are set once, on the first draw: each set is a message to the page.
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
  if (props.kind === 'row') {
    return (
      <Text color={props.tone} dimColor={props.dim && !state.hover} underline={state.hover}>
        {props.label}
      </Text>
    )
  }
  return (
    <Box flexDirection="row" borderStyle="round" borderColor={state.hover ? 'suggestion' : (props.tone ?? 'subtle')} paddingX={1}>
      <Text>{props.label}</Text>
    </Box>
  )
}

export default Pill
