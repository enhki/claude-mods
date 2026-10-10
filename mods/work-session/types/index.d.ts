export type KickoffPhase = 'none' | 'offered' | 'started' | 'skipped'
export type WrapPhase = 'none' | 'offered' | 'dismissed' | 'started'

export type Kickoff = { phase: KickoffPhase; command: string }
export type Wrap = { phase: WrapPhase; reason: string }
/** `applied`: re-sent with every prompt so the session keeps it; null hands titling back to Claude Code. */
export type Title = { applied: string | null }

declare module 'claude-code' {
  interface PluginState {
    'work-session': { kickoff: Kickoff; wrap: Wrap; title: Title }
  }
}
