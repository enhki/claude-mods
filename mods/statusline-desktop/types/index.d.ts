/** One run of the status line's text, styled as its ANSI codes said. */
export type Segment = {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'statusline-desktop': { line: Segment[] | null }
  }
}
