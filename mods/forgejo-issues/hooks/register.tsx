import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Data, Detail, Format, RepoInfo, Ui } from '../types'
import { parseRemote, pickToken, tokenKey, toComments, toIssues, toLabels, toMilestones } from './forge'
import { touchesSecrets } from './guard'
import { labelIds, milestoneId, newIssueProblem, parseLabelList, toggleScoped } from './triage'
import { editorArgv } from './editing'
import type { TriageRules } from './triage'
import { filterIssues } from './search'
import { detailView, listView, newIssueView } from './views'

const PANE = 'forgejo-issues'
const GUARDED = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'])
// Forgejo's default page cap; a smaller one only means more requests.
const PAGE = 50
const MAX_PAGES = 40

const DARK_BORDER = '#3a3a3a'
const LIGHT_BORDER = '#d0d0d0'
const DARK_RAISED = '#232323'
const LIGHT_RAISED = '#f4f4f4'
const EMPTY_DATA: Data = { status: 'idle', repo: null, issues: [], labels: [], milestones: [], message: null, tokenSource: null, fetchedAt: 0, border: DARK_BORDER, raised: DARK_RAISED }
const EMPTY_UI: Ui = {
  query: '',
  chips: [],
  milestone: '',
  state: 'open',
  grouped: true,
  open: null,
  draft: '',
  armed: null,
  busy: false,
  notice: null,
  editingLabels: null,
  creating: null,
  sync: {},
  fmt: {},
  preview: {},
  external: null,
}
const data = atom({ plugin: 'forgejo-issues', key: 'data' } as const, EMPTY_DATA)
const ui = atom({ plugin: 'forgejo-issues', key: 'ui' } as const, EMPTY_UI)
const detail = atom({ plugin: 'forgejo-issues', key: 'detail' } as const, null as Detail | null)

let apiUrl = ''
let requireCommentOnClose = true
let triageRules: TriageRules = { requireMilestone: false, requireLabelFrom: [] }
let editorCommand = ''
let home = ''
let configHome = ''
// Held in the module, never in $.state: the token stays out of anything drawn or logged.
let auth: { apiBase: string; token: string; repo: RepoInfo; source: 'secrets' | 'fgj' } | null = null

// State saved by an older version of the mod lacks newer fields: fill in the
// defaults on every read so a missing field never reaches the drawing.
async function readUi($: $): Promise<Ui> {
  return { ...EMPTY_UI, ...(await read($, ui)) }
}

async function readData($: $): Promise<Data> {
  return { ...EMPTY_DATA, ...(await read($, data)) }
}

async function readOrNull($: $, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function paths($: $): Promise<void> {
  if (home) return
  home = (await $.env.get('HOME')) ?? ''
  configHome = (await $.env.get('XDG_CONFIG_HOME')) || `${home}/.config`
}

function secretsDir(): string {
  return `${configHome}/claude-mods/secrets`
}

/** Finds the repo and its token; a string is why it could not. */
async function resolveAuth($: $): Promise<string | null> {
  await paths($)
  const cwd = await $.session.cwd()
  const remote = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd, timeoutMs: 5_000 })
  if (remote.exitCode !== 0) return 'This folder has no git remote named origin.'
  const ref = parseRemote(remote.stdout, apiUrl)
  if (!ref) return `Could not read the remote: ${remote.stdout.trim()}`
  const repo = { host: ref.host, owner: ref.owner, repo: ref.repo, webBase: ref.webBase }
  await update($, data, (d): Data => ({ ...d, repo }))
  const found = pickToken(
    ref.host,
    await readOrNull($, `${secretsDir()}/forgejo.env`),
    await readOrNull($, `${home}/.config/fgj/config.yaml`),
  )
  if (!found) return `No token for ${ref.host}. Add ${tokenKey(ref.host)}=<token> to ${secretsDir()}/forgejo.env`
  auth = { apiBase: ref.apiBase, token: found.token, repo, source: found.source }
  return null
}

/** Calls the API; a string is the failure, worded for the pane. */
async function request(
  $: $,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ text: string; total: number | null } | string> {
  if (!auth) return 'Not connected.'
  let res
  try {
    res = await $.http.fetch(`${auth.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `token ${auth.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (err) {
    return `Could not reach ${auth.repo.host}: ${err instanceof Error ? err.message : String(err)}`
  }
  const from = auth.source === 'secrets' ? tokenKey(auth.repo.host) : 'fgj'
  if (res.status === 401) return `${auth.repo.host} refused the token from ${from} (401).`
  if (res.status === 403) {
    return method === 'GET'
      ? `${auth.repo.host} refused the token from ${from} (403).`
      : `${auth.repo.host} refused the change (403): the token from ${from} may lack write access to issues.`
  }
  if (res.status === 404) return `${auth.repo.owner}/${auth.repo.repo} is not on ${auth.repo.host}, or is not a Forgejo/Gitea repo.`
  if (!res.ok) return `${auth.repo.host} answered ${res.status}.`
  const header = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'x-total-count')?.[1]
  return { text: res.text, total: header ? Number(header) : null }
}

function get($: $, path: string) {
  return request($, 'GET', path)
}

/** Every page of a list endpoint, parsed and joined. */
async function getAll<T>($: $, path: string, parse: (json: string) => T[]): Promise<T[] | string> {
  const out: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await get($, `${path}${sep}limit=${PAGE}&page=${page}`)
    if (typeof res === 'string') return res
    const items = parse(res.text)
    out.push(...items)
    if (items.length < PAGE || (res.total !== null && out.length >= res.total)) break
  }
  return out
}

async function fail($: $, message: string): Promise<void> {
  await update($, data, (d): Data => ({ ...d, status: 'error', message }))
}

async function load($: $): Promise<void> {
  await update($, data, (d): Data => ({ ...d, status: 'loading', message: null }))
  const why = await resolveAuth($)
  if (why) return fail($, why)
  const base = `/repos/${auth!.repo.owner}/${auth!.repo.repo}`
  try {
    const [issues, labels, milestones] = await Promise.all([
      getAll($, `${base}/issues?state=all&type=issues`, toIssues),
      getAll($, `${base}/labels`, toLabels),
      getAll($, `${base}/milestones?state=all`, toMilestones),
    ])
    if (typeof issues === 'string') return fail($, issues)
    if (typeof labels === 'string') return fail($, labels)
    if (typeof milestones === 'string') return fail($, milestones)
    const fetchedAt = await $.clock.now()
    const tokenSource = auth!.source
    // The theme names light ones as such (light, light-daltonized, ...); anything else draws dark.
    const theme = String((await $.config.list()).find(row => row.key === 'theme')?.value ?? '')
    const isLight = theme.includes('light')
    const border = isLight ? LIGHT_BORDER : DARK_BORDER
    const raised = isLight ? LIGHT_RAISED : DARK_RAISED
    await update($, data, (d): Data => ({ ...d, status: 'ready', message: null, issues, labels, milestones, tokenSource, fetchedAt, border, raised }))
  } catch (err) {
    await fail($, `Unexpected answer from ${auth!.repo.host}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function openIssue($: $, n: number): Promise<void> {
  await update($, ui, (u): Ui => bump({ ...u, open: n, draft: '', armed: null, notice: null }, 'comment'))
  const d = await readData($)
  if (!d.issues.some(i => i.number === n)) return
  await update($, detail, (): Detail => ({ number: n, status: 'loading', comments: [], message: null }))
  if (!auth) {
    const why = await resolveAuth($)
    if (why) {
      await update($, detail, (): Detail => ({ number: n, status: 'error', comments: [], message: why }))
      return
    }
  }
  const res = await getAll($, `/repos/${auth!.repo.owner}/${auth!.repo.repo}/issues/${n}/comments`, toComments)
  await update($, detail, (cur): Detail | null =>
    cur?.number !== n
      ? cur
      : typeof res === 'string'
        ? { number: n, status: 'error', comments: [], message: res }
        : { number: n, status: 'ready', comments: res, message: null },
  )
}

async function openFirst($: $): Promise<void> {
  const [d, u] = await Promise.all([readData($), readUi($)])
  const top = filterIssues(d.issues, u)[0]
  if (top) await openIssue($, top.issue.number)
}

async function toggleChip($: $, name: string): Promise<void> {
  const d = await readData($)
  await update($, ui, (u): Ui => ({ ...u, chips: toggleScoped(u.chips, name, d.labels) }))
}

async function notify($: $, tone: 'ok' | 'error', text: string): Promise<void> {
  await update($, ui, (u): Ui => ({ ...u, notice: { tone, text }, armed: null }))
}

/** Swaps in the issue the API answered for a write, so the list and the detail view agree. */
async function replaceIssue($: $, json: string): Promise<void> {
  const fresh = toIssues(`[${json}]`)[0]
  if (fresh) await update($, data, (d): Data => ({ ...d, issues: d.issues.map(i => (i.number === fresh.number ? fresh : i)) }))
}

/** Posts the draft as a comment on issue `n`; false when it did not land. */
async function postComment($: $, n: number, text: string): Promise<boolean> {
  const res = await request($, 'POST', `/repos/${auth!.repo.owner}/${auth!.repo.repo}/issues/${n}/comments`, { body: text })
  if (typeof res === 'string') {
    await notify($, 'error', res)
    return false
  }
  const posted = toComments(`[${res.text}]`)
  await update($, detail, (cur): Detail | null =>
    cur?.number === n ? { ...cur, comments: [...cur.comments, ...posted] } : cur,
  )
  await update($, data, (d): Data => ({
    ...d,
    issues: d.issues.map(i => (i.number === n ? { ...i, comments: i.comments + 1 } : i)),
  }))
  await update($, ui, (u): Ui => bump({ ...u, draft: '' }, 'comment'))
  return true
}

/** Runs one write with the pane marked busy, so a second press waits for it. */
async function write($: $, run: () => Promise<void>): Promise<void> {
  const u = await readUi($)
  if (u.busy) return
  await update($, ui, (x): Ui => ({ ...x, busy: true, notice: null }))
  try {
    if (!auth) {
      const why = await resolveAuth($)
      if (why) return notify($, 'error', why)
    }
    await run()
  } finally {
    await update($, ui, (x): Ui => ({ ...x, busy: false }))
  }
}

async function comment($: $): Promise<void> {
  const u = await readUi($)
  const n = u.open
  const text = u.draft.trim()
  if (n === null || !text) return
  await write($, async () => {
    if (await postComment($, n, text)) await notify($, 'ok', `Commented on #${n}.`)
  })
}

/** Close or reopen: the first press arms it (and checks the comment rule), Confirm runs it. */
async function arm($: $, action: 'close' | 'reopen'): Promise<void> {
  const u = await readUi($)
  if (action === 'close' && requireCommentOnClose && !u.draft.trim()) {
    return notify($, 'error', 'Write a comment first: closing posts it, then closes, so the issue says why.')
  }
  await update($, ui, (x): Ui => ({ ...x, armed: action, notice: null }))
}

async function confirm($: $): Promise<void> {
  const u = await readUi($)
  const n = u.open
  const action = u.armed
  if (n === null || (action !== 'close' && action !== 'reopen')) return
  const text = u.draft.trim()
  await write($, async () => {
    if (text && !(await postComment($, n, text))) return
    const res = await request($, 'PATCH', `/repos/${auth!.repo.owner}/${auth!.repo.repo}/issues/${n}`, {
      state: action === 'close' ? 'closed' : 'open',
    })
    if (typeof res === 'string') return notify($, 'error', res)
    await replaceIssue($, res.text)
    await notify($, 'ok', `${action === 'close' ? 'Closed' : 'Reopened'} #${n}${text ? ' with a comment' : ''}.`)
  })
}

function repoPath(): string {
  return `/repos/${auth!.repo.owner}/${auth!.repo.repo}`
}

/** Re-reads one issue after a write whose answer is not the issue itself. */
async function refetchIssue($: $, n: number): Promise<string | null> {
  const res = await get($, `${repoPath()}/issues/${n}`)
  if (typeof res === 'string') return res
  await replaceIssue($, res.text)
  return null
}

async function saveLabels($: $): Promise<void> {
  const [d, u] = await Promise.all([readData($), readUi($)])
  const n = u.open
  const names = u.editingLabels
  if (n === null || names === null) return
  await write($, async () => {
    const res = await request($, 'PUT', `${repoPath()}/issues/${n}/labels`, { labels: labelIds(names, d.labels) })
    if (typeof res === 'string') return notify($, 'error', res)
    const why = await refetchIssue($, n)
    if (why) return notify($, 'error', why)
    await update($, ui, (x): Ui => ({ ...x, editingLabels: null }))
    await notify($, 'ok', `Labels saved on #${n}.`)
  })
}

async function setMilestone($: $, title: string): Promise<void> {
  const [d, u] = await Promise.all([readData($), readUi($)])
  const n = u.open
  if (n === null) return
  await write($, async () => {
    const res = await request($, 'PATCH', `${repoPath()}/issues/${n}`, { milestone: milestoneId(title || null, d.milestones) })
    if (typeof res === 'string') return notify($, 'error', res)
    await replaceIssue($, res.text)
    await notify($, 'ok', title ? `#${n} moved to ${title}.` : `#${n} has no milestone now.`)
  })
}

async function createIssue($: $): Promise<void> {
  const [d, u] = await Promise.all([readData($), readUi($)])
  const draft = u.creating
  if (!draft) return
  const problem = newIssueProblem(draft, triageRules)
  if (problem) return notify($, 'error', problem)
  await write($, async () => {
    const res = await request($, 'POST', `${repoPath()}/issues`, {
      title: draft.title.trim(),
      body: draft.body.trim(),
      labels: labelIds(draft.labels, d.labels),
      ...(draft.milestone ? { milestone: milestoneId(draft.milestone, d.milestones) } : {}),
    })
    if (typeof res === 'string') return notify($, 'error', res)
    const created = toIssues(`[${res.text}]`)[0]
    if (!created) return notify($, 'error', 'The forge answered without the new issue.')
    await update($, data, (x): Data => ({ ...x, issues: [created, ...x.issues] }))
    await update($, ui, (x): Ui => ({ ...x, creating: null }))
    await openIssue($, created.number)
    await notify($, 'ok', `Filed #${created.number}.`)
  })
}

/** The text behind an editor id: the comment draft, or a field of the new-issue form. */
function getField(u: Ui, id: string): string {
  if (id === 'comment') return u.draft
  if (id === 'new-title') return u.creating?.title ?? ''
  if (id === 'new-body') return u.creating?.body ?? ''
  return ''
}

function setField(u: Ui, id: string, text: string): Ui {
  if (id === 'comment') return { ...u, draft: text, armed: null }
  if (id === 'new-title' && u.creating) return { ...u, creating: { ...u.creating, title: text } }
  if (id === 'new-body' && u.creating) return { ...u, creating: { ...u.creating, body: text } }
  return u
}

/** Marks an editor's text as replaced from here, so the editor adopts it. */
function bump(u: Ui, id: string): Ui {
  return { ...u, sync: { ...u.sync, [id]: (u.sync[id] ?? 0) + 1 } }
}

function isFormat(f: string | undefined): f is Format {
  return f === 'bold' || f === 'italic' || f === 'code' || f === 'link' || f === 'heading' || f === 'list' || f === 'quote'
}

/**
 * Hands an editor's text to the external editor: writes it to a file, runs
 * the configured command, and takes the file back when the command exits. A
 * command that returns at once (a launcher that forks) leaves the session
 * open; the "Use editor text" pill takes the file back by hand.
 */
async function openExternal($: $, id: string): Promise<void> {
  if (!editorCommand) return notify($, 'error', 'Set the External editor command in the mod settings first.')
  const u = await readUi($)
  const dir = (await $.env.get('XDG_RUNTIME_DIR')) || '/tmp'
  const file = `${dir}/claude-mods-forgejo-${id}.md`
  await $.fs.write(file, getField(u, id))
  await update($, ui, (x): Ui => ({ ...x, external: { id, file }, notice: { tone: 'ok', text: 'Editing in your editor: save and quit to bring the text back.' } }))
  const started = await $.clock.now()
  try {
    const stream = $.process.spawn({ argv: editorArgv(editorCommand, file) })
    for await (const _ of stream) {
      // The editor's own output is not used; reading it keeps the process ours.
    }
    const done = await stream.result
    if (done.code !== 0 && done.code !== null) return notify($, 'error', `The editor command exited with ${done.code}.`)
  } catch (err) {
    return notify($, 'error', `Could not start the editor: ${err instanceof Error ? err.message : String(err)}`)
  }
  if ((await $.clock.now()) - started < 1500) {
    return notify($, 'ok', 'The editor command returned straight away. When you are done, press Use editor text.')
  }
  await pullExternal($)
}

async function pullExternal($: $): Promise<void> {
  const u = await readUi($)
  if (!u.external) return
  const { id, file } = u.external
  let text: string
  try {
    text = await $.fs.read(file)
  } catch {
    return notify($, 'error', 'The editor file is gone; nothing to bring back.')
  }
  await update($, ui, (x): Ui => bump({ ...setField(x, id, text.replace(/\n$/, '')), external: null }, id))
  await $.process.run(['rm', '-f', file])
  await notify($, 'ok', 'Brought the text back from your editor.')
}

/** A pill's id, as pill.tsx posts it: `state:open`, `chip:<label>`, `open:<n>`, `back`, ... */
async function press($: $, id: string): Promise<void> {
  const [kind, ...rest] = id.split(':')
  const arg = rest.join(':')
  if (kind === 'state' && (arg === 'open' || arg === 'closed' || arg === 'all')) {
    await update($, ui, (x): Ui => ({ ...x, state: arg }))
  } else if (kind === 'grouped') {
    await update($, ui, (x): Ui => ({ ...x, grouped: !x.grouped }))
  } else if (kind === 'refresh') {
    await load($)
  } else if (kind === 'chip') {
    await toggleChip($, arg)
  } else if (kind === 'back') {
    await update($, ui, (x): Ui => ({ ...x, open: null }))
  } else if (kind === 'open' && /^\d+$/.test(arg)) {
    await openIssue($, Number(arg))
  } else if (kind === 'comment') {
    await comment($)
  } else if (kind === 'close' || kind === 'reopen') {
    await arm($, kind)
  } else if (kind === 'confirm') {
    await confirm($)
  } else if (kind === 'cancel') {
    await update($, ui, (x): Ui => ({ ...x, armed: null }))
  } else if (kind === 'labels') {
    await pressLabels($, arg)
  } else if (kind === 'new') {
    await pressNew($, arg)
  } else if (kind === 'fmt') {
    const [id, format] = arg.split(':')
    if (id && isFormat(format)) {
      await update($, ui, (x): Ui => ({ ...x, fmt: { ...x.fmt, [id]: { seq: (x.fmt[id]?.seq ?? 0) + 1, format } } }))
    }
  } else if (kind === 'preview') {
    await update($, ui, (x): Ui => ({ ...x, preview: { ...x.preview, [arg]: !x.preview[arg] } }))
  } else if (kind === 'editor') {
    // Not awaited: an editing session outlasts any hook's time budget.
    void openExternal($, arg)
  } else if (kind === 'editor-pull') {
    await pullExternal($)
  }
}

/** `labels:edit`, `labels:save`, `labels:cancel`, `labels:toggle:<name>` in the detail view. */
async function pressLabels($: $, arg: string): Promise<void> {
  const d = await readData($)
  if (arg === 'edit') {
    const u = await readUi($)
    const issue = d.issues.find(i => i.number === u.open)
    if (issue) await update($, ui, (x): Ui => ({ ...x, editingLabels: issue.labels.map(l => l.name), notice: null }))
  } else if (arg === 'save') {
    await saveLabels($)
  } else if (arg === 'cancel') {
    await update($, ui, (x): Ui => ({ ...x, editingLabels: null }))
  } else if (arg.startsWith('toggle:')) {
    const name = arg.slice('toggle:'.length)
    await update($, ui, (x): Ui => (x.editingLabels ? { ...x, editingLabels: toggleScoped(x.editingLabels, name, d.labels) } : x))
  }
}

/** `new:start`, `new:create`, `new:cancel`, `new:toggle:<name>` for the new-issue form. */
async function pressNew($: $, arg: string): Promise<void> {
  const d = await readData($)
  if (arg === 'start') {
    await update($, ui, (x): Ui =>
      bump(bump({ ...x, open: null, notice: null, creating: { title: '', body: '', labels: [], milestone: '' } }, 'new-title'), 'new-body'),
    )
  } else if (arg === 'create') {
    await createIssue($)
  } else if (arg === 'cancel' || arg === 'back') {
    await update($, ui, (x): Ui => ({ ...x, creating: null, notice: null }))
  } else if (arg.startsWith('toggle:')) {
    const name = arg.slice('toggle:'.length)
    await update($, ui, (x): Ui =>
      x.creating ? { ...x, creating: { ...x.creating, labels: toggleScoped(x.creating.labels, name, d.labels) } } : x,
    )
  }
}

async function guard($: $, tool: string, input: Record<string, unknown>): Promise<string | null> {
  await paths($)
  if (!configHome || !touchesSecrets(tool, input, secretsDir(), home)) return null
  return `${$.plugin.name}: ${secretsDir()} holds tokens for claude-mods and is kept from the model. Ask the user if something there needs checking.`
}

export const register: Register = (on, options) => {
  apiUrl = typeof options?.apiUrl === 'string' ? options.apiUrl : ''
  requireCommentOnClose = options?.requireCommentOnClose !== false
  editorCommand = typeof options?.editorCommand === 'string' ? options.editorCommand.trim() : ''
  triageRules = {
    requireMilestone: options?.requireMilestone === true,
    requireLabelFrom: parseLabelList(typeof options?.requireLabelFrom === 'string' ? options.requireLabelFrom : ''),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'issues', description: "Show this repo's Forgejo issues in a pane" })
    return next(e)
  })

  on('command.run', { command: 'issues' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Issues' })
    void load($)
    return { text: 'Issues pane opened.' }
  })

  // One hook for every tool: builds differ in which file tools they have
  // (some search with Grep/Glob, some only through Bash).
  on('tool.call', async ($, e, next) => {
    if (!GUARDED.has(e.tool)) return next(e)
    const deny = await guard($, e.tool, e as unknown as Record<string, unknown>)
    return deny ? { deny } : next(e)
  })

  // Every pressable control is a Client (cards, pills) posting a message.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const msg = e.data as { open?: unknown; press?: unknown; edit?: unknown; text?: unknown; submit?: unknown } | null
    if (typeof msg?.edit === 'string' && typeof msg.text === 'string') {
      const id = msg.edit
      const text = msg.text
      await update($, ui, (x): Ui => setField(x, id, text))
    }
    if (msg?.submit === 'comment') await comment($)
    if (msg?.submit === 'new-title' || msg?.submit === 'new-body') await createIssue($)
    if (typeof msg?.open === 'number') await openIssue($, msg.open)
    if (typeof msg?.press === 'string') await press($, msg.press)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>The issues pane draws in the terminal and the desktop app.</Text>
    }
    const el = $.ui.resolve(e)
    const [d, u, dt] = await Promise.all([readData($), readUi($), read($, detail)])
    // Ages count from the fetch: drawing stays a pure function of state.
    const now = d.fetchedAt
    const issue = u.open === null ? undefined : d.issues.find(i => i.number === u.open)
    if (u.creating) {
      return newIssueView(el, d, u, u.creating, triageRules, editorCommand !== '', {
        milestone: value => update($, ui, (x): Ui => (x.creating ? { ...x, creating: { ...x.creating, milestone: value } } : x)),
      })
    }
    if (issue) {
      return detailView(el, d, issue, dt, u, now, editorCommand !== '', {
        milestone: value => setMilestone($, value),
      })
    }
    return listView(el, d, u, now, e.surface === 'desktop', {
      query: text => update($, ui, (x): Ui => ({ ...x, query: text })),
      openFirst: () => openFirst($),
      milestone: value => update($, ui, (x): Ui => ({ ...x, milestone: value })),
    })
  })
}
