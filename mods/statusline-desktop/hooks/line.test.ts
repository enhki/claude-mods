import { describe, expect, test } from 'claude-code/testing'

import { buildInput, fallbackPalette, ghosttyIncludes, parseAnsi, parsePalette, pickCommand } from './line'

const ESC = '\x1b'

describe('parseAnsi', () => {
  test('plain_text_is_one_segment', async () => {
    expect(parseAnsi('[10:30] hello')).toEqual([{ text: '[10:30] hello' }])
  })

  test('statusline_colours_map_to_palette', async () => {
    const raw = `[10:30] ${ESC}[36mrepo${ESC}[0m:main ${ESC}[33m*1${ESC}[0m`
    expect(parseAnsi(raw)).toEqual([
      { text: '[10:30] ' },
      { text: 'repo', color: fallbackPalette[6] },
      { text: ':main ' },
      { text: '*1', color: fallbackPalette[3] },
    ])
  })

  test('bright_bold_and_truecolour', async () => {
    const raw = `${ESC}[1;90mA${ESC}[38;2;255;0;16mB${ESC}[22;39mC`
    expect(parseAnsi(raw)).toEqual([
      { text: 'A', bold: true, color: fallbackPalette[8] },
      { text: 'B', bold: true, color: '#ff0010' },
      { text: 'C' },
    ])
  })

  test('non_sgr_codes_are_dropped', async () => {
    expect(parseAnsi(`a${ESC}[2Kb`)).toEqual([{ text: 'a' }, { text: 'b' }])
  })
})

describe('parsePalette', () => {
  test('ghostty_slots_override_fallback', async () => {
    const palette = parsePalette('palette = 6=#95e6cb\npalette = 3=#e7c547\nbackground = #000000\n')
    expect(palette[6]).toBe('#95e6cb')
    expect(palette[3]).toBe('#e7c547')
    expect(palette[1]).toBe(fallbackPalette[1])
  })

  test('later_files_win_in_load_order', async () => {
    expect(parsePalette('palette = 1=#111111', 'palette = 1=#222222')[1]).toBe('#222222')
  })

  test('no_palette_falls_back_to_theme_keys', async () => {
    expect(parsePalette('font-size = 12')).toEqual(fallbackPalette)
    expect(fallbackPalette[1]).toBe('error')
  })
})

describe('ghosttyIncludes', () => {
  test('relative_absolute_and_optional_paths', async () => {
    const text = 'config-file = colors\nconfig-file = ?/etc/ghostty/extra\nconfig-file = "themes/x"\n'
    expect(ghosttyIncludes(text, '/c/ghostty')).toEqual([
      '/c/ghostty/colors',
      '/etc/ghostty/extra',
      '/c/ghostty/themes/x',
    ])
  })
})

describe('buildInput', () => {
  const base = { sessionId: 's', cwd: '/r', root: '/r', model: 'Opus', version: '2.1' }

  test('carries_cost_context_and_limits_in_statusline_shape', async () => {
    const input = buildInput({
      ...base,
      usage: {
        startedAt: 0,
        context: { tokens: 1500, window: 200000, percent: 1 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-09T12:00:00Z' }],
        cost: { usd: 0.42 },
      },
    })
    expect(input).toMatchObject({
      cost: { total_cost_usd: 0.42 },
      context_window: { used_percentage: 1, current_usage: { input_tokens: 1500 } },
      rate_limits: { five_hour: { used_percentage: 12, resets_at: 1791547200 } },
    })
  })

  test('fresh_session_leaves_unknown_figures_out', async () => {
    const input = buildInput({ ...base, usage: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } })
    expect('cost' in input).toBe(false)
    expect('rate_limits' in input).toBe(false)
  })
})

describe('pickCommand', () => {
  const line = (command: string) => JSON.stringify({ statusLine: { type: 'command', command } })

  test('most_specific_settings_win', async () => {
    expect(pickCommand([line('local'), line('project'), line('user')])).toBe('local')
  })

  test('missing_or_broken_files_fall_through', async () => {
    expect(pickCommand([null, '{ broken', '{}', line('user')])).toBe('user')
  })

  test('none_configured', async () => {
    expect(pickCommand([null, '{}'])).toBe(null)
  })
})
