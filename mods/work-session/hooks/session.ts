/** Pure decisions behind the hooks: what to offer, when, and what a title may be. */

export type KickoffMode = 'band' | 'auto' | 'off'
export type StartSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

export const TITLE_MAX = 80
// A rate limit this used up is worth wrapping before it runs out mid-task.
export const RATE_LIMIT_WRAP = 90

export function kickoffMode(raw: unknown): KickoffMode {
  return raw === 'auto' || raw === 'off' ? raw : 'band'
}

/** A command name as typed in settings: no slash, no spaces; empty when unusable. */
export function commandName(raw: unknown, fallback: string): string {
  const name = (typeof raw === 'string' ? raw : fallback).trim().replace(/^\//, '')
  return /^[\w:.-]+$/.test(name) ? name : ''
}

export function hasCommand(list: readonly { name: string }[], name: string): boolean {
  return name !== '' && list.some(c => c.name === name)
}

/** Where a project keeps a slash command of its own, as a command file or a skill. */
export function commandFiles(cwd: string, name: string): string[] {
  const root = cwd.replace(/\/+$/, '')
  return [`${root}/.claude/commands/${name}.md`, `${root}/.claude/skills/${name}/SKILL.md`]
}

/** A fresh working session starts at launch or after /clear; a resume or compact continues one. */
export function isFreshStart(source: StartSource): boolean {
  return source === 'startup' || source === 'clear'
}

/** The title as it will be shown, or why it is refused. */
export function cleanTitle(raw: unknown): { title: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'title must be a string' }
  const title = raw.replace(/\s+/g, ' ').trim()
  if (title === '') return { error: 'title is empty' }
  if (title.length > TITLE_MAX) return { error: `title is ${title.length} characters; keep it under ${TITLE_MAX}` }
  return { title }
}

type Usage = {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: readonly { kind: string; percentUsed: number }[]
}

export function contextPercent(usage: Usage): number | null {
  const { percent, tokens, window } = usage.context
  if (typeof percent === 'number') return Math.round(percent)
  if (typeof tokens === 'number' && window > 0) return Math.round((tokens / window) * 100)
  return null
}

/** Why a wrap is worth offering now, worded for the band; null when it is not. */
export function wrapReason(usage: Usage, atPercent: number): string | null {
  if (atPercent <= 0) return null
  const limit = [...usage.rateLimits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  if (limit && limit.percentUsed >= RATE_LIMIT_WRAP) return `${limit.kind} limit ${Math.round(limit.percentUsed)}% used`
  const percent = contextPercent(usage)
  if (percent !== null && percent >= atPercent) return `context ${percent}% full`
  return null
}

/** What the model is told at a fresh start in a project that has the start command. */
export function startContext(start: string): string {
  return [
    `This project kicks off working sessions with /${start}.`,
    `Once a session's focus is known (after /${start} presents and the user picks what to work on,`,
    'or once the task is clear), call the set_session_title tool with a short title:',
    '"<Project> S<n> · <focus>" when the project numbers its sessions (e.g. "Atlas S12 · Search filters"),',
    'else "<Project> · <focus>". Call it again when the focus changes.',
  ].join(' ')
}

// Reminders after the start command, while the session has no title.
export const TITLE_NUDGES = 2

/** The prompt that is the start command itself, typed or run from the band. */
export function isStartPrompt(prompt: unknown, start: string): boolean {
  return typeof prompt === 'string' && new RegExp(`^/${start.replace(/[.]/g, '\\.')}(\\s|$)`).test(prompt.trim())
}

/** Said with the prompts that follow the start command until a title is set. */
export function titleNudge(start: string): string {
  return [
    `/${start} has run and this session has no title yet.`,
    'If this message settles what the session is about, call the set_session_title tool first,',
    "before anything else, numbering it from the session /" + start + " reported.",
  ].join(' ')
}

export const TITLE_TOOL_DESCRIPTION = [
  "Sets this session's title, shown in the session list and the terminal tab, so the user can tell sessions apart.",
  'Call it once the focus of the session is clear, and again when it changes.',
  'Format: "<Project> S<n> · <focus>" when the project numbers its sessions (e.g. "Atlas S12 · Search filters"),',
  `else "<Project> · <focus>". Under ${TITLE_MAX} characters.`,
  'The title appears from the user\'s next message on.',
].join(' ')
