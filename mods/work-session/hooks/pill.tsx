import type { ClientModule } from 'claude-code'

/**
 * A pressable control drawn as a Client: a click, Enter or Space posts
 * `{ press: id }` to the hooks module. The desktop app drops Button presses
 * from plugin UI, while Client messages arrive (claude-mods' desktop rules);
 * the terminal draws real Buttons instead, for their digit hotkeys.
 */
export type PillProps = { id: string; label: string; hotkey: string }

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
  return (
    <Box flexDirection="row" borderStyle="round" borderColor={state.hover ? 'suggestion' : 'subtle'} paddingX={1}>
      <Text color="suggestion">{props.hotkey}</Text>
      <Text>: {props.label}</Text>
    </Box>
  )
}

export default Pill
