import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Change, Row, SheetState, Worksheet } from '../types'
import {
  applyProposals,
  counts,
  edit,
  EMPTY,
  filterRows,
  glyph,
  isWorksheetName,
  label,
  MEMBERSHIPS,
  membershipLabel,
  NO_FILTER,
  parseConfig,
  parseWorksheet,
  patchFile,
  summary,
  TOOL_DESCRIPTION,
  UNSET,
  whole,
  type Proposal,
} from './sheet'

const PANE = 'worksheet'
const TOOL = 'propose_worksheet'
const CONFIG = '.claude/worksheets.json'
const DEFAULT_DIR = 'docs/prd'
const SAVE_MS = 400
const NOTIFY_MS = 3_000
const RENDER_MS = 20_000

const current = atom({ plugin: 'worksheet', key: 'current' } as const, EMPTY, { shape: 'worksheet-1' })

const readState = async ($: $): Promise<SheetState> => whole(await read($, current))
const setState = ($: $, fn: (s: SheetState) => SheetState) => update($, current, (x): SheetState => fn(whole(x)))

let configured: string[] = []
let notifyDefault = false
let saveTimer: { cancel: () => void } | null = null
let notifyTimer: { cancel: () => void } | null = null

/** Reads a worksheet file into the state; a failure is shown, not thrown. */
async function load($: $, path: string): Promise<void> {
  try {
    const raw = await $.fs.read(path)
    const parsed = parseWorksheet(typeof raw === 'string' ? raw : '')
    if ('error' in parsed) {
      await setState($, s => ({ ...s, path, sheet: null, error: `${path}: ${parsed.error}` }))
      return
    }
    await setState($, s => ({ ...s, path, sheet: parsed.sheet, error: '', rev: s.rev + 1 }))
  } catch (err) {
    await setState($, s => ({ ...s, path, sheet: null, error: `${path}: ${err instanceof Error ? err.message : String(err)}` }))
  }
}

/** The worksheets this project offers: the setting, the config file, else the default folder. */
async function discover($: $): Promise<string[]> {
  if (configured.length) return configured
  const fromConfig = parseConfig(await $.fs.read(CONFIG).catch(() => null))
  if (fromConfig.length) return fromConfig
  const entries = await $.fs.list(DEFAULT_DIR).catch(() => [])
  return entries
    .filter(e => e.kind === 'file' && isWorksheetName(e.name))
    .map(e => `${DEFAULT_DIR}/${e.name}`)
    .sort()
}

/** Writes the pending changes into the file (read, patch, write), then renders the export and queues the notice. */
async function flush($: $): Promise<void> {
  const s = await readState($)
  if (!s.path || s.pending.length === 0 || s.saving) return
  const batch = s.pending
  await setState($, x => ({ ...x, saving: true }))
  try {
    const raw = await $.fs.read(s.path)
    const data: unknown = JSON.parse(typeof raw === 'string' ? raw : '{}')
    const missing = patchFile(data, batch)
    await $.fs.write(s.path, `${JSON.stringify(data, null, 2)}\n`)
    if (missing.length) $.ui.log(`worksheet: rows not in ${s.path}: ${missing.join(', ')}`)
    await setState($, x => ({ ...x, pending: x.pending.filter(c => !batch.includes(c)), log: [...x.log, ...batch], saving: false }))
    const sheet = s.sheet
    if (sheet?.render) {
      const ran = await $.process.run(sheet.render.split(/\s+/), { stdin: '', timeoutMs: RENDER_MS })
      if (ran.exitCode !== 0) $.ui.toast(`Render failed: ${ran.stderr.trim().slice(0, 200) || sheet.render}`)
    }
    $.ui.status(`worksheet: saved ${batch.length} change${batch.length === 1 ? '' : 's'}`)
    const after = await readState($)
    if (after.notify && after.log.length) scheduleNotify($)
  } catch (err) {
    await setState($, x => ({ ...x, saving: false }))
    $.ui.toast(`Could not save ${s.path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function scheduleSave($: $): void {
  saveTimer?.cancel()
  saveTimer = $.clock.after(SAVE_MS, () => {
    saveTimer = null
    void flush($).catch(err => $.ui.log(`worksheet: save failed: ${err instanceof Error ? err.message : String(err)}`))
  })
}

/** Sends the saved changes to Claude as one message and clears the log. */
async function send($: $): Promise<void> {
  const s = await readState($)
  if (!s.sheet || s.log.length === 0) return
  const text = summary(s.sheet, s.path, s.log)
  await setState($, x => ({ ...x, log: [], sent: x.sent + 1 }))
  try {
    await $.prompt.submit({ text })
    $.ui.toast('Worksheet changes sent to Claude')
  } catch (err) {
    $.ui.log(`worksheet: could not send the changes: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function scheduleNotify($: $): void {
  notifyTimer?.cancel()
  notifyTimer = $.clock.after(NOTIFY_MS, () => {
    notifyTimer = null
    void send($).catch(err => $.ui.log(`worksheet: notify failed: ${err instanceof Error ? err.message : String(err)}`))
  })
}

/** Press ids: `<action>`, `<action>:<arg>` or `pri:<choice>:<row>`, every one a control of this pane. */
async function press($: $, id: string): Promise<void> {
  const at = id.indexOf(':')
  const action = at === -1 ? id : id.slice(0, at)
  const arg = at === -1 ? '' : id.slice(at + 1)
  if (action === 'pri') {
    const sep = arg.indexOf(':')
    const choice = arg.slice(0, sep)
    const row = arg.slice(sep + 1)
    const s = await readState($)
    const cur = s.sheet ? s.sheet.rows.find(r => r.id === row)?.priority : undefined
    await setState($, x => edit(x, row, 'priority', cur === choice ? '' : choice))
    scheduleSave($)
  } else if (action === 'open') {
    await setState($, x => ({ ...x, open: x.open === arg ? null : arg }))
  } else if (action === 'sec') {
    await setState($, x => ({ ...x, collapsed: x.collapsed.includes(arg) ? x.collapsed.filter(c => c !== arg) : [...x.collapsed, arg] }))
  } else if (action === 'fm' || action === 'fc' || action === 'fp' || action === 'fx') {
    const field = { fm: 'membership', fc: 'category', fp: 'priority', fx: 'proposed' }[action] as keyof typeof NO_FILTER
    await setState($, x => ({ ...x, filter: { ...x.filter, [field]: x.filter[field] === arg ? '' : arg } }))
  } else if (action === 'clearfilter') {
    await setState($, x => ({ ...x, filter: NO_FILTER }))
  } else if (action === 'notify') {
    await setState($, x => ({ ...x, notify: !x.notify }))
  } else if (action === 'send') {
    await send($)
  } else if (action === 'reload') {
    const s = await readState($)
    if (s.path) await load($, s.path)
  } else if (action === 'pick') {
    await load($, arg)
  }
}

export const register: Register = (on, options) => {
  configured = (typeof options?.worksheets === 'string' ? options.worksheets : '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
  notifyDefault = options?.notifyOnSave === true

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'worksheet', description: 'Show the worksheet pane: priorities and comments over a JSON worksheet' })
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The worksheet file, relative to the working directory; absent, the one shown' },
          proposals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: "The row's id" },
                priority: { type: 'string', description: "One of the worksheet's choices, or empty to withdraw the proposal" },
                reason: { type: 'string', description: 'One line on why to include, defer or ignore it' },
              },
              required: ['id', 'priority', 'reason'],
            },
          },
        },
        required: ['proposals'],
      },
      isDeferred: false,
    })
    const paths = await discover($)
    await setState($, s => ({ ...s, paths, path: s.path && paths.includes(s.path) ? s.path : (paths[0] ?? ''), notify: s.rev === 0 ? notifyDefault : s.notify }))
    return result
  })

  on('command.run', { command: 'worksheet' }, async ($, e) => {
    const s = await readState($)
    const arg = (e as { args?: unknown }).args
    const wanted = typeof arg === 'string' && arg.trim() ? arg.trim() : s.path
    const path = s.paths.find(p => p === wanted || p.endsWith(`/${wanted}`) || p.includes(wanted)) ?? wanted
    if (!path) return { text: `No worksheet found. List them in ${CONFIG} or put *-worksheet.json under ${DEFAULT_DIR}.` }
    await load($, path)
    await $.ui.open({ id: PANE, title: 'Worksheet', focus: true })
    return { text: `Worksheet pane opened on ${path}.` }
  })

  on('tool.call', { tool: `mcp__worksheet__${TOOL}` }, async ($, e) => {
    const input = e as { path?: unknown; proposals?: unknown }
    const s = await readState($)
    const path = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : s.path || s.paths[0] || ''
    if (!path) return { deny: `${TOOL}: no worksheet is known; pass path` }
    const list = Array.isArray(input.proposals) ? input.proposals : []
    const proposals: Proposal[] = []
    for (const raw of list) {
      const p = (raw ?? {}) as Record<string, unknown>
      if (typeof p.id !== 'string' || !p.id.trim()) return { deny: `${TOOL}: a proposal has no id` }
      proposals.push({ id: p.id.trim(), priority: typeof p.priority === 'string' ? p.priority : '', reason: typeof p.reason === 'string' ? p.reason : '' })
    }
    if (proposals.length === 0) return { deny: `${TOOL}: proposals is empty` }
    let raw: unknown
    try {
      raw = JSON.parse(String(await $.fs.read(path)))
    } catch (err) {
      return { deny: `${TOOL}: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}` }
    }
    const parsed = parseWorksheet(JSON.stringify(raw))
    if ('error' in parsed) return { deny: `${TOOL}: ${path}: ${parsed.error}` }
    const outcome = applyProposals(raw, proposals, parsed.sheet.choices)
    if (outcome.refused.length) return { deny: `${TOOL}: priority must be one of ${parsed.sheet.choices.join(', ')}: ${outcome.refused.join('; ')}` }
    await $.fs.write(path, `${JSON.stringify(raw, null, 2)}\n`)
    if (parsed.sheet.render) {
      const ran = await $.process.run(parsed.sheet.render.split(/\s+/), { stdin: '', timeoutMs: RENDER_MS })
      if (ran.exitCode !== 0) $.ui.log(`worksheet: render failed: ${ran.stderr.trim().slice(0, 200)}`)
    }
    await load($, path)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Worksheet' })
    const where = isPlaced ? 'shown in the Worksheet pane' : 'visible once the person opens /worksheet'
    const missing = outcome.missing.length ? ` Unknown rows: ${outcome.missing.join(', ')}.` : ''
    return { result: `Recorded ${outcome.applied} proposal${outcome.applied === 1 ? '' : 's'} in ${path}, ${where}.${missing} The person's decisions come back as worksheet change messages.` }
  })

  // The desktop's controls are Clients posting { press }; its comment editors post { comment, text }.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const msg = e.data as { press?: unknown; comment?: unknown; text?: unknown } | null
    if (typeof msg?.press === 'string') await press($, msg.press)
    if (typeof msg?.comment === 'string' && typeof msg.text === 'string') {
      const row = msg.comment
      const text = msg.text
      await setState($, x => edit(x, row, 'comment', text))
      scheduleSave($)
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>The worksheet pane draws in the terminal and the desktop app.</Text>
    }
    const surface = e.surface
    const { Box, Text, Button, Client, Input, Markdown } = $.ui.resolve({ ...e, surface })
    const s = await readState($)

    const control = (id: string, text: string, opts: { hotkey?: string; tone?: string } = {}) =>
      surface === 'terminal' ? (
        <Button key={id} label={text} hotkey={opts.hotkey} plain onPress={() => press($, id)} />
      ) : (
        <Client key={id} module="./pill.tsx" props={{ id, label: text, kind: 'button', ...(opts.tone ? { tone: opts.tone } : {}) }} />
      )
    const row = (id: string, text: string, tone: string, dim: boolean) =>
      surface === 'terminal' ? (
        <Button key={id} label={text} plain onPress={() => press($, id)} />
      ) : (
        <Client key={id} module="./pill.tsx" props={{ id, label: text, kind: 'row', tone, dim }} />
      )
    const chip = (id: string, text: string, active: boolean) => control(id, active ? `[${text}]` : text, active ? { tone: 'suggestion' } : {})

    if (s.error) return <Text color="error">{s.error}</Text>
    if (!s.sheet) {
      if (s.paths.length === 0) {
        return <Text dimColor>No worksheet found. List them in {CONFIG} or put *-worksheet.json under {DEFAULT_DIR}.</Text>
      }
      return (
        <Box flexDirection="column">
          <Text dimColor>Pick a worksheet:</Text>
          {s.paths.map(p => row(`pick:${p}`, p, 'suggestion', false))}
        </Box>
      )
    }

    const sheet: Worksheet = s.sheet
    const c = counts(sheet)
    const kept = filterRows(sheet, s.filter)
    const keptIds = new Set(kept.map(r => r.id))
    const tally = [...sheet.choices.map(ch => `${label(ch)} ${c.byPriority[ch] ?? 0}`), `unset ${c.unset}`, `proposals ${c.proposals}${c.differs ? ` (${c.differs} differ)` : ''}`].join(' · ')
    const categories = [...new Set(sheet.rows.flatMap(r => r.suite.categories))]
    const filtered = s.filter.text || s.filter.membership || s.filter.category || s.filter.priority || s.filter.proposed

    const detail = (r: Row) => {
      const refs = r.references.map(x => `[${x.id}](${x.url})${x.version || x.status ? ` (${x.version}; ${x.status})` : ''}`).join('; ')
      return (
        <Box key={`row-${r.id}`} flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
          {row(`open:${r.id}`, `${glyph(r.priority)} ${r.id}  ${r.title}`, 'suggestion', false)}
          {refs !== '' && <Markdown text={refs} />}
          {r.role !== '' && <Text dimColor>{r.role}</Text>}
          {r.suite.membership !== '' && <Text dimColor>suite: {membershipLabel(r.suite)}</Text>}
          {r.proposed.priority || r.proposed.reason ? (
            <Text>
              Claude proposes {r.proposed.priority ? label(r.proposed.priority) : 'nothing'}
              {r.proposed.reason ? `: ${r.proposed.reason}` : ''}
            </Text>
          ) : (
            <Text dimColor>No proposal from Claude yet.</Text>
          )}
          <Box key={`pri-${r.id}`} flexDirection="row" gap={1}>
            {sheet.choices.map(ch => control(`pri:${ch}:${r.id}`, r.priority === ch ? `${label(ch)} ✓` : label(ch), { hotkey: ch[0], tone: r.priority === ch ? 'success' : undefined }))}
          </Box>
          {surface === 'terminal' ? (
            <Input
              key={`comment:${r.id}`}
              label="Comment "
              placeholder="why include, defer or ignore (optional)"
              value={r.comment}
              submitLabel="save"
              onInput={value => setState($, x => edit(x, r.id, 'comment', value)).then(() => scheduleSave($))}
              onSubmit={value => setState($, x => edit(x, r.id, 'comment', value)).then(() => scheduleSave($))}
            />
          ) : (
            <Client
              key={`comment:${s.rev}:${r.id}`}
              module="./note.tsx"
              props={{ item: r.id, value: r.comment, placeholder: 'Comment: why include, defer or ignore (optional)' }}
              width="100%"
            />
          )}
        </Box>
      )
    }

    const sections = sheet.sections.flatMap(sec => {
      const rows = kept.filter(r => r.section === sec.id)
      if (rows.length === 0) return []
      const total = sheet.rows.filter(r => r.section === sec.id).length
      const closed = s.collapsed.includes(sec.id)
      return [
        <Box key={`sec-${sec.id}`} flexDirection="column">
          {row(`sec:${sec.id}`, `${closed ? '▸' : '▾'} ${sec.title} (${rows.length}${rows.length !== total ? ` of ${total}` : ''})`, 'suggestion', false)}
          {!closed &&
            rows.map(r => {
              if (r.id === s.open) return detail(r)
              const proposal = r.proposed.priority ? `  ⟵ ${label(r.proposed.priority)}` : ''
              const note = r.comment.trim() ? '  ✎' : ''
              const pri = r.priority ? ` · ${label(r.priority)}` : ''
              return row(`open:${r.id}`, `${glyph(r.priority)} ${r.id}  ${r.title}${pri}${proposal}${note}`, r.priority ? 'success' : r.proposed.priority ? 'warning' : 'subtle', !r.priority && !r.proposed.priority)
            })}
        </Box>,
      ]
    })

    return (
      <Box flexDirection="column" gap={1}>
        <Box key="head" flexDirection="column">
          <Text bold>{sheet.title}</Text>
          <Text dimColor>
            {s.path} · {tally}
            {s.pending.length ? ' · saving…' : ''}
          </Text>
        </Box>
        <Box key="filters" flexDirection="column">
          <Input
            key="search"
            label="Find "
            placeholder="id, title, XEP, comment"
            value={s.filter.text}
            onInput={value => setState($, x => ({ ...x, filter: { ...x.filter, text: value } }))}
            onSubmit={value => setState($, x => ({ ...x, filter: { ...x.filter, text: value } }))}
          />
          <Box key="f1" flexDirection="row" gap={1} flexWrap="wrap">
            {MEMBERSHIPS.map(m => chip(`fm:${m}`, m, s.filter.membership === m))}
            {chip('fm:none', 'not in suite', s.filter.membership === 'none')}
            {categories.map(cat => chip(`fc:${cat}`, cat, s.filter.category === cat))}
          </Box>
          <Box key="f2" flexDirection="row" gap={1} flexWrap="wrap">
            {sheet.choices.map(ch => chip(`fp:${ch}`, label(ch), s.filter.priority === ch))}
            {chip(`fp:${UNSET}`, 'unset', s.filter.priority === UNSET)}
            {chip('fx:any', 'proposed', s.filter.proposed === 'any')}
            {chip('fx:differs', 'proposal differs', s.filter.proposed === 'differs')}
            {Boolean(filtered) && control('clearfilter', 'Clear filters')}
          </Box>
          <Text dimColor>
            {kept.length} of {sheet.rows.length} rows{s.open && !keptIds.has(s.open) ? ' (the open row is filtered out)' : ''}
          </Text>
        </Box>
        <Box key="sections" flexDirection="column" gap={1}>
          {sections}
        </Box>
        <Box key="foot" flexDirection="row" gap={2}>
          {control('send', s.log.length ? `Send ${s.log.length} change${s.log.length === 1 ? '' : 's'}` : 'Send changes', { hotkey: 's', tone: s.log.length ? 'suggestion' : undefined })}
          {control('notify', s.notify ? 'Notify: on' : 'Notify: off', { hotkey: 'y', tone: s.notify ? 'success' : undefined })}
          {control('reload', 'Reload', { hotkey: 'r' })}
          {s.paths.length > 1 && s.paths.filter(p => p !== s.path).map(p => control(`pick:${p}`, p.split('/').pop() ?? p))}
          {s.sent > 0 && <Text dimColor>sent {s.sent}</Text>}
        </Box>
      </Box>
    )
  })
}
