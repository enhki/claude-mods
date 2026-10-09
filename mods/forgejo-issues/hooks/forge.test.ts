import { describe, expect, test } from 'claude-code/testing'

import { ago, fgjToken, linkifyRefs, parseEnv, parseRemote, pickToken, scopeOf, tokenKey, toIssues, toLabels } from './forge'

describe('parseRemote', () => {
  const cases: [string, string, string, string][] = [
    ['git@forge.example:me/thing.git', 'forge.example', 'me', 'thing'],
    ['forge.example:me/thing', 'forge.example', 'me', 'thing'],
    ['ssh://git@forge.example:2222/me/thing.git', 'forge.example', 'me', 'thing'],
    ['https://forge.example/me/thing.git', 'forge.example', 'me', 'thing'],
    ['https://user:pw@forge.example:3000/group/me/thing/', 'forge.example', 'me', 'thing'],
  ]
  for (const [url, host, owner, repo] of cases) {
    test(`reads_${url}`, async () => {
      expect(parseRemote(url)).toMatchObject({ host, owner, repo, apiBase: `https://${host}/api/v1` })
    })
  }

  test('api_override_wins', async () => {
    expect(parseRemote('git@ssh.example:me/t.git', 'https://web.example/api/v1/')?.apiBase).toBe(
      'https://web.example/api/v1',
    )
  })

  test('nonsense_is_null', async () => {
    expect(parseRemote('not a remote')).toBe(null)
    expect(parseRemote('https://forge.example/onlyone')).toBe(null)
  })
})

describe('tokens', () => {
  test('key_names_the_host', async () => {
    expect(tokenKey('forge.example')).toBe('FORGEJO_TOKEN_FORGE_EXAMPLE')
    expect(tokenKey('git.my-host.org')).toBe('FORGEJO_TOKEN_GIT_MY_HOST_ORG')
  })

  test('env_parsing_handles_comments_export_and_quotes', async () => {
    const env = parseEnv('# c\n\nexport A=1\nB = "two words"\nC=\'3\'\nbad line\n')
    expect([...env]).toEqual([
      ['A', '1'],
      ['B', 'two words'],
      ['C', '3'],
    ])
  })

  const fgj = [
    'hosts:',
    '    other.example:',
    '        hostname: other.example',
    '        token: other-token',
    '    forge.example:',
    '        hostname: forge.example',
    '        token: "forge-token"',
    '        user: me',
  ].join('\n')

  test('fgj_token_is_the_named_hosts', async () => {
    expect(fgjToken(fgj, 'forge.example')).toBe('forge-token')
    expect(fgjToken(fgj, 'other.example')).toBe('other-token')
    expect(fgjToken(fgj, 'missing.example')).toBe(undefined)
  })

  test('secrets_file_wins_over_fgj', async () => {
    expect(pickToken('forge.example', 'FORGEJO_TOKEN_FORGE_EXAMPLE=s', fgj)).toEqual({ token: 's', source: 'secrets' })
  })

  test('falls_back_to_fgj', async () => {
    expect(pickToken('forge.example', null, fgj)).toEqual({ token: 'forge-token', source: 'fgj' })
  })

  test('never_sends_another_hosts_token', async () => {
    expect(pickToken('third.example', 'FORGEJO_TOKEN_FORGE_EXAMPLE=s', fgj)).toBe(null)
  })
})

describe('toIssues', () => {
  test('drops_pull_requests_and_shapes_fields', async () => {
    const json = JSON.stringify([
      {
        number: 7,
        title: 'Thing',
        body: '',
        state: 'open',
        comments: 2,
        updated_at: '2026-01-01T00:00:00Z',
        html_url: 'https://forge.example/me/t/issues/7',
        user: { login: 'me' },
        labels: [{ name: 'bug', color: 'ee0701' }],
        milestone: { title: 'Area' },
      },
      { number: 8, title: 'PR', state: 'open', comments: 0, updated_at: '', html_url: '', pull_request: {} },
    ])
    expect(toIssues(json)).toEqual([
      {
        number: 7,
        title: 'Thing',
        body: '',
        state: 'open',
        comments: 2,
        updatedAt: '2026-01-01T00:00:00Z',
        url: 'https://forge.example/me/t/issues/7',
        author: 'me',
        labels: [{ name: 'bug', color: '#ee0701' }],
        milestone: 'Area',
      },
    ])
  })

  test('non_list_answer_throws', async () => {
    expect(() => toIssues('{"message":"nope"}')).toThrow()
  })
})

describe('labels', () => {
  test('scope_splits_at_the_last_slash', async () => {
    expect(scopeOf('kind/bug')).toEqual({ scope: 'kind', leaf: 'bug' })
    expect(scopeOf('area/ui/menu')).toEqual({ scope: 'area/ui', leaf: 'menu' })
    expect(scopeOf('plain')).toEqual({ scope: null, leaf: 'plain' })
    expect(scopeOf('trailing/')).toEqual({ scope: null, leaf: 'trailing/' })
  })

  test('to_labels_keeps_exclusive', async () => {
    expect(toLabels('[{"id":3,"name":"kind/bug","color":"ee0701","exclusive":true}]')).toEqual([
      { id: 3, name: 'kind/bug', color: '#ee0701', exclusive: true, description: '' },
    ])
  })
})

describe('linkifyRefs', () => {
  const base = 'https://f.example/me/r/issues'
  test('links_bare_refs_only', async () => {
    expect(linkifyRefs('see #12 and (#3).', base)).toBe(`see [#12](${base}/12) and ([#3](${base}/3)).`)
  })
  test('leaves_code_anchors_and_existing_links', async () => {
    const text = 'a `#1` b\n```\n#2\n```\nurl/#3 [#4](x) &#5; c#6'
    expect(linkifyRefs(text, base)).toBe(text)
  })
})

describe('ago', () => {
  const now = Date.parse('2026-01-10T00:00:00Z')
  test('units', async () => {
    expect(ago('2026-01-09T23:59:30Z', now)).toBe('now')
    expect(ago('2026-01-09T22:00:00Z', now)).toBe('2h')
    expect(ago('2026-01-07T00:00:00Z', now)).toBe('3d')
  })
})
