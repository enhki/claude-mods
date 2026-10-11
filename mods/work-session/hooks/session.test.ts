import { expect, test } from 'claude-code/testing'

import { cleanTitle, commandFiles, commandName, hasCommand, isFreshStart, isStartPrompt, kickoffMode, wrapReason } from './session'

const usage = (percent: number, limits: { kind: string; percentUsed: number }[] = []) => ({
  context: { percent, window: 200_000 },
  rateLimits: limits,
})

test('kickoff_mode_defaults_to_band', () => {
  expect(kickoffMode('auto')).toBe('auto')
  expect(kickoffMode('off')).toBe('off')
  expect(kickoffMode(undefined)).toBe('band')
  expect(kickoffMode('nonsense')).toBe('band')
})

test('command_name_strips_the_slash_and_refuses_junk', () => {
  expect(commandName('/cws', 'x')).toBe('cws')
  expect(commandName(' ews ', 'x')).toBe('ews')
  expect(commandName(undefined, 'cws')).toBe('cws')
  expect(commandName('two words', 'cws')).toBe('')
  expect(commandName('plugin:cmd', 'cws')).toBe('plugin:cmd')
})

test('has_command_needs_an_exact_name', () => {
  const list = [{ name: 'cws' }, { name: 'cwsx' }]
  expect(hasCommand(list, 'cws')).toBe(true)
  expect(hasCommand(list, 'ews')).toBe(false)
  expect(hasCommand(list, '')).toBe(false)
})

test('only_startup_and_clear_are_fresh', () => {
  expect(isFreshStart('startup')).toBe(true)
  expect(isFreshStart('clear')).toBe(true)
  expect(isFreshStart('resume')).toBe(false)
  expect(isFreshStart('compact')).toBe(false)
  expect(isFreshStart('fork')).toBe(false)
})

test('titles_are_collapsed_and_bounded', () => {
  expect(cleanTitle('  Atlas S12 ·\n Search filters ')).toEqual({ title: 'Atlas S12 · Search filters' })
  expect('error' in cleanTitle('   ')).toBe(true)
  expect('error' in cleanTitle(42)).toBe(true)
  expect('error' in cleanTitle('x'.repeat(81))).toBe(true)
})

test('wrap_is_offered_at_the_context_threshold', () => {
  expect(wrapReason(usage(74), 75)).toBe(null)
  expect(wrapReason(usage(75), 75)).toBe('context 75% full')
  expect(wrapReason(usage(99), 0)).toBe(null)
})

test('a_nearly_spent_rate_limit_wins_over_the_context', () => {
  const limits = [
    { kind: 'weekly', percentUsed: 40 },
    { kind: '5-hour', percentUsed: 93.4 },
  ]
  expect(wrapReason(usage(80, limits), 75)).toBe('5-hour limit 93% used')
  expect(wrapReason(usage(10, [{ kind: '5-hour', percentUsed: 89 }]), 75)).toBe(null)
})

test('context_percent_falls_back_to_tokens_over_window', () => {
  expect(wrapReason({ context: { tokens: 160_000, window: 200_000 }, rateLimits: [] }, 75)).toBe('context 80% full')
})

test('command_files_name_the_project_command_and_skill', () => {
  expect(commandFiles('/r/', 'cws')).toEqual(['/r/.claude/commands/cws.md', '/r/.claude/skills/cws/SKILL.md'])
})

test('the_start_prompt_is_the_command_alone_or_with_args', () => {
  expect([isStartPrompt('/cws', 'cws'), isStartPrompt(' /cws now', 'cws'), isStartPrompt('/cwsx', 'cws'), isStartPrompt('hey', 'cws')]).toEqual([true, true, false, false])
})
