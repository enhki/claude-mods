export type IssueLabel = { name: string; color: string }

/** A repo label; `scope/leaf` names are Forgejo's scoped labels. */
export type Label = IssueLabel & { exclusive: boolean; description: string }

export type Milestone = { title: string; open: number; closed: number }

export type Issue = {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  comments: number
  updatedAt: string
  url: string
  author: string
  labels: IssueLabel[]
  milestone: string | null
}

export type Comment = { author: string; body: string; createdAt: string }

export type RepoInfo = { host: string; owner: string; repo: string; webBase: string }

/** Everything fetched for the repo, and how the fetch went. */
export type Data = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  repo: RepoInfo | null
  issues: Issue[]
  labels: Label[]
  milestones: Milestone[]
  /** Why the list is empty or failed, worded for the person. */
  message: string | null
  tokenSource: 'secrets' | 'fgj' | null
  fetchedAt: number
  /** The border colour for cards and controls at rest, from the theme setting. */
  border: string
}

export type StateFilter = 'open' | 'closed' | 'all'

/** What the person has chosen to see. */
export type Ui = {
  query: string
  /** Label names toggled on as chips; an issue must carry every one. */
  chips: string[]
  /** A milestone title, `''` for any, `'-'` for none. */
  milestone: string
  state: StateFilter
  grouped: boolean
  /** The issue shown in the detail view, or null for the list. */
  open: number | null
}

export type Detail = {
  number: number
  status: 'loading' | 'ready' | 'error'
  comments: Comment[]
  message: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'forgejo-issues': { data: Data; ui: Ui; detail: Detail | null }
  }
}
