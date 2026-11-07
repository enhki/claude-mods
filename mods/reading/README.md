# reading

A reading pane for Claude Code. When Claude has material for you to read, a
document, a section of one, a line range, an issue or a note, it publishes a
reading list to the **Reading** pane instead of pasting it into chat. You read
each item there, mark it **Read**, **Acknowledge**, **Agree** or **Discuss**, add a comment,
and send the results back as one message that Claude acts on.

- **Items are sources.** A file path with an optional heading or line range such
  as `5-15`, an issue number with its `owner/repo` when it is not the session
  repository's, a link, or inline Markdown. The canonical text stays where it
  lives; the pane shows it.
- **Marks keep their meaning.** Read is read; acknowledged is noted, not agreed;
  agreed is read and agreed with, so Claude may act on it; discuss asks Claude to
  bring it up. Nothing else is decided in the pane.
- **Lists grow.** Publishing again merges by source and keeps your marks and
  comments; Claude can ask for a fresh list with `replace`, and **Clear list**
  starts over.
- **The pane** opens when Claude publishes, or with `/reading`. In the
  terminal, hotkeys work while the pane is focused: `r`, `a`, `g`, `d` mark the
  open item, `l` reloads it, `s` sends, `x` clears.

**Issues.** Issue items are printed by a command. Leave the mod's **Issue
command** setting empty to run `fgj --hostname <host> issue view <n> -R
<owner/repo>` against the host of the session's `origin` remote, or set a
template with `{number}` and `{repo}`, for example `mycli issue view {number}
-R {repo}`. Without either, an issue item says what is missing.

**Desktop notes.** The desktop app drops Button presses from plugin panes, so
every control there is a small Client that posts a message, and comments are
typed into a wrapping editor because the desktop passes no paste into a Client.
