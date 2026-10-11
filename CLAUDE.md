# claude-mods

Public repo of Claude Code mods (plugins of function hooks), published at
`github.com/enhki/claude-mods` and installed by others from there.

## Rules

- **Public and general.** No hostnames, IPs, personal paths, usernames, emails,
  tokens or machine names in code, comments, tests or docs. A mod discovers its
  environment at runtime (`$HOME`, `XDG_*`, the session's settings) and adapts;
  anything that genuinely varies per user is a `userConfig` option, never a
  hard-coded value. Fixtures use neutral values (`/r`, `s`, `#111111`).
- **Degrade, don't fail.** A missing file or tool means a fallback (the app's
  theme keys, drawing nothing), not an error in someone's session.
- **One mod per folder** under `mods/<name>/`, listed in
  `.claude-plugin/marketplace.json`. Pure logic in its own file so it is
  testable without the engine; the hooks module stays thin.
- **Before every commit:** `claude plugin validate mods/<name>` and
  `claude plugin test mods/<name>`, both clean. Bump the mod's `version` in its
  `plugin.json` when its behaviour changes.
- **Load the `plugin-authoring` skill before writing mod code**: it holds the
  API types, examples and the test kit for the installed engine version.
- **Private stays out.** A mod tied to one project, or naming private hosts,
  lives in that project's `.claude/skills/<name>/`, not here.

## Desktop app rules (learned the hard way, see README)

- No `Button` or Markdown-link handlers in panes: the desktop drops those
  presses. Every pressable control is its own small `Client` posting
  `{ press: id }` (reuse `forgejo-issues/hooks/pill.tsx`'s pattern).
- A `Client` sets `onPointer`/`onKey`/`every` only inside
  `if (surface.state === undefined)`, never on every draw.
- Never compute which item a pointer row hits; one `Client` per item.
- `$.state` reads and updates go through default-filling helpers.
- The `AbovePrompt` band is shared: every `ui.render` hook on it calls
  `next(e)` and stacks its row with what comes back, never instead of it.
- The desktop app runs the installed copy of a mod, not this folder: after a
  change, bump the mod's `version`, run `claude plugin update <mod>@claude-mods`
  and test in a new desktop session. The terminal reads the folder directly.
- The desktop starts the session with the first message: nothing can be
  offered before it, and the app keeps its own session title (rename through
  its `set_session_title` tool, not a hook's `sessionTitle`).
- No ydotool or screenshots while the user is at the desktop; ask them to
  test, and read `~/.config/Claude/logs/claude.ai-web.log` for
  `not handled` / `flooded` lines.

## Commits

Conventional commits, scope = the mod's name (`feat(statusline-desktop): …`),
or `repo` for repo-wide files. Under 72 characters.
