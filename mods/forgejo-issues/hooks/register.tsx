import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Data, Detail, RepoInfo, Ui } from '../types'
import { parseRemote, pickToken, tokenKey, toComments, toIssues, toLabels, toMilestones } from './forge'
import { touchesSecrets } from './guard'
import { filterIssues } from './search'
import { detailView, listView } from './views'

const PANE = 'forgejo-issues'
const GUARDED = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'])
// Forgejo's default page cap; a smaller one only means more requests.
const PAGE = 50
const MAX_PAGES = 40

const DARK_BORDER = '#3a3a3a'
const LIGHT_BORDER = '#d0d0d0'
const EMPTY_DATA: Data = { status: 'idle', repo: null, issues: [], labels: [], milestones: [], message: null, tokenSource: null, fetchedAt: 0, border: DARK_BORDER }
const EMPTY_UI: Ui = { query: '', chips: [], milestone: '', state: 'open', grouped: true, open: null }
const data = atom({ plugin: 'forgejo-issues', key: 'data' } as const, EMPTY_DATA)
const ui = atom({ plugin: 'forgejo-issues', key: 'ui' } as const, EMPTY_UI)
const detail = atom({ plugin: 'forgejo-issues', key: 'detail' } as const, null as Detail | null)

let apiUrl = ''
let home = ''
let configHome = ''
// Held in the module, never in $.state: the token stays out of anything drawn or logged.
let auth: { apiBase: string; token: string; repo: RepoInfo; source: 'secrets' | 'fgj' } | null = null

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

/** GETs an API path; a string is the failure, worded for the pane. */
async function get($: $, path: string): Promise<{ text: string; total: number | null } | string> {
  if (!auth) return 'Not connected.'
  let res
  try {
    res = await $.http.fetch(`${auth.apiBase}${path}`, {
      headers: { Authorization: `token ${auth.token}`, Accept: 'application/json' },
    })
  } catch (err) {
    return `Could not reach ${auth.repo.host}: ${err instanceof Error ? err.message : String(err)}`
  }
  if (res.status === 401 || res.status === 403) {
    return `${auth.repo.host} refused the token from ${auth.source === 'secrets' ? tokenKey(auth.repo.host) : 'fgj'} (${res.status}).`
  }
  if (res.status === 404) return `${auth.repo.owner}/${auth.repo.repo} is not on ${auth.repo.host}, or is not a Forgejo/Gitea repo.`
  if (!res.ok) return `${auth.repo.host} answered ${res.status}.`
  const header = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'x-total-count')?.[1]
  return { text: res.text, total: header ? Number(header) : null }
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
    const border = theme.includes('light') ? LIGHT_BORDER : DARK_BORDER
    await update($, data, (d): Data => ({ ...d, status: 'ready', message: null, issues, labels, milestones, tokenSource, fetchedAt, border }))
  } catch (err) {
    await fail($, `Unexpected answer from ${auth!.repo.host}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function openIssue($: $, n: number): Promise<void> {
  await update($, ui, (u): Ui => ({ ...u, open: n }))
  const d = await read($, data)
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
  const [d, u] = await Promise.all([read($, data), read($, ui)])
  const top = filterIssues(d.issues, u)[0]
  if (top) await openIssue($, top.issue.number)
}

async function toggleChip($: $, name: string): Promise<void> {
  const d = await read($, data)
  const at = name.lastIndexOf('/')
  const scope = at > 0 ? name.slice(0, at + 1) : null
  // An exclusive scope holds one label at a time, so its chips pick one.
  const exclusive = scope !== null && d.labels.some(l => l.exclusive && l.name.startsWith(scope))
  await update($, ui, (u): Ui => {
    if (u.chips.includes(name)) return { ...u, chips: u.chips.filter(c => c !== name) }
    const kept = exclusive && scope ? u.chips.filter(c => !c.startsWith(scope)) : u.chips
    return { ...u, chips: [...kept, name] }
  })
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
  }
}

async function guard($: $, tool: string, input: Record<string, unknown>): Promise<string | null> {
  await paths($)
  if (!configHome || !touchesSecrets(tool, input, secretsDir(), home)) return null
  return `${$.plugin.name}: ${secretsDir()} holds tokens for claude-mods and is kept from the model. Ask the user if something there needs checking.`
}

export const register: Register = (on, options) => {
  apiUrl = typeof options?.apiUrl === 'string' ? options.apiUrl : ''

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
    const msg = e.data as { open?: unknown; press?: unknown } | null
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
    const [d, u, dt] = await Promise.all([read($, data), read($, ui), read($, detail)])
    // Ages count from the fetch: drawing stays a pure function of state.
    const now = d.fetchedAt
    const issue = u.open === null ? undefined : d.issues.find(i => i.number === u.open)
    if (issue) return detailView(el, d, issue, dt, now)
    return listView(el, d, u, now, e.surface === 'desktop', {
      query: text => update($, ui, (x): Ui => ({ ...x, query: text })),
      openFirst: () => openFirst($),
      milestone: value => update($, ui, (x): Ui => ({ ...x, milestone: value })),
    })
  })
}
