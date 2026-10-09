# claude-mods

Small [Claude Code](https://claude.com/claude-code) mods: plugins of function
hooks that change what Claude Code shows or does, in the terminal and in the
desktop app's Code tab.

## Install

In a terminal Claude Code session:

```
/plugin install <mod> --marketplace enhki/claude-mods
```

Answer `y` to add the marketplace, then pick the **user** scope so the mod
loads in every session, desktop ones included.

## Mods

| Mod | What it does |
| --- | --- |
| [`statusline-desktop`](mods/statusline-desktop) | Draws your terminal status line above the prompt in the desktop app |

### statusline-desktop

The desktop app doesn't run your `statusLine` command. This mod does: it picks
the command the way Claude Code does (project `.claude/settings.local.json`,
then `.claude/settings.json`, then `~/.claude/settings.json`), pipes it the same
JSON the terminal would (model, cwd, cost, context window, rate limits), and
draws the first line it prints in the band above the prompt.

- ANSI colours keep the terminal's palette when ghostty's config (and the files
  it pulls in with `config-file`) sets one; otherwise they map to the app's own
  theme colours.
- Refreshes on session start, after each tool call and turn, and every 30 s.
- Stays out of the terminal, which already draws the real status line.
- Only the input side of the context window is known to mods, so a token count
  your script sums from `current_usage` reads slightly lower than in the
  terminal (output tokens come through as 0).

## Developing

Clone, then add the clone itself as your marketplace so edits are live after
`/reload-plugins` with no reinstall:

```bash
claude plugin marketplace add ~/repos/claude-mods
claude plugin install statusline-desktop@claude-mods --scope user
```

Check a mod before committing:

```bash
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
```
