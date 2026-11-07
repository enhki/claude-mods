import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Item, Mark, Reading, Source } from '../types'
import {
  comment,
  EMPTY,
  GLYPH,
  issueArgv,
  label,
  mark,
  MARKS,
  MAX_CONTENT,
  merge,
  parse,
  parseRemote,
  results,
  setContent,
  setLoading,
  slice,
  summary,
  tally,
  toggle,
  TOOL_DESCRIPTION,
  whole,
  type Remote,
} from './read'
import { tablesToLists } from './tables'

const PANE = 'reading'
const TOOL = 'publish_reading'

// Change the tag when an item's fields change: it declines what an earlier version stored.
const current = atom({ plugin: 'reading', key: 'current' } as const, EMPTY, { shape: 'reading-1' })

// Saved state from an older version lacks newer fields: fill defaults on reads and updates.
const readList = async ($: $): Promise<Reading> => whole(await read($, current))
const setList = ($: $, fn: (r: Reading) => Reading) => update($, current, (x): Reading => fn(whole(x)))

let issueCommand = ''
let remote: Remote | null = null

const LABEL: Record<Mark, string> = { read: 'Read', acknowledged: 'Acknowledge', agreed: 'Agree', discuss: 'Discuss', unread: '' }
const TONE: Record<Mark, string> = { read: 'suggestion', acknowledged: 'success', agreed: 'success', discuss: 'warning', unread: 'subtle' }
// Hotkeys by mark; agreed cannot take its first letter, which acknowledged holds.
const HOTKEY: Record<Mark, string> = { read: 'r', acknowledged: 'a', agreed: 'g', discuss: 'd', unread: '' }
const LANGUAGE: Record<string, string> = {
  hs: 'haskell',
  py: 'python',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  json: 'json',
  toml: 'toml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  cabal: 'text',
}

function language(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  return LANGUAGE[ext] ?? 'text'
}

/** Loads a file or issue item's content; URL and inline items carry their own. */
async function load($: $, src: Source): Promise<{ content?: string; error?: string }> {
  try {
    if (src.kind === 'file') {
      const raw = await $.fs.read(src.path)
      const part = slice(typeof raw === 'string' ? raw : '', src)
      return { content: part.length > MAX_CONTENT ? `${part.slice(0, MAX_CONTENT)}\n\n(cut at ${MAX_CONTENT} characters)` : part }
    }
    if (src.kind === 'issue') {
      const argv = issueArgv(issueCommand, remote, src.repo, src.number)
      if (!argv) return { error: 'No way to read issues here: set the issue command in the mod settings, or run in a repository with an origin remote.' }
      // Standard input is closed so a command cannot wait on it, and the wait is bounded.
      const ran = await $.process.run(argv, { stdin: '', timeoutMs: LOAD_MS })
      if (ran.exitCode !== 0) return { error: `${argv[0]} exited ${ran.exitCode}: ${ran.stderr.trim().slice(0, 300) || 'no output'}` }
      return { content: ran.stdout.slice(0, MAX_CONTENT) }
    }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

const LOAD_MS = 8_000

/**
 * Loads an item on a timer of its own: a press hook has a budget of a few
 * seconds and must not wait on a file or a command, so it marks the item
 * loading and hands the work to `$.clock.after`, whose dispatch is its own.
 */
function loadLater($: $, key: string, src: Source): void {
  $.clock.after(0, () => {
    void (async () => {
      const loaded = await load($, src)
      await setList($, r => setContent(r, key, loaded))
    })().catch(err => $.ui.log(`reading: load failed: ${err instanceof Error ? err.message : String(err)}`))
  })
}

/** Press ids: `<action>` or `<action>:<item key>`, every one a control of this pane. */
async function press($: $, id: string): Promise<void> {
  const at = id.indexOf(':')
  const action = at === -1 ? id : id.slice(0, at)
  const key = at === -1 ? '' : id.slice(at + 1)
  if (action === 'read' || action === 'acknowledged' || action === 'agreed' || action === 'discuss') {
    await setList($, r => mark(r, key, action))
  } else if (action === 'open' || action === 'reload') {
    const before = await readList($)
    const item = before.items.find(it => it.key === key)
    if (!item) return
    const opening = action === 'reload' || before.open !== key
    const loadable = item.source.kind === 'file' || item.source.kind === 'issue'
    const wanted = opening && loadable && !item.loading && (action === 'reload' || item.content === undefined)
    await setList($, r => {
      const next = action === 'open' ? toggle(r, key) : r
      return wanted ? setLoading(next, key) : next
    })
    if (wanted) loadLater($, key, item.source)
  } else if (action === 'send') {
    const r = await readList($)
    if (r.items.length === 0) return
    await setList($, x => ({ ...x, sent: x.sent + 1 }))
    try {
      await $.prompt.submit({ text: results(r) })
      $.ui.toast('Reading results sent to Claude')
    } catch (err) {
      $.ui.log(`reading: could not send the results: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else if (action === 'clear') {
    await setList($, x => ({ ...EMPTY, rev: x.rev + 1 }))
  }
}

export const register: Register = (on, options) => {
  issueCommand = typeof options?.issueCommand === 'string' ? options.issueCommand.trim() : ''

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'reading', description: 'Show the reading list Claude published' })
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What this list is for, e.g. "Session 9 inputs"' },
          intro: { type: 'string', description: 'One or two lines of context for the whole list' },
          replace: { type: 'boolean', description: 'Start a new list instead of merging into the one shown' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The item, in a few words' },
                why: { type: 'string', description: 'One line on why it is worth reading now' },
                path: { type: 'string', description: 'A file to read, relative to the working directory or absolute' },
                lines: { type: 'string', description: 'An inclusive line range of the file, like "5-15"' },
                heading: { type: 'string', description: 'A heading of the file whose section is the item' },
                issue: { type: 'integer', description: 'An issue number to read' },
                repo: { type: 'string', description: 'owner/repo of the issue when it is not the session repository' },
                url: { type: 'string', description: 'A link to read; shown, not fetched' },
                text: { type: 'string', description: 'Inline Markdown to read, such as a note from you' },
              },
              required: ['title'],
            },
          },
        },
        required: ['title', 'items'],
      },
      isDeferred: false,
    })
    try {
      const ran = await $.process.run(['git', 'remote', 'get-url', 'origin'])
      remote = ran.exitCode === 0 ? parseRemote(ran.stdout) : null
    } catch {
      remote = null
    }
    return result
  })

  on('command.run', { command: 'reading' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Reading', focus: true })
    return { text: 'Reading pane opened.' }
  })

  on('tool.call', { tool: `mcp__reading__${TOOL}` }, async ($, e) => {
    const parsed = parse(e)
    if ('error' in parsed) return { deny: `${TOOL}: ${parsed.error}` }
    const before = await readList($)
    const merged = merge(before, parsed.reading, parsed.replace)
    await setList($, () => merged)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Reading' })
    const n = parsed.reading.items.length
    const total = merged.items.length
    const where = isPlaced ? 'It is open in the Reading pane' : 'The person opens it with /reading'
    return {
      result:
        `Published ${n} item${n === 1 ? '' : 's'}; the list holds ${total}. ${where}. ` +
        'The results arrive as a message from the reading plugin; wait for them instead of asking in chat.',
    }
  })

  // The desktop's controls are Clients posting { press }; its comment editors post { comment, text }.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const msg = e.data as { press?: unknown; comment?: unknown; text?: unknown } | null
    if (typeof msg?.press === 'string') await press($, msg.press)
    if (typeof msg?.comment === 'string' && typeof msg.text === 'string') {
      const key = msg.comment
      const text = msg.text
      await setList($, r => comment(r, key, text))
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>The reading pane draws in the terminal and the desktop app.</Text>
    }
    const surface = e.surface
    const { Box, Text, Button, Client, Code, Input, Markdown } = $.ui.resolve({ ...e, surface })
    const r = await readList($)
    if (r.items.length === 0) {
      return <Text dimColor>No reading list yet. Claude publishes one when there is something to read.</Text>
    }

    // The terminal draws Buttons (hotkeys, Tab); the desktop drops Button
    // presses from plugin panes, so it gets Client pills.
    const control = (id: string, text: string, opts: { hotkey?: string; tone?: string } = {}) =>
      surface === 'terminal' ? (
        <Button key={id} label={text} hotkey={opts.hotkey} plain onPress={() => press($, id)} />
      ) : (
        // Client props are plain data: an absent tone is left out, never undefined.
        <Client key={id} module="./pill.tsx" props={{ id, label: text, kind: 'button', ...(opts.tone ? { tone: opts.tone } : {}) }} />
      )
    const row = (id: string, text: string, tone: string, dim: boolean) =>
      surface === 'terminal' ? (
        <Button key={id} label={text} plain onPress={() => press($, id)} />
      ) : (
        <Client key={id} module="./pill.tsx" props={{ id, label: text, kind: 'row', tone, dim }} />
      )

    const body = (it: Item) => {
      if (it.error) return <Text color="error">{it.error}</Text>
      const src = it.source
      if (src.kind === 'url') return <Markdown text={`[${src.url}](${src.url})`} />
      // Pipe tables wrap into a tangle at pane widths: they are drawn as lists.
      if (src.kind === 'text') return <Markdown text={tablesToLists(src.text)} />
      if (it.loading) return <Text dimColor>Loading…</Text>
      if (it.content === undefined) return <Text dimColor>Not loaded; press Reload.</Text>
      if (src.kind === 'issue' || /\.(md|markdown)$/i.test(src.path)) return <Markdown text={tablesToLists(it.content || '_Empty._')} />
      return <Code source={it.content || ' '} language={language(src.path)} />
    }

    const t = tally(r)
    const items = r.items.map(it => {
      const head = `${GLYPH[it.mark]} ${it.title}`
      if (it.key !== r.open) {
        const c = it.comment.trim()
        return row(`open:${it.key}`, c ? `${head}  (${c})` : head, TONE[it.mark], it.mark !== 'unread')
      }
      return (
        <Box key={`item-${it.key}`} flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
          {row(`open:${it.key}`, head, TONE[it.mark], false)}
          <Text dimColor>{label(it.source)}</Text>
          {it.why && <Text>{it.why}</Text>}
          <Box key={`body-${it.key}`} flexDirection="column" paddingY={1}>
            {body(it)}
          </Box>
          <Box key={`marks-${it.key}`} flexDirection="row" gap={1}>
            {MARKS.map(k =>
              control(`${k}:${it.key}`, it.mark === k ? `${LABEL[k]} ✓` : LABEL[k], {
                hotkey: HOTKEY[k],
                tone: it.mark === k ? TONE[k] : undefined,
              }),
            )}
            {(it.source.kind === 'file' || it.source.kind === 'issue') && control(`reload:${it.key}`, 'Reload', { hotkey: 'l' })}
          </Box>
          {surface === 'terminal' ? (
            <Input
              key={`comment:${it.key}`}
              label="Comment "
              placeholder="for Claude (optional)"
              value={it.comment}
              submitLabel="save"
              onInput={value => setList($, x => comment(x, it.key, value))}
              onSubmit={value => setList($, x => comment(x, it.key, value))}
            />
          ) : (
            // The desktop's Input is one fixed-width line: a long comment ran out of sight.
            <Client
              key={`comment:${r.rev}:${it.key}`}
              module="./note.tsx"
              props={{ item: it.key, value: it.comment, placeholder: 'Comment for Claude (optional)' }}
              width="100%"
            />
          )}
        </Box>
      )
    })

    const done = t.unread === 0
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="head" flexDirection="column">
          <Text bold>{r.title}</Text>
          <Text dimColor>{summary(t)}</Text>
          {r.intro && <Text>{r.intro}</Text>}
        </Box>
        <Box key="items" flexDirection="column">
          {items}
        </Box>
        <Box key="foot" flexDirection="row" gap={2}>
          {control('send', r.sent > 0 ? 'Send results again' : 'Send results', { hotkey: 's', tone: done ? 'suggestion' : undefined })}
          {control('clear', 'Clear list', { hotkey: 'x' })}
          {r.sent > 0 && <Text dimColor>sent</Text>}
        </Box>
      </Box>
    )
  })
}
