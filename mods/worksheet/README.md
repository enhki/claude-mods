# worksheet

A pane over a JSON worksheet: rows grouped by section, with search and
filters, your **priority** and **comment** per row beside Claude's **proposal**
and **reason**. Edits are written straight back to the file; a render command
named by the worksheet regenerates its Markdown export; changes reach Claude
when you press **Send changes**, or by themselves a few seconds after each
save when **Notify** is on.

Install it with `/plugin install worksheet --marketplace enhki/claude-mods`.

- **Worksheet files** are JSON with `schema: 1`, `choices`, `sections`, `rows`
  and optionally `render`. Rows carry `id`, `section`, `title`, `references`,
  the verbatim `role` cell, a parsed `suite` membership, `priority`, `comment`
  and `proposed: { priority, reason }`. Anything else in the file is kept as
  is; the pane changes only the fields it owns.
- **Finding them:** the mod's Worksheet files setting, else the project's
  `.claude/worksheets.json` as `{"worksheets": ["path.json"]}`, else every
  `*-worksheet.json` under `docs/prd`. `/worksheet` opens the first or the one
  named, by path or a part of it. With more than one worksheet the pane shows a
  tab per file above the title, named after the file without its
  `-worksheet.json` suffix; pressing a tab opens that worksheet.
- **Filters:** suite membership (required, note, future, additional, not in
  suite), suite category, priority or unset, rows with a proposal, rows whose
  proposal differs from the decision, and free text over id, title, role,
  references, comment and reason.
- **Claude's side:** the `propose_worksheet` tool records a proposed priority
  and reason per row id. A proposal never changes a decision; the pane shows
  it beside yours.
- **Terminal hotkeys** on the open row: the first letter of each choice sets
  it, pressing the same again unsets; `s` sends, `y` toggles Notify, `r`
  reloads the file.

**Desktop notes.** The desktop app drops Button presses from plugin panes, so
every control there is a small Client that posts a message, and comments are
typed into a wrapping editor because the desktop passes no paste into a Client.
