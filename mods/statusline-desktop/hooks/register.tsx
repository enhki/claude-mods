import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Segment } from '../types'
import { buildInput, ghosttyIncludes, parseAnsi, parsePalette, pickCommand } from './line'

const line = atom({ plugin: 'statusline-desktop', key: 'line' } as const, null as Segment[] | null)

// The terminal refreshes its status line on its own; the clock and git parts
// only need this tick between turns.
const TICK_MS = 30_000

let isRunning = false
let isPending = false
let home: string | null = null
let configHome: string | null = null

async function readOrNull($: $, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function env($: $, name: string): Promise<string> {
  const { stdout } = await $.process.run(['printenv', name])
  return stdout.trim()
}

async function homeDir($: $): Promise<string> {
  if (home === null) home = await env($, 'HOME')
  return home
}

// The terminal's own ANSI palette, so the line keeps the colours it has there:
// ghostty's config and the files it pulls in with `config-file`, in load order.
async function terminalPalette($: $, h: string): Promise<string[]> {
  if (configHome === null) configHome = (await env($, 'XDG_CONFIG_HOME')) || `${h}/.config`
  const dir = `${configHome}/ghostty`
  const main = (await readOrNull($, `${dir}/config`)) ?? ''
  const texts = [main]
  for (const path of ghosttyIncludes(main, dir)) texts.push((await readOrNull($, path)) ?? '')
  return parsePalette(...texts)
}

async function runOnce($: $): Promise<void> {
  const [sessionId, cwd, root, model, version, usage, h] = await Promise.all([
    $.session.id(),
    $.session.cwd(),
    $.session.root(),
    $.session.model(),
    $.session.version(),
    $.session.usage(),
    homeDir($),
  ])
  const command = pickCommand(
    await Promise.all([
      readOrNull($, `${root}/.claude/settings.local.json`),
      readOrNull($, `${root}/.claude/settings.json`),
      readOrNull($, `${h}/.claude/settings.json`),
    ]),
  )
  if (command === null) {
    await update($, line, () => null)
    return
  }
  const stdin = JSON.stringify(buildInput({ sessionId, cwd, root, model, version: version.version, usage }))
  const { exitCode, stdout } = await $.process.run(['bash', '-c', command], { cwd, stdin, timeoutMs: 10_000 })
  if (exitCode !== 0 && stdout.trim() === '') return
  const palette = await terminalPalette($, h)
  const firstLine = stdout.split('\n').find(l => l.trim() !== '') ?? ''
  await update($, line, () => parseAnsi(firstLine, palette))
}

// One run at a time; a request while one runs queues exactly one more.
async function refresh($: $): Promise<void> {
  if (isRunning) {
    isPending = true
    return
  }
  isRunning = true
  try {
    do {
      isPending = false
      await runOnce($)
    } while (isPending)
  } catch (err) {
    $.ui.log(`statusline-desktop: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    isRunning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    $.clock.every(TICK_MS, () => void refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The terminal already draws the real status line under the prompt.
    if (e.surface === 'terminal' || e.props.hasSurvey) return next(e)
    const segments = await read($, line)
    if (!segments || segments.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The band is shared: what the plugins beneath draw (a kickoff offer) stacks
    // above the line, which stays next to the prompt as in the terminal.
    const beneath = await next(e)
    return (
      <Box flexDirection="column">
        {beneath}
        <Box flexDirection="row">
          {segments.map((s, i) => (
            <Text key={String(i)} color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate-end">
              {s.text}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
