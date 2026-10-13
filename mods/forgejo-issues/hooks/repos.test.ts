import { expect, test } from 'claude-code/testing'

import { matchRepo, parseRepoList, repoChoices, repoLabel } from './repos'

const launch = { host: 'forge.example', owner: 'team', repo: 'app', webBase: 'https://forge.example' }

test('parse_keeps_owner_repo_names_once', () => {
  const json = JSON.stringify({ repos: ['team/infra', ' team/infra.git ', 'Team/Infra', 'nope', 'a/b/c', 7, 'other/docs'] })
  expect(parseRepoList(json)).toEqual(['team/infra', 'other/docs'])
})

test('parse_treats_a_missing_or_broken_file_as_none', () => {
  expect(parseRepoList(null)).toEqual([])
  expect(parseRepoList('{ not json')).toEqual([])
  expect(parseRepoList('{"repos": "team/infra"}')).toEqual([])
  expect(parseRepoList('null')).toEqual([])
})

test('choices_put_the_session_repo_first_on_its_host', () => {
  const choices = repoChoices(launch, ['team/infra', 'TEAM/app'])
  expect(choices.map(r => `${r.host} ${r.owner}/${r.repo}`)).toEqual(['forge.example team/app', 'forge.example team/infra'])
})

test('labels_name_the_owner_only_when_two_share_a_name', () => {
  const choices = repoChoices(launch, ['team/infra', 'other/app'])
  expect(choices.map(r => repoLabel(r, choices))).toEqual(['team/app', 'infra', 'other/app'])
})

test('match_takes_exact_names_then_a_unique_prefix', () => {
  const choices = repoChoices(launch, ['team/infra', 'team/infra-old', 'team/docs'])
  expect(matchRepo(choices, 'infra')?.repo).toBe('infra')
  expect(matchRepo(choices, 'TEAM/DOCS')?.repo).toBe('docs')
  expect(matchRepo(choices, 'do')?.repo).toBe('docs')
  expect(matchRepo(choices, 'inf')).toBeUndefined()
  expect(matchRepo(choices, 'missing')).toBeUndefined()
  expect(matchRepo(choices, '  ')).toBeUndefined()
})
