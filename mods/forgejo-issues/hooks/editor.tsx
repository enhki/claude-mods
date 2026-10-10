import type { ClientModule } from 'claude-code'

import { applyFormat, applyKey, caretPosition } from './editing'
import type { Format } from '../types'

/**
 * A full-width text editor drawn as a Client: the desktop's Input is one
 * line at a fixed width. It keeps its text locally and posts `{ edit, text }`
 * (batched every FLUSH_MS) and `{ submit }` on Ctrl+Enter (Enter in a
 * one-line editor). The desktop passes no paste to a Client: long or pasted
 * text goes through the external editor instead.
 */
export type EditorProps = {
  id: string
  value: string
  /** Bumped by the hooks module when it replaces the text (cleared, imported); the editor then adopts `value`. */
  sync: number
  placeholder: string
  multiline: boolean
  preview: boolean
  minRows: number
  border: string
  /** A Markdown format to apply at the caret, run once per `seq`. */
  cmd: { seq: number; format: Format } | null
}

type Local = { text: string; caret: number; sync: number; cmdSeq: number; dirty: boolean }

const FLUSH_MS = 150

const Editor: ClientModule<EditorProps, Local> = (props, surface) => {
  const { Box, Text, Markdown } = surface.elements
  let st: Local = surface.state ?? { text: props.value, caret: props.value.length, sync: props.sync, cmdSeq: props.cmd?.seq ?? 0, dirty: false }

  if (surface.state === undefined) {
    // Set once (each set is a message to the page). The id and multiline-ness
    // belong to the editor's key, so the closures may keep them.
    const id = props.id
    const multiline = props.multiline
    const flush = () => {
      const cur = surface.state
      if (!cur?.dirty) return
      surface.setState({ ...cur, dirty: false })
      surface.post({ edit: id, text: cur.text })
    }
    surface.every(FLUSH_MS, flush)
    surface.onKey(e => {
      const cur = surface.state ?? st
      const submits = e.key === 'return' && (Boolean(e.ctrl || e.meta) || !multiline)
      if (submits) {
        flush()
        surface.post({ submit: id })
        return
      }
      const next = applyKey(cur, e.key, { ctrl: e.ctrl, meta: e.meta }, multiline)
      if (next && (next.text !== cur.text || next.caret !== cur.caret)) {
        surface.setState({ ...cur, ...next, dirty: cur.dirty || next.text !== cur.text })
      }
    })
    surface.setState(st)
  }

  // The hooks module replaced the text (a clear after posting, an import from the external editor).
  if (props.sync !== st.sync) {
    st = { ...st, text: props.value, caret: props.value.length, sync: props.sync, dirty: false }
    surface.setState(st)
  }
  // A toolbar press: apply the format at the caret, once.
  if (props.cmd && props.cmd.seq !== st.cmdSeq) {
    const next = applyFormat(st, props.cmd.format)
    st = { ...st, ...next, cmdSeq: props.cmd.seq, dirty: true }
    surface.setState(st)
  }

  const frame = (children: unknown) => (
    <Box flexDirection="column" borderStyle="round" borderColor={props.border} paddingX={1} minHeight={props.minRows + 2}>
      {children as never}
    </Box>
  )

  if (props.preview) {
    return frame(st.text.trim() ? <Markdown text={st.text} /> : <Text dimColor>Nothing to preview yet.</Text>)
  }

  const lines = st.text.split('\n')
  const at = caretPosition(st)
  return frame(
    lines.map((line, i) => {
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
    }),
  )
}

export default Editor
