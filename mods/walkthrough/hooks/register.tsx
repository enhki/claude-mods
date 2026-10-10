import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, RenderSurface, Register } from 'claude-code'

import type { Mark, Walkthrough } from '../types'
import { EMPTY, GLYPH, mark, note, openStep, parse, results, summary, tally, toggle, TOOL_DESCRIPTION, whole } from './walk'

const PANE = 'walkthrough'
const TOOL = 'publish_walkthrough'

const current = atom({ plugin: 'walkthrough', key: 'current' } as const, EMPTY)

// Saved state from an older version lacks newer fields: fill defaults on reads and updates.
const readWalk = async ($: $): Promise<Walkthrough> => whole(await read($, current))
const setWalk = ($: $, fn: (w: Walkthrough) => Walkthrough) => update($, current, (x): Walkthrough => fn(whole(x)))

const MARKS: readonly Mark[] = ['pass', 'fail', 'skip']
const LABEL: Record<Mark, string> = { pass: 'Pass', fail: 'Fail', skip: 'Skip', pending: '' }
const TONE: Record<Mark, string> = { pass: 'success', fail: 'error', skip: 'warning', pending: 'subtle' }

/** Press ids: `<action>` or `<action>:<step>`, every one a control of this pane. */
async function press($: $, id: string, surface: RenderSurface): Promise<void> {
  const [action, at] = id.split(':')
  const i = Number(at)
  if (action === 'pass' || action === 'fail' || action === 'skip') {
    await setWalk($, w => mark(w, i, action))
  } else if (action === 'open') {
    await setWalk($, w => toggle(w, i))
  } else if (action === 'copy') {
    const w = await readWalk($)
    const run = w.steps[i]?.run
    if (!run) return
    const copied = await $.ui.copy({ text: run, surface })
    $.ui.toast(copied.isCopied ? 'Command copied' : 'Could not copy the command here')
  } else if (action === 'send') {
    const w = await readWalk($)
    if (w.steps.length === 0) return
    await setWalk($, x => ({ ...x, sent: x.sent + 1 }))
    try {
      await $.prompt.submit({ text: results(w) })
      $.ui.toast('Results sent to Claude')
    } catch (err) {
      $.ui.log(`walkthrough: could not send the results: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'walkthrough', description: 'Show the manual test checklist Claude published' })
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What is being validated, e.g. "Sidebar resize, issue #12"' },
          intro: { type: 'string', description: 'One or two lines of setup that applies to every step' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The check, in a few words' },
                run: { type: 'string', description: 'The exact command to run, if any' },
                where: { type: 'string', description: 'Directory, worktree, terminal, window size' },
                expect: { type: 'string', description: 'What the person should see when it works' },
              },
              required: ['title', 'expect'],
            },
          },
        },
        required: ['title', 'steps'],
      },
      isDeferred: false,
    })
    return result
  })

  on('command.run', { command: 'walkthrough' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Walkthrough', focus: true })
    return { text: 'Walkthrough pane opened.' }
  })

  on('tool.call', { tool: 'mcp__walkthrough__publish_walkthrough' }, async ($, e) => {
    const parsed = parse(e)
    if ('error' in parsed) return { deny: `${TOOL}: ${parsed.error}` }
    await setWalk($, () => parsed.walkthrough)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Walkthrough' })
    const n = parsed.walkthrough.steps.length
    const where = isPlaced ? 'It is open in the Walkthrough pane' : 'The person opens it with /walkthrough'
    return {
      result:
        `Published ${n} step${n === 1 ? '' : 's'}. ${where}. ` +
        'The results arrive as a message from the walkthrough plugin; wait for them instead of asking in chat.',
    }
  })

  // The desktop's controls are Clients posting { press }.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const id = (e.data as { press?: unknown } | null)?.press
    if (typeof id === 'string') await press($, id, e.surface)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>The walkthrough draws in the terminal and the desktop app.</Text>
    }
    const surface = e.surface
    const { Box, Text, Button, Client, Code, Input } = $.ui.resolve({ ...e, surface })
    const w = await readWalk($)
    if (w.steps.length === 0) {
      return <Text dimColor>No walkthrough yet. Claude publishes one when there is something to test by hand.</Text>
    }

    // The terminal draws Buttons (hotkeys, Tab); the desktop drops Button
    // presses from plugin panes, so it gets Client pills.
    const control = (id: string, label: string, opts: { hotkey?: string; tone?: string } = {}) =>
      surface === 'terminal' ? (
        <Button key={id} label={label} hotkey={opts.hotkey} plain onPress={() => press($, id, surface)} />
      ) : (
        // Client props are plain data: an absent tone is left out, never undefined.
        <Client key={id} module="./pill.tsx" props={{ id, label, kind: 'button', ...(opts.tone ? { tone: opts.tone } : {}) }} />
      )
    const row = (id: string, label: string, tone: string, dim: boolean) =>
      surface === 'terminal' ? (
        <Button key={id} label={label} plain onPress={() => press($, id, surface)} />
      ) : (
        <Client key={id} module="./pill.tsx" props={{ id, label, kind: 'row', tone, dim }} />
      )

    const t = tally(w)
    const open = openStep(w)
    const steps = w.steps.map((s, i) => {
      const m = w.marks[i] ?? 'pending'
      const head = `${GLYPH[m]} ${i + 1}. ${s.title}`
      if (i !== open) {
        const n = (w.notes[i] ?? '').trim()
        return row(`open:${i}`, n ? `${head}  (${n})` : head, TONE[m], m !== 'pending')
      }
      return (
        <Box key={`step-${i}`} flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
          {row(`open:${i}`, head, TONE[m], false)}
          {s.where && <Text dimColor>in {s.where}</Text>}
          {s.run && (
            <Box key={`run-${i}`} flexDirection="row" gap={1}>
              <Box flexGrow={1} flexDirection="column">
                <Code source={s.run} language="bash" />
              </Box>
              {control(`copy:${i}`, 'Copy', { hotkey: 'c' })}
            </Box>
          )}
          <Text>Expect: {s.expect}</Text>
          <Box key={`marks-${i}`} flexDirection="row" gap={1}>
            {MARKS.map(k =>
              control(`${k}:${i}`, m === k ? `${LABEL[k]} ✓` : LABEL[k], { hotkey: k[0], tone: m === k ? TONE[k] : undefined }),
            )}
          </Box>
          <Input
            key={`note:${i}`}
            label="Note "
            placeholder="what you saw (optional)"
            value={w.notes[i] ?? ''}
            submitLabel="save"
            onInput={value => setWalk($, x => note(x, i, value))}
            onSubmit={value => setWalk($, x => note(x, i, value))}
          />
        </Box>
      )
    })

    const done = t.pending === 0
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="head" flexDirection="column">
          <Text bold>{w.title}</Text>
          <Text dimColor>{summary(t)}</Text>
          {w.intro && <Text>{w.intro}</Text>}
        </Box>
        <Box key="steps" flexDirection="column">
          {steps}
        </Box>
        <Box key="foot" flexDirection="row" gap={2}>
          {control('send', w.sent > 0 ? 'Send results again' : 'Send results', { hotkey: 'r', tone: done ? 'suggestion' : undefined })}
          {w.sent > 0 && <Text dimColor>sent</Text>}
        </Box>
      </Box>
    )
  })
}
