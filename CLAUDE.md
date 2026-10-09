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

## Commits

Conventional commits, scope = the mod's name (`feat(statusline-desktop): …`),
or `repo` for repo-wide files. Under 72 characters.
