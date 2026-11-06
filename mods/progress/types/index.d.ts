/** One gate: a build, test or check command the band watched, as its Bash call showed it. */
export type Gate = {
  /** The command's short name: `cabal build`, `cabal test`, `check`, `check-forge`. */
  name: string
  /** The real exit status; null when a pipe hid it (no pipefail, no PIPESTATUS). */
  exit: number | null
  /** Tests run and failed, when the output said. */
  total: number | null
  failed: number | null
  /** What the command's own summary said, when it printed one: `ExitSuccess`, `profile pass`. */
  summary: string
  werror: boolean
  /** Short commit the run was on, and the worktree when not this checkout. */
  sha: string
  where: string
  at: number
}

export type Slice = { id: string; name: string }

export type Plan = {
  /** The active plan's title and file. */
  name: string
  file: string
  current: Slice | null
  done: number
  total: number
  /** The next stage gate at or after the current slice, e.g. "G1". */
  nextGate: string
  /** How many plans the folder holds, and how many of them say they are active. */
  plans: number
  active: number
}

export type Queue = {
  review: number[]
  prs: number[]
  /** Why the last refresh failed; empty when it worked. */
  error: string
  checkedAt: number | null
}

export type Sheet = {
  label: string
  counts: { choice: string; n: number }[]
  /** Rows with no priority yet, and rows whose priority differs from the proposal. */
  open: number
  overrides: number
}

export type Specs = {
  label: string
  total: number
  statuses: { status: string; n: number }[]
  areas: number
}

export type Maps = { sheet: Sheet | null; specs: Specs | null }

declare module 'claude-code' {
  interface PluginState {
    progress: {
      /** The latest gate per command name, newest last, at most three. */
      gates: Gate[]
      plan: Plan | null
      queue: Queue
      maps: Maps
      /** The clock the band's ages count from, moved on each minute. */
      now: number
    }
  }
}
