import type { Label, Milestone, NewIssue } from '../types'

/**
 * `selected` with `name` toggled. Turning on a label from an exclusive scope
 * (`kind/bug` where `kind/` is exclusive) turns its siblings off, as Forgejo
 * itself only keeps one per such scope.
 */
export function toggleScoped(selected: string[], name: string, labels: Label[]): string[] {
  if (selected.includes(name)) return selected.filter(s => s !== name)
  const at = name.lastIndexOf('/')
  const scope = at > 0 ? name.slice(0, at + 1) : null
  const exclusive = scope !== null && labels.some(l => l.exclusive && l.name.startsWith(scope))
  const kept = exclusive && scope ? selected.filter(s => !s.startsWith(scope)) : selected
  return [...kept, name]
}

/** The ids of the labels named, in the repo's label list; unknown names are skipped. */
export function labelIds(names: string[], labels: Label[]): number[] {
  const byName = new Map(labels.map(l => [l.name, l.id]))
  return names.map(n => byName.get(n)).filter((id): id is number => id !== undefined)
}

/** The id of the milestone titled `title`, 0 for none (what the API takes to clear it). */
export function milestoneId(title: string | null, milestones: Milestone[]): number {
  return title ? (milestones.find(m => m.title === title)?.id ?? 0) : 0
}

export type TriageRules = {
  requireMilestone: boolean
  /** One of these labels must be set; empty for no such rule. */
  requireLabelFrom: string[]
}

/** Parses the comma-separated `requireLabelFrom` setting. */
export function parseLabelList(text: string): string[] {
  return text
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Why `draft` cannot be filed yet, worded for the form, or null when it can. */
export function newIssueProblem(draft: NewIssue, rules: TriageRules): string | null {
  if (!draft.title.trim()) return 'Give the issue a title.'
  if (rules.requireMilestone && !draft.milestone) return 'Pick a milestone: every issue needs one here.'
  if (rules.requireLabelFrom.length > 0 && !draft.labels.some(l => rules.requireLabelFrom.includes(l))) {
    return `Pick one of: ${rules.requireLabelFrom.join(', ')}.`
  }
  return null
}
