import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Kickoff, Title, Wrap } from '../types'
import {
  cleanTitle,
  commandName,
  hasCommand,
  isFreshStart,
  kickoffMode,
  startContext,
  TITLE_TOOL_DESCRIPTION,
  wrapReason,
} from './session'
import type { KickoffMode } from './session'

const PLUGIN = 'work-session'
const TOOL = 'set_session_title'
// Press ids carry the plugin's name: the band is shared with other plugins' Clients.
const P = {
  kickoff: `${PLUGIN}:kickoff`,
  skip: `${PLUGIN}:skip`,
  wrap: `${PLUGIN}:wrap`,
  later: `${PLUGIN}:later`,
} as const

const EMPTY_KICKOFF: Kickoff = { phase: 'none', command: '' }
const EMPTY_WRAP: Wrap = { phase: 'none', reason: '' }
const EMPTY_TITLE: Title = { applied: null }

const kickoff = atom({ plugin: 'work-session', key: 'kickoff' } as const, EMPTY_KICKOFF)
const wrap = atom({ plugin: 'work-session', key: 'wrap' } as const, EMPTY_WRAP)
const title = atom({ plugin: 'work-session', key: 'title' } as const, EMPTY_TITLE)

let start = 'cws'
let end = 'ews'
let mode: KickoffMode = 'band'
let wrapAt = 75

// Saved state from an older version lacks newer fields: fill defaults on reads and updates.
const readKickoff = async ($: $): Promise<Kickoff> => ({ ...EMPTY_KICKOFF, ...(await read($, kickoff)) })
const readWrap = async ($: $): Promise<Wrap> => ({ ...EMPTY_WRAP, ...(await read($, wrap)) })
const readTitle = async ($: $): Promise<Title> => ({ ...EMPTY_TITLE, ...(await read($, title)) })
const setKickoff = ($: $, fn: (k: Kickoff) => Kickoff) => update($, kickoff, (x): Kickoff => fn({ ...EMPTY_KICKOFF, ...x }))
const setWrap = ($: $, fn: (w: Wrap) => Wrap) => update($, wrap, (x): Wrap => fn({ ...EMPTY_WRAP, ...x }))
const setTitle = ($: $, fn: (t: Title) => Title) => update($, title, (x): Title => fn({ ...EMPTY_TITLE, ...x }))

async function runCommand($: $, name: string): Promise<void> {
  try {
    await $.command.run({ command: name, args: '' })
  } catch (err) {
    $.ui.log(`${PLUGIN}: could not run /${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function press($: $, id: string): Promise<void> {
  if (id === P.kickoff) {
    await setKickoff($, k => ({ ...k, phase: 'started' }))
    // Not awaited: the command runs once the session is idle, after this press returns.
    void runCommand($, start)
  } else if (id === P.skip) {
    await setKickoff($, k => ({ ...k, phase: 'skipped' }))
  } else if (id === P.wrap) {
    await setWrap($, w => ({ ...w, phase: 'started' }))
    void runCommand($, end)
  } else if (id === P.later) {
    await setWrap($, w => ({ ...w, phase: 'dismissed' }))
  }
}

export const register: Register = (on, options) => {
  start = commandName(options?.startCommand, 'cws')
  end = commandName(options?.endCommand, 'ews')
  mode = kickoffMode(options?.kickoff)
  wrapAt = typeof options?.wrapAtPercent === 'number' ? options.wrapAtPercent : 75

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.tool.register({
      name: TOOL,
      description: TITLE_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', description: 'The session title, e.g. "Atlas S12 · Search filters"' } },
        required: ['title'],
      },
      isDeferred: false,
    })
    return result
  })

  // The classic event carries the start's source: only a fresh session is kicked off.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (!isFreshStart(e.source)) return result
    await Promise.all([
      setKickoff($, () => EMPTY_KICKOFF),
      setWrap($, () => EMPTY_WRAP),
      setTitle($, () => EMPTY_TITLE),
    ])
    if (mode === 'off' || !hasCommand(await $.command.list(), start)) return result
    if (mode === 'auto') {
      await setKickoff($, () => ({ phase: 'started', command: start }))
      void runCommand($, start)
    } else {
      await setKickoff($, () => ({ phase: 'offered', command: start }))
    }
    return { ...result, additionalContext: [...(result.additionalContext ?? []), startContext(start)] }
  })

  // Re-sent with every prompt, so the session keeps the title it was given.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const t = await readTitle($)
    return t.applied ? { ...result, sessionTitle: t.applied } : result
  })

  on('tool.call', { tool: 'mcp__work-session__set_session_title' }, async ($, e) => {
    const cleaned = cleanTitle((e as unknown as { title?: unknown }).title)
    if ('error' in cleaned) return { deny: `${TOOL}: ${cleaned.error}` }
    await setTitle($, () => ({ applied: cleaned.title }))
    return { result: `Session title set to "${cleaned.title}"; it shows from the user's next message.` }
  })

  // Anything the person types instead of pressing 1 means this session needs no kickoff.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'composer' && (await readKickoff($)).phase === 'offered') {
      await setKickoff($, k => ({ ...k, phase: 'skipped' }))
    }
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (e.command === start) await setKickoff($, k => ({ ...k, phase: 'started' }))
    if (e.command === end) await setWrap($, w => ({ ...w, phase: 'started' }))
    // A /rename by hand wins: stop re-sending this mod's title.
    if (e.command === 'rename') await setTitle($, () => EMPTY_TITLE)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    if ((await readWrap($)).phase !== 'none') return result
    const reason = wrapReason(await $.session.usage(), wrapAt)
    if (reason && hasCommand(await $.command.list(), end)) {
      await setWrap($, () => ({ phase: 'offered', reason }))
    }
    return result
  })

  on('ui.message', { component: 'AbovePrompt' }, async ($, e, next) => {
    const id = (e.data as { press?: unknown } | null)?.press
    if (typeof id !== 'string' || !id.startsWith(`${PLUGIN}:`)) return next(e)
    await press($, id)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band's controls need a terminal (Buttons) or the desktop (Clients).
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const [k, w] = await Promise.all([readKickoff($), readWrap($)])
    const offer =
      k.phase === 'offered'
        ? { glyph: '▸', text: `Kick off this session with /${start}`, yes: P.kickoff, yesLabel: `Run /${start}`, no: P.skip, noLabel: 'Skip' }
        : w.phase === 'offered'
          ? { glyph: '◐', text: `Time to wrap? ${w.reason}`, yes: P.wrap, yesLabel: `Run /${end}`, no: P.later, noLabel: 'Later' }
          : null
    if (!offer) return next(e)
    const { Box, Text, Button, Client } = $.ui.resolve({ ...e, surface: e.surface })
    // The terminal draws Buttons for their digit hotkeys; the desktop drops Button
    // presses from plugin UI, so it gets Client pills posting { press }.
    const control = (id: string, label: string, hotkey: string) =>
      e.surface === 'terminal' ? (
        <Button key={id} label={label} hotkey={hotkey} plain onPress={() => press($, id)} />
      ) : (
        <Client key={id} module="./pill.tsx" props={{ id, label, hotkey }} />
      )
    const row = (
      <Box key={PLUGIN} flexDirection="row" gap={2} paddingX={1}>
        <Text color="suggestion">{offer.glyph}</Text>
        <Text>{offer.text}</Text>
        {control(offer.yes, offer.yesLabel, '1')}
        {control(offer.no, offer.noLabel, '2')}
      </Box>
    )
    // Stacked over what the plugins beneath draw (a desktop status line), not instead of it.
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    )
  })
}
