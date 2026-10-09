import type { SessionUsage } from 'claude-code'

import type { Segment } from '../types'

// ANSI 0-15 as the app's own theme keys, so with no terminal palette to copy
// the line still follows whatever theme the desktop app is in.
export const fallbackPalette: string[] = [
  'inactive', 'error', 'success', 'warning', 'permission', 'merged', 'suggestion', 'text',
  'inactive', 'error', 'success', 'warning', 'permission', 'merged', 'suggestion', 'text',
]

/** Lays `palette = N=#rrggbb` lines from ghostty config texts, in load order, over the fallback. */
export function parsePalette(...texts: string[]): string[] {
  const palette = [...fallbackPalette]
  for (const text of texts) {
    for (const m of text.matchAll(/^\s*palette\s*=\s*(\d+)\s*=\s*(#[0-9a-fA-F]{6})/gm)) {
      const slot = Number(m[1])
      const hex = m[2]
      if (hex && slot < 16) palette[slot] = hex
    }
  }
  return palette
}

/** The files a ghostty config pulls in with `config-file =`, resolved against its folder. */
export function ghosttyIncludes(text: string, dir: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^\s*config-file\s*=\s*"?\??([^"\n]+?)"?\s*$/gm)) {
    const path = m[1]
    if (!path) continue
    out.push(path.startsWith('/') ? path : `${dir}/${path}`)
  }
  return out
}

type Style = Omit<Segment, 'text'>

function applySgr(params: number[], style: Style, palette: string[]): Style {
  let next = { ...style }
  for (let i = 0; i < params.length; i++) {
    const p = params[i] ?? 0
    if (p === 0) next = {}
    else if (p === 1) next.bold = true
    else if (p === 2) next.dim = true
    else if (p === 22) { delete next.bold; delete next.dim }
    else if (p === 39) delete next.color
    else if (p >= 30 && p <= 37) next.color = palette[p - 30]
    else if (p >= 90 && p <= 97) next.color = palette[p - 90 + 8]
    else if (p === 38 && params[i + 1] === 5) {
      const n = params[i + 2]
      if (n !== undefined && n < 16) next.color = palette[n]
      i += 2
    } else if (p === 38 && params[i + 1] === 2) {
      const [r, g, b] = params.slice(i + 2, i + 5).map(v => (v ?? 0).toString(16).padStart(2, '0'))
      next.color = `#${r}${g}${b}`
      i += 4
    }
  }
  return next
}

/** Splits a status line's ANSI output into styled runs; codes other than SGR are dropped. */
export function parseAnsi(raw: string, palette: string[] = fallbackPalette): Segment[] {
  const out: Segment[] = []
  let style: Style = {}
  const re = /\x1b\[([0-9;]*)([A-Za-z])/g
  let last = 0
  const push = (text: string) => {
    if (text) out.push({ text, ...style })
  }
  for (const m of raw.matchAll(re)) {
    push(raw.slice(last, m.index))
    last = (m.index ?? 0) + m[0].length
    if (m[2] === 'm') {
      const params = !m[1] ? [0] : m[1].split(';').map(Number)
      style = applySgr(params, style, palette)
    }
  }
  push(raw.slice(last))
  // The terminal shows one line; so does the band.
  return out.map(s => ({ ...s, text: s.text.replace(/\r?\n/g, ' ') }))
}

export type InputFacts = {
  sessionId: string
  cwd: string
  root: string
  model: string
  version: string
  usage: SessionUsage
}

/** The JSON Claude Code pipes to a statusLine command, built from `$.session`. */
export function buildInput(f: InputFacts): Record<string, unknown> {
  const { context, cost, rateLimits } = f.usage
  const limits: Record<string, { used_percentage: number; resets_at?: number }> = {}
  for (const r of rateLimits) {
    limits[r.kind] = {
      used_percentage: r.percentUsed,
      ...(r.resetsAt ? { resets_at: Math.floor(Date.parse(r.resetsAt) / 1000) } : {}),
    }
  }
  return {
    hook_event_name: 'Status',
    session_id: f.sessionId,
    cwd: f.cwd,
    model: { id: f.model, display_name: f.model },
    workspace: { current_dir: f.cwd, project_dir: f.root },
    version: f.version,
    ...(cost ? { cost: { total_cost_usd: cost.usd } } : {}),
    context_window: {
      context_window_size: context.window,
      ...(context.tokens !== undefined
        ? {
            total_input_tokens: context.tokens,
            // Only the input side is known here; output tokens read as 0.
            current_usage: {
              input_tokens: context.tokens,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          }
        : {}),
      ...(context.percent !== undefined ? { used_percentage: context.percent } : {}),
    },
    ...(rateLimits.length ? { rate_limits: limits } : {}),
  }
}

/** The statusLine command from the first settings text that names one, most specific first. */
export function pickCommand(settingsTexts: (string | null)[]): string | null {
  for (const text of settingsTexts) {
    if (!text) continue
    try {
      const line = JSON.parse(text)?.statusLine
      if (line?.type === 'command' && typeof line.command === 'string') return line.command
    } catch {
      // A settings file mid-edit is not fatal; the next one may name it.
    }
  }
  return null
}
