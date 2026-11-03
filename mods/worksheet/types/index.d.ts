/** A choice the worksheet offers for a row's priority; empty means unset. */
export type Priority = string

export type Reference = { id: string; url: string; version: string; status: string }

/** What a row's suite-role cell states about the compliance suite. */
export type Suite = {
  membership: '' | 'required' | 'note' | 'future' | 'additional'
  categories: string[]
  levels: string[]
  flags: string[]
}

export type Row = {
  id: string
  section: string
  title: string
  references: Reference[]
  /** The suite-role cell, verbatim. */
  role: string
  suite: Suite
  priority: Priority
  comment: string
  /** Claude's suggestion, kept beside the decision. */
  proposed: { priority: Priority; reason: string }
}

export type Section = { id: string; title: string; kind: 'capabilities' | 'product' }

/** The parts of a worksheet file the pane shows; the file keeps more. */
export type Worksheet = {
  title: string
  choices: string[]
  /** The command that renders the export after a save; empty for none. */
  render: string
  sections: Section[]
  rows: Row[]
}

/** One saved edit, for the file and for the message to Claude. */
export type Change = { id: string; field: 'priority' | 'comment'; from: string; to: string }

export type Filter = {
  text: string
  /** A membership, or '' for all. */
  membership: string
  /** A suite category, or '' for all. */
  category: string
  /** A priority choice, 'unset', or '' for all. */
  priority: string
  /** 'any' for rows with a proposal, 'differs' for proposals not yet matched, or '' for all. */
  proposed: string
}

export type SheetState = {
  /** The worksheets found, as paths relative to the working directory. */
  paths: string[]
  /** The one shown. */
  path: string
  sheet: Worksheet | null
  /** Why the worksheet could not be read. */
  error: string
  /** The row drawn open, by id. */
  open: string | null
  collapsed: string[]
  filter: Filter
  /** Edits not yet written to the file. */
  pending: Change[]
  /** Edits written but not yet sent to Claude. */
  log: Change[]
  notify: boolean
  saving: boolean
  sent: number
  rev: number
}

declare module 'claude-code' {
  interface PluginState {
    worksheet: { current: Shaped<SheetState> }
  }
}
