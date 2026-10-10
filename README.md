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
| [`forgejo-issues`](mods/forgejo-issues) | Browse, search and manage the current repo's Forgejo or Gitea issues in a pane |

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

### forgejo-issues

`/issues` opens a pane on the issues of the repo the session runs in. The forge
and repo come from `git remote get-url origin` (ssh or https), so it works for
any Forgejo or Gitea host, Codeberg included.

- **Browse:** every issue as a card, grouped by milestone; Open, Closed, All;
  label chips with counts (scoped labels like `kind/bug` sit under their scope,
  exclusive scopes pick one); a milestone picker.
- **Search:** fzf-style fuzzy matching with highlights, plus `label:bug`,
  `-label:wontfix`, `label:kind/`, `milestone:"Some name"`, `is:closed`.
  Enter opens the top match.
- **Read:** the body on a raised panel, comments as cards, `#N` mentions as
  chips that open in the pane.
- **Write:** comment, close and reopen (behind a Confirm), edit labels, set the
  milestone, file a new issue. Text goes in a full-width Markdown editor with a
  toolbar and a preview.

**Token.** The mod needs an API token with issue read/write and repository
read. Put it in `~/.config/claude-mods/secrets/forgejo.env` (folder `700`,
file `600`), keyed by host so a token only ever goes to its own forge:

```bash
FORGEJO_TOKEN_CODEBERG_ORG=...
FORGEJO_TOKEN_GIT_EXAMPLE_COM=...
```

Without one, it falls back to [fgj](https://codeberg.org/romaintb/fgj)'s config
for that host. The mod also stops Claude's own file and shell tools from reading
that secrets folder.

**Settings** (the plugin's options):

| Setting | Default | What it does |
| --- | --- | --- |
| `apiUrl` | empty | The API base when it isn't `https://<remote host>/api/v1` |
| `requireCommentOnClose` | on | Closing needs a comment, posted before the close |
| `requireMilestone` | off | New issues need a milestone |
| `requireLabelFrom` | empty | New issues need one of these comma-separated labels |
| `editorCommand` | empty | Adds **Open in editor**: e.g. `ghostty --gtk-single-instance=false --class=popup.editor -e nvim {file}` |

**Desktop notes.** The desktop app currently drops Button and Markdown-link
presses from plugin panes, so every control here is a small `Client` that posts
a message instead; and it passes no paste into a `Client`, so for long or pasted
text use **Open in editor**. The editor command must wait until you close the
file; one that returns at once (a launcher that forks) leaves a
**Use editor text** button to pull the file back by hand. Ghostty needs
`--gtk-single-instance=false` for this, or it may hand the window to a running
instance and return at once.

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
