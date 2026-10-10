/** One thing for the person to check by hand. */
export type Step = {
  title: string
  /** The exact command to run, if there is one. */
  run: string
  /** Where to run it: a directory, a terminal, a window size. */
  where: string
  /** What the person should see when it works. */
  expect: string
}

export type Mark = 'pending' | 'pass' | 'fail' | 'skip'

export type Walkthrough = {
  title: string
  intro: string
  steps: Step[]
  /** One per step, in step order. */
  marks: Mark[]
  notes: string[]
  /** The step drawn open; null means the first one not yet marked, -1 none. */
  open: number | null
  /** How many times the results were sent back. */
  sent: number
}

declare module 'claude-code' {
  interface PluginState {
    walkthrough: { current: Walkthrough }
  }
}
