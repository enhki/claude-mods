import { describe, expect, test } from 'claude-code/testing'

import type { Label, Milestone, NewIssue } from '../types'
import { labelIds, milestoneId, newIssueProblem, parseLabelList, toggleScoped } from './triage'

const label = (id: number, name: string, exclusive = false): Label => ({ id, name, color: '#888888', exclusive, description: '' })
const LABELS = [label(1, 'bug'), label(2, 'kind/bug', true), label(3, 'kind/feature', true), label(4, 'area/ui'), label(5, 'area/api')]
const MILESTONES: Milestone[] = [{ id: 9, title: 'Theming', state: 'open', open: 1, closed: 0 }]

describe('toggleScoped', () => {
  test('plain_labels_toggle', async () => {
    expect(toggleScoped([], 'bug', LABELS)).toEqual(['bug'])
    expect(toggleScoped(['bug'], 'bug', LABELS)).toEqual([])
  })
  test('exclusive_scope_keeps_one', async () => {
    expect(toggleScoped(['kind/bug', 'bug'], 'kind/feature', LABELS)).toEqual(['bug', 'kind/feature'])
  })
  test('open_scope_keeps_many', async () => {
    expect(toggleScoped(['area/ui'], 'area/api', LABELS)).toEqual(['area/ui', 'area/api'])
  })
})

describe('ids', () => {
  test('labels_by_name_unknown_skipped', async () => {
    expect(labelIds(['kind/bug', 'nope', 'bug'], LABELS)).toEqual([2, 1])
  })
  test('milestone_by_title_or_zero', async () => {
    expect(milestoneId('Theming', MILESTONES)).toBe(9)
    expect(milestoneId(null, MILESTONES)).toBe(0)
    expect(milestoneId('Gone', MILESTONES)).toBe(0)
  })
})

describe('newIssueProblem', () => {
  const draft = (over: Partial<NewIssue> = {}): NewIssue => ({ title: 'A thing', body: '', labels: [], milestone: '', ...over })
  const none = { requireMilestone: false, requireLabelFrom: [] }
  test('title_required', async () => {
    expect(newIssueProblem(draft({ title: '  ' }), none)).toMatch(/title/)
  })
  test('no_rules_files_anything_titled', async () => {
    expect(newIssueProblem(draft(), none)).toBe(null)
  })
  test('milestone_rule', async () => {
    const rules = { requireMilestone: true, requireLabelFrom: [] }
    expect(newIssueProblem(draft(), rules)).toMatch(/milestone/)
    expect(newIssueProblem(draft({ milestone: 'Theming' }), rules)).toBe(null)
  })
  test('label_from_list_rule', async () => {
    const rules = { requireMilestone: false, requireLabelFrom: parseLabelList(' bug, enhancement ,') }
    expect(rules.requireLabelFrom).toEqual(['bug', 'enhancement'])
    expect(newIssueProblem(draft({ labels: ['area/ui'] }), rules)).toBe('Pick one of: bug, enhancement.')
    expect(newIssueProblem(draft({ labels: ['enhancement'] }), rules)).toBe(null)
  })
})
