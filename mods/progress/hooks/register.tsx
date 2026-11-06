import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Gate, Maps, Plan, Queue } from '../types'
import {
  age,
  catalogueSpecs,
  choosePlan,
  commandDir,
  DEFAULT_GATE,
  frontmatter,
  gate,
  gateName,
  gateText,
  listedNumbers,
  parseRemote,
  queueText,
  sheetSummary,
  specsSummary,
  touchesQueue,
  verdict,
} from './progress'
import type { PlanFile, Verdict } from './progress'

const PLUGIN = 'progress'
const MINUTE = 60_000
const QUEUE_EVERY = 10 * MINUTE

const EMPTY_QUEUE: Queue = { review: [], prs: [], error: '', checkedAt: null }
const EMPTY_MAPS: Maps = { sheet: null, specs: null }

const gates = atom({ plugin: 'progress', key: 'gates' } as const, [] as Gate[])
const plan = atom({ plugin: 'progress', key: 'plan' } as const, null)
const queue = atom({ plugin: 'progress', key: 'queue' } as const, EMPTY_QUEUE)
const maps = atom({ plugin: 'progress', key: 'maps' } as const, EMPTY_MAPS)
const now = atom({ plugin: 'progress', key: 'now' } as const, 0)

type Settings = {
  planDir: string
  plan: string
  gate: RegExp
  queueLabel: string
  forgeRepo: string
  forgeHost: string
  worksheet: string
  worksheetLabel: string
  catalogue: string
  catalogueLabel: string
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

function settings(options: Readonly<Record<string, unknown>>): Settings {
  let pattern: RegExp
  try {
    pattern = new RegExp(str(options.gatePattern, DEFAULT_GATE) || DEFAULT_GATE)
  } catch {
    // A pattern that does not parse falls back to the default rather than disabling gates.
    pattern = new RegExp(DEFAULT_GATE)
  }
  return {
    planDir: str(options.planDir, 'context/plans').replace(/\/+$/, '') || 'context/plans',
    plan: str(options.plan, ''),
    gate: pattern,
    queueLabel: str(options.queueLabel, 'status/review') || 'status/review',
    forgeRepo: str(options.forgeRepo, ''),
    forgeHost: str(options.forgeHost, ''),
    worksheet: str(options.worksheet, ''),
    worksheetLabel: str(options.worksheetLabel, 'sheet') || 'sheet',
    catalogue: str(options.catalogue, ''),
    catalogueLabel: str(options.catalogueLabel, 'specs') || 'specs',
  }
}

// Saved state from an older version lacks newer fields: fill defaults on reads and updates.
const readQueue = async ($: $): Promise<Queue> => ({ ...EMPTY_QUEUE, ...(await read($, queue)) })
const setQueue = ($: $, fn: (q: Queue) => Queue) => update($, queue, (x): Queue => fn({ ...EMPTY_QUEUE, ...x }))
const readMaps = async ($: $): Promise<Maps> => ({ ...EMPTY_MAPS, ...(await read($, maps)) })
const readGates = async ($: $): Promise<Gate[]> => {
  const xs = await read($, gates)
  return Array.isArray(xs) ? xs : []
}

async function readPlans($: $, o: Settings): Promise<PlanFile[]> {
  if (o.plan) {
    try {
      return [{ file: o.plan, md: await $.fs.read(o.plan) }]
    } catch {
      return []
    }
  }
  let names: string[]
  try {
    names = (await $.fs.list(o.planDir))
      .filter(e => e.kind === 'file' && e.name.endsWith('.md') && e.name.toLowerCase() !== 'readme.md')
      .map(e => e.name)
  } catch {
    // No plans folder in this checkout: the band leaves the plan out.
    return []
  }
  const out: PlanFile[] = []
  for (const name of names) {
    const file = `${o.planDir}/${name}`
    try {
      out.push({ file, md: await $.fs.read(file) })
    } catch {
      // An unreadable plan is skipped, not fatal.
    }
  }
  return out
}

async function refreshPlan($: $, o: Settings): Promise<void> {
  const p = choosePlan(await readPlans($, o), o.plan)
  await update($, plan, (): Plan | null => p)
}

async function refreshMaps($: $, o: Settings): Promise<void> {
  let sheet: Maps['sheet'] = null
  let specs: Maps['specs'] = null
  if (o.worksheet) {
    try {
      sheet = sheetSummary(await $.fs.read(o.worksheet), o.worksheetLabel)
    } catch {
      sheet = null
    }
  }
  if (o.catalogue) {
    try {
      const cat = catalogueSpecs(await $.fs.read(o.catalogue))
      if (cat) {
        const statuses: Record<string, string> = {}
        for (const path of cat.paths) {
          try {
            statuses[path] = (await $.fs.exists(path)) ? frontmatter(await $.fs.read(path)).status || 'unknown' : 'external'
          } catch {
            statuses[path] = 'unread'
          }
        }
        specs = specsSummary(cat.paths, cat.areas, statuses, o.catalogueLabel)
      }
    } catch {
      specs = null
    }
  }
  await update($, maps, (): Maps => ({ sheet, specs }))
}

type Forge = { host: string; repo: string }

async function forgeTarget($: $, o: Settings): Promise<Forge | null> {
  let host = o.forgeHost
  let repo = o.forgeRepo
  if (!host || !repo) {
    try {
      const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 10_000 })
      const parsed = r.exitCode === 0 ? parseRemote(r.stdout) : null
      if (parsed) {
        host ||= parsed.host
        repo ||= `${parsed.owner}/${parsed.repo}`
      }
    } catch {
      // No usable remote: the queue stays off.
    }
  }
  return host && repo ? { host, repo } : null
}

// A process runs no shell, so a user's alias for fgj would not resolve: call fgj itself.
async function forgeList($: $, forge: Forge, args: string[]): Promise<number[]> {
  const r = await $.process.run(['fgj', '--hostname', forge.host, ...args, '-R', forge.repo], { timeoutMs: 45_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`)
  return listedNumbers(r.stdout)
}

/** Runs unawaited (from a timer, after a command): its failure is the forge's, said in the band. */
function refreshQueueSoon($: $, forge: Forge | null, o: Settings): void {
  refreshQueue($, forge, o).catch(() => undefined)
}

async function refreshQueue($: $, forge: Forge | null, o: Settings): Promise<void> {
  if (!forge) return
  const at = await $.clock.now()
  try {
    const [review, prs] = await Promise.all([
      forgeList($, forge, ['issue', 'list', '-l', o.queueLabel, '-L', '100']),
      forgeList($, forge, ['pr', 'list']),
    ])
    await setQueue($, () => ({ review, prs, error: '', checkedAt: at }))
  } catch (err) {
    // A forge that never answered stays out of the band: a GitHub remote, or fgj
    // without this host. One that answered before keeps its lists and says the
    // refresh failed.
    const error = err instanceof Error ? err.message : String(err)
    await setQueue($, q => (q.checkedAt === null ? q : { ...q, error: error || 'unreachable', checkedAt: at }))
  }
}

async function headSha($: $, dir: string): Promise<string> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], dir ? { cwd: dir } : {})
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

const MARK: Record<Verdict, { glyph: string; color: string }> = {
  pass: { glyph: '✓', color: 'success' },
  fail: { glyph: '✗', color: 'error' },
  unknown: { glyph: '?', color: 'warning' },
}

export const register: Register = (on, options) => {
  const o = settings(options ?? {})
  let forge: Forge | null = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const t0 = await $.clock.now()
    await update($, now, () => t0)
    await Promise.all([refreshPlan($, o), refreshMaps($, o)])
    forge = await forgeTarget($, o)
    // Not awaited: a slow forge must not hold the session's start.
    refreshQueueSoon($, forge, o)
    $.clock.every(MINUTE, () => {
      $.clock
        .now()
        .then(t => update($, now, () => t))
        .catch(() => undefined)
    })
    $.clock.every(QUEUE_EVERY, () => refreshQueueSoon($, forge, o))
    return result
  })

  // Only the main conversation's turns: plans and maps change through edits and commits, not mid-subagent.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await Promise.all([refreshPlan($, o), refreshMaps($, o)])
    return result
  })

  // Watches gate commands and reads their real outcome; never changes the call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const command = typeof e.command === 'string' ? e.command : ''
    if (touchesQueue(command)) refreshQueueSoon($, forge, o)
    const name = gateName(command, o.gate)
    if (!name || e.run_in_background) return result
    const r = result as { text?: string; isError?: boolean }
    const [sha, at] = await Promise.all([headSha($, commandDir(command)), $.clock.now()])
    const g = gate(name, command, r.text ?? '', r.isError === true, sha, at, o.gate)
    await update($, gates, (xs): Gate[] => [...(Array.isArray(xs) ? xs : []).filter(x => x.name !== g.name), g].slice(-3))
    await update($, now, () => at)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [gs, p, q, m, clock] = await Promise.all([readGates($), read($, plan), readQueue($), readMaps($), read($, now)])
    if (!p && gs.length === 0 && q.checkedAt === null && !m.sheet && !m.specs) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    const gateBit = (g: Gate) => {
      const mark = MARK[verdict(g)]
      return (
        <Box key={g.name} flexDirection="row" gap={1}>
          <Text color={mark.color}>{mark.glyph}</Text>
          <Text>{gateText(g)}</Text>
        </Box>
      )
    }
    const sorted = [...gs].sort((x, y) => x.at - y.at)
    const last = sorted[sorted.length - 1]
    const queueWord = o.queueLabel.split('/').pop() || o.queueLabel

    const row = (
      <Box key={PLUGIN} flexDirection="row" flexWrap="wrap" columnGap={3} paddingX={1}>
        {p && p.name && (
          <Text key="plan">
            <Text color="suggestion">◆ </Text>
            {p.name}
            <Text dimColor>
              {p.current ? ` · slice ${p.current.id} ${p.current.name}` : ' · no current slice'}
              {` · ${p.done}/${p.total} done`}
              {p.nextGate ? ` · next ${p.nextGate}` : ''}
              {p.active > 1 ? ` · ${p.active} plans active` : ''}
            </Text>
          </Text>
        )}
        {p && !p.name && (
          <Text key="plan">
            <Text color="warning">◆ </Text>
            no active plan
            <Text dimColor>{` · ${p.plans} in ${o.planDir}`}</Text>
          </Text>
        )}
        {last && (
          <Box key="gates" flexDirection="row" gap={2}>
            {sorted.map(gateBit)}
            <Text dimColor>
              {last.sha ? `@${last.sha}` : ''}
              {last.where ? ` ${last.where}` : ''} {age(clock - last.at)}
            </Text>
          </Box>
        )}
        {q.checkedAt !== null && (
          <Text key="queue">
            <Text dimColor>{queueWord} </Text>
            {q.review.length ? `${q.review.length} ${queueText(q.review)}` : 'none'}
            <Text dimColor> · PRs </Text>
            {q.prs.length ? queueText(q.prs) : 'none'}
            {q.error ? <Text color="warning"> (forge: {q.error})</Text> : ''}
          </Text>
        )}
        {m.sheet && (
          <Text key="sheet">
            <Text dimColor>{m.sheet.label} </Text>
            {m.sheet.counts.map(c => `${c.choice} ${c.n}`).join(' · ')}
            {m.sheet.open ? <Text color="warning">{` · ${m.sheet.open} open`}</Text> : ''}
            {m.sheet.overrides ? <Text dimColor>{` · ${m.sheet.overrides} overrides`}</Text> : ''}
          </Text>
        )}
        {m.specs && (
          <Text key="specs">
            <Text dimColor>{m.specs.label} </Text>
            {`${m.specs.total}: ${m.specs.statuses.map(s => `${s.status} ${s.n}`).join(' · ')}`}
            <Text dimColor>{` · ${m.specs.areas} areas`}</Text>
          </Text>
        )}
      </Box>
    )
    // Stacked over what the plugins beneath draw (a session band, a desktop status line).
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    )
  })
}
