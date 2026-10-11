import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Kickoff, Title, Wrap } from '../types'
import {
  cleanTitle,
  commandFiles,
  commandName,
  hasCommand,
  isFreshStart,
  isStartPrompt,
  kickoffMode,
  startContext,
  TITLE_NUDGES,
  TITLE_TOOL_DESCRIPTION,
  titleNudge,
  wrapReason,
} from './session'
import type { KickoffMode } from './session'

const PLUGIN = 'work-session'
const TOOL = 'set_session_title'
// The desktop app keeps its own session titles and ignores a hook's sessionTitle.
const APP_TITLE_TOOL = 'mcp__ccd_session_mgmt__set_session_title'
// Press ids carry the plugin's name: the band is shared with other plugins' Clients.
const P = {
  kickoff: `${PLUGIN}:kickoff`,
  skip: `${PLUGIN}:skip`,
  wrap: `${PLUGIN}:wrap`,
  later: `${PLUGIN}:later`,
} as const

const EMPTY_KICKOFF: Kickoff = { phase: 'none', command: '', told: false, nudges: 0 }
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

// The engine lists commands only once the session is bound, never at SessionStart.
// Null while it cannot; with `files`, the project's own command and skill files answer instead.
async function commandExists($: $, name: string, files: boolean): Promise<boolean | null> {
  try {
    return hasCommand(await $.command.list(), name)
  } catch {
    if (!files) return null
    const found = await Promise.all(commandFiles(await $.session.cwd(), name).map(p => $.fs.exists(p).catch(() => false)))
    return found.some(Boolean)
  }
}

/**
 * Settles a pending kickoff into an offer, an auto run or nothing; the first caller wins.
 * Without `files` it leaves the kickoff pending while the commands cannot be listed.
 */
async function resolveKickoff($: $, files: boolean): Promise<Kickoff> {
  const k = await readKickoff($)
  if (k.phase !== 'pending') return k
  const exists = await commandExists($, start, files)
  if (exists === null) return k
  if (!exists) {
    await setKickoff($, x => (x.phase === 'pending' ? { ...x, phase: 'none' } : x))
    return readKickoff($)
  }
  const phase = mode === 'auto' ? 'started' : 'offered'
  await setKickoff($, x => (x.phase === 'pending' ? { ...x, phase } : x))
  if (mode === 'auto') void runCommand($, start)
  return readKickoff($)
}

// Retried until the session is bound (the terminal mounts within a few hundred ms),
// the last try reading the project's files instead.
const SETTLE_TRIES = 20
const SETTLE_MS = 250

function settleSoon($: $, tries: number): void {
  $.clock.after(SETTLE_MS, async () => {
    const k = await resolveKickoff($, tries <= 1)
    if (k.phase === 'pending' && tries > 1) settleSoon($, tries - 1)
  })
}

async function setAppTitle($: $, t: string): Promise<string> {
  try {
    if (!(await $.tool.list()).some(x => x.name === APP_TITLE_TOOL)) return ''
    const r = await $.tool.call({ tool: APP_TITLE_TOOL, session_id: 'self', title: t } as never)
    return (r as { isError?: boolean }).isError ? ` The app refused the rename: ${(r as { text?: string }).text ?? ''}` : ''
  } catch (err) {
    return ` The app could not rename it: ${err instanceof Error ? err.message : String(err)}`
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
  // The commands cannot be listed yet, so the kickoff waits as pending: the
  // terminal settles it at the first draw of the band, the desktop (which starts
  // the session with the first message) at the first prompt.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (!isFreshStart(e.source)) return result
    await Promise.all([
      setKickoff($, () => (mode === 'off' ? EMPTY_KICKOFF : { ...EMPTY_KICKOFF, phase: 'pending', command: start })),
      setWrap($, () => EMPTY_WRAP),
      setTitle($, () => EMPTY_TITLE),
    ])
    if (mode !== 'off') settleSoon($, SETTLE_TRIES)
    return result
  })

  // The start context rides the first prompt of a kicked-off session; the title
  // is re-sent with every prompt, so the session keeps it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const k = await resolveKickoff($, true)
    const context = [...(result.additionalContext ?? [])]
    const t = await readTitle($)
    if (k.phase !== 'none' && !k.told) {
      await setKickoff($, x => ({ ...x, told: true }))
      context.push(startContext(start))
    } else if (k.phase === 'started' && !t.applied && k.nudges < TITLE_NUDGES && !isStartPrompt(e.prompt, start)) {
      // The message after the kickoff usually picks the focus: the moment to title it.
      await setKickoff($, x => ({ ...x, nudges: x.nudges + 1 }))
      context.push(titleNudge(start))
    }
    return {
      ...result,
      ...(context.length ? { additionalContext: context } : {}),
      ...(t.applied ? { sessionTitle: t.applied } : {}),
    }
  })

  on('tool.call', { tool: 'mcp__work-session__set_session_title' }, async ($, e) => {
    const cleaned = cleanTitle((e as unknown as { title?: unknown }).title)
    if ('error' in cleaned) return { deny: `${TOOL}: ${cleaned.error}` }
    await setTitle($, () => ({ applied: cleaned.title }))
    const app = await setAppTitle($, cleaned.title)
    return { result: `Session title set to "${cleaned.title}"; it shows from the user's next message.${app}` }
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
