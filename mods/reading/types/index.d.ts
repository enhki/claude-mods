/** Where an item's content comes from. */
export type Source =
  | {
      kind: 'file'
      /** Relative to the session's working directory, or absolute. */
      path: string
      /** An inclusive 1-based line range of the file. */
      lines?: [number, number]
      /** A heading whose section is the item. */
      heading?: string
    }
  | {
      kind: 'issue'
      /** `owner/repo`; empty means the session repository's own. */
      repo: string
      number: number
    }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string }

export type Mark = 'unread' | 'read' | 'acknowledged' | 'discuss'

export type Item = {
  /** Stable, from the source: what a republish merges on. */
  key: string
  title: string
  /** One line from Claude on why this is worth reading. */
  why: string
  source: Source
  mark: Mark
  comment: string
  /** The content once loaded; absent until the item is opened. */
  content?: string
  /** Why the content could not be loaded. */
  error?: string
  /** True while a load is under way on a timer of its own. */
  loading?: boolean
}

export type Reading = {
  title: string
  intro: string
  items: Item[]
  /** The key of the item drawn open; null for none. */
  open: string | null
  /** How many times the results were sent back. */
  sent: number
  /** Bumped on every publish: the desktop comment editors are keyed by it. */
  rev: number
}

declare module 'claude-code' {
  interface PluginState {
    reading: { current: Shaped<Reading> }
  }
}
