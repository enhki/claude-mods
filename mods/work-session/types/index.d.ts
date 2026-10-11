/** `pending`: a fresh start not yet checked for the start command (the engine lists commands only once the session is bound). */
export type KickoffPhase = 'none' | 'pending' | 'offered' | 'started' | 'skipped'
export type WrapPhase = 'none' | 'offered' | 'dismissed' | 'started'

/**
 * `told`: the model has had the start context (titling) in this session.
 * `nudges`: title reminders sent after the start command ran, while no title is set.
 */
export type Kickoff = { phase: KickoffPhase; command: string; told: boolean; nudges: number }
export type Wrap = { phase: WrapPhase; reason: string }
/** `applied`: re-sent with every prompt so the session keeps it; null hands titling back to Claude Code. */
export type Title = { applied: string | null }

declare module 'claude-code' {
  interface PluginState {
    'work-session': { kickoff: Kickoff; wrap: Wrap; title: Title }
  }
}
