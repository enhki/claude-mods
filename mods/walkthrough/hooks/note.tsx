import type { ClientModule } from 'claude-code'

import { applyKey, caretPosition } from './editing'

/**
 * A step's note drawn as a Client on the desktop: the desktop's Input is one
 * line at a fixed width, so a long note ran out of sight. This one wraps and
 * grows with its text. It keeps the text locally and posts `{ note, text }`
 * every FLUSH_MS while it changes; Enter starts a new line. A republish
 * mounts fresh notes (the hooks module keys them by the walkthrough's rev).
 * The desktop passes no paste to a Client, so notes are typed.
 */
export type NoteProps = {
  step: number
  value: string
  placeholder: string
}

type Local = { text: string; caret: number; dirty: boolean }

const FLUSH_MS = 150

const Note: ClientModule<NoteProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const st: Local = surface.state ?? { text: props.value, caret: props.value.length, dirty: false }

  // Listeners are set once, on the first draw: each set is a message to the page.
  if (surface.state === undefined) {
    const step = props.step
    surface.every(FLUSH_MS, () => {
      const cur = surface.state
      if (!cur?.dirty) return
      surface.setState({ ...cur, dirty: false })
      surface.post({ note: step, text: cur.text })
    })
    surface.onKey(e => {
      const cur = surface.state ?? st
      const next = applyKey(cur, e.key, { ctrl: e.ctrl, meta: e.meta }, true)
      if (next && (next.text !== cur.text || next.caret !== cur.caret)) {
        surface.setState({ ...cur, ...next, dirty: cur.dirty || next.text !== cur.text })
      }
    })
    surface.setState(st)
  }

  const lines = st.text.split('\n')
  const at = caretPosition(st)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} minHeight={3}>
      {lines.map((line, i) => {
        if (i !== at.line) return <Text key={`l${i}`}>{line || ' '}</Text>
        const before = line.slice(0, at.col)
        const under = line.slice(at.col, at.col + 1)
        const after = line.slice(at.col + 1)
        return (
          <Box key={`l${i}`} flexDirection="row" flexWrap="wrap">
            {before && <Text>{before}</Text>}
            <Text inverse>{under || ' '}</Text>
            {after && <Text>{after}</Text>}
            {!st.text && <Text dimColor> {props.placeholder}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

export default Note
