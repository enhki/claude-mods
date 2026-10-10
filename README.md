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
| [`work-session`](mods/work-session) | Kicks off and wraps up working sessions with your own start and end commands, and titles each session |
| [`walkthrough`](mods/walkthrough) | A checklist pane for testing by hand: mark each step, add notes, send the results back in one message |

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

### work-session

For projects where you start and end each working session with your own slash
commands (a "continue working session" and an "end working session", say
`/cws` and `/ews`), this mod offers them at the right moments and gives each
session a title you can tell apart in the session list.

- **Kickoff:** when a session starts fresh (launch or `/clear`, not a resume)
  in a project that has the start command, a band above the prompt offers it:
  press `1` to run it, `2` to skip, or just type something else. Set
  **Kickoff** to `auto` to run it straight away, or `off`.
- **Title:** Claude gets a `set_session_title` tool and a line of context
  asking it to title the session once its focus is clear:
  `<Project> S<n> · <focus>` when the project numbers its sessions, else
  `<Project> · <focus>`. The title shows from your next message on. A
  `/rename` of your own wins: the mod stops setting it.
- **Wrap:** once the context window passes **Offer the wrap at** (75% by
  default) or a rate limit passes 90%, the band offers the end command, with
  **Later** to dismiss it for the session.

Projects without the start command see nothing. In the desktop app the band
draws above the desktop status line rather than in place of it.

**Settings** (the plugin's options):

| Setting | Default | What it does |
| --- | --- | --- |
| `startCommand` | `cws` | The command that kicks a session off, without the slash |
| `endCommand` | `ews` | The command that wraps one up |
| `kickoff` | `band` | `band` offers it, `auto` runs it at start, `off` never |
| `wrapAtPercent` | `75` | Context fullness that brings up the wrap offer; `0` turns it off |

### walkthrough

When Claude asks you to check something by hand (run a demo, resize a window,
try a key), it publishes the steps to a **Walkthrough** pane instead of a list
in chat, and you send the results back from there.

- **Steps:** each one says what to run, where (directory, terminal, window
  size) and what you should see. Claude's `publish_walkthrough` tool refuses a
  step that doesn't say what to expect. Publishing again replaces the list.
- **The pane** opens when Claude publishes, or with `/walkthrough`. The step
  you're on is drawn open: its command with **Copy**, what to expect,
  **Pass** / **Fail** / **Skip** and a note. Marking it opens the next one;
  done steps fold to one line you can click to reopen. Pressing a mark again
  takes it back.
- **Keys** (terminal, once the pane has the keyboard): `p` pass, `f` fail,
  `s` skip, `c` copy, `r` send.
- **Send results** submits one message: a tally, then each step as PASS,
  FAIL, SKIP or NOT DONE with your note beside it.

Screenshots don't go through the pane: paste them in the prompt as usual.
No settings.

## Writing a mod

A mod is a plugin of function hooks: a `plugin.json`, a `hooks/hooks.json`
naming one TypeScript module, and that module's `register(on, options)`. In a
Claude Code session, the bundled `plugin-authoring` skill holds the full API
(types, examples, the test kit); load it before writing one.

### Where it lives

| Kind | Where | Loads |
| --- | --- | --- |
| General, shareable | here, `mods/<name>/` + an entry in `.claude-plugin/marketplace.json` | everywhere, once installed at user scope |
| Tied to one project, or naming private hosts | that project's `.claude/skills/<name>/` | in that project's sessions only, watched for edits |
| Just for you, everywhere, private | `~/.claude/skills/<name>/` | every session, watched for edits |

Anything that names a private host, a person or a machine stays out of this
public repo: make it a project mod, or read the value from a setting.

### Workflow

1. **Sketch in the session's dev folder.** The `plugin-authoring` skill gives a
   mods folder that hot-reloads when each turn ends: the quickest loop.
2. **Move it here** as `mods/<name>/`, list it in the marketplace file, and
   install it from this clone (below). From then on, edits are live after
   `/reload-plugins`.
3. **Test it on the surface you'll use.** The terminal and the desktop app draw
   the same tree differently (see the notes below); try both when it matters.
4. **Before each commit:** `claude plugin validate mods/<name>`,
   `claude plugin test mods/<name>`, and a type-check. Bump `version` in the
   mod's `plugin.json` when behaviour changes, so GitHub installs update.

### Conventions shared by these mods

- **Pure logic in its own files, with tests;** the hooks module stays thin.
  `claude plugin test` runs `*.test.ts(x)` against the engine itself; a test
  stands in for engine calls with `on('<event>', () => ({ value: … }))`.
- **Settings** are the manifest's `userConfig` (shown in the plugin's options);
  nothing personal is hard-coded.
- **Secrets** go in `~/.config/claude-mods/secrets/<service>.env` (folder
  `700`, file `600`), keyed by host where a token belongs to a host. A mod that
  reads one also keeps Claude's own tools out of that folder (see
  `forgejo-issues/hooks/guard.ts`).
- **Saved state** (`$.state`) outlives reloads and upgrades: read *and* update
  it through helpers that fill in defaults, or a field a new version adds
  arrives `undefined`.

### Desktop app notes (Claude Code 2.1.29x)

- **Button and Markdown-link presses from a plugin pane don't arrive** (the
  app logs `ui_press not handled` in `~/.config/Claude/logs/claude.ai-web.log`).
  Input, Select and `Client` messages do. Make each pressable control its own
  small `Client` that posts a message (`forgejo-issues/hooks/pill.tsx`).
- **Set a `Client`'s pointer and key listeners once**, on its first draw. Each
  set is a message to the page, and many `Client`s re-setting them on every
  redraw get unmounted for flooding it.
- **Don't map pointer rows by arithmetic.** Borders are thin lines, not rows,
  and text is proportional (about 1.2 characters per cell). One `Client` per
  clickable item makes hit-testing unnecessary.
- **No paste into a `Client`**, and the native Input is one line at a fixed
  width. For long text, hand off to an external editor (`forgejo-issues`'s
  Open in editor).
- A "Nothing to show yet" pane means the drawing threw; a transcript line
  `<mod>: <event> hook skipped: threw …` names the handler that did.

## Developing

Clone, then add the clone itself as your marketplace so edits are live after
`/reload-plugins` with no reinstall:

```bash
claude plugin marketplace add ~/repos/claude-mods
claude plugin install <mod>@claude-mods --scope user
```

Check a mod before committing:

```bash
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
```
