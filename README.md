# ooer-design

This is a Claude Code plugin that polishes a website's design so it stops
looking AI-generated. It finds beige and cream palettes, Inter and the other
default fonts, large rounded corners, purple gradients, soft floating shadows,
frosted glass and stock hero copy. It then proposes a considered direction and
applies it at the design-token level.

## Use

The plugin has two skills. Run them in a website project:

```
/ooer-design:polish
/ooer-design:redesign
```

- **`polish`** audits the site, proposes a direction and applies it.
  Claude also picks it up when you ask it to make a site "look less AI" or
  "less generic".
- **`redesign`** works through what the audit found. It drafts a change or
  a keep for every finding, and previews every change as before and after
  screenshots of your running dev server. It then shows one review page for
  you to approve. Only after that does it edit the site's real source, which
  includes the files that generated tokens are built from. What you chose to
  keep is recorded in `.ooer-design.json`, so it stops coming back.

The scanner works on its own too, without Claude:

```bash
python3 skills/polish/scan.py path/to/site
python3 skills/polish/scan.py path/to/site --json
python3 skills/polish/scan.py path/to/site --strict   # exits 1 if anything not kept is found
```

### The decisions file

A site can have a `.ooer-design.json` at its root, which the scanner reads:

```json
{
  "exclude": ["tests/**", "prototype/**"],
  "keep": [
    { "match": "#efe6d8", "file": "src/styles/tokens.css", "reason": "Parchment is what the Antiquity era is dressed as." }
  ]
}
```

- A kept finding is listed apart with its reason and is not counted.
- A keep that no longer matches anything is reported, so old decisions can
  be cleared out.
- Every keep needs a reason.

### Previews

`skills/redesign/preview.mjs` takes a proposals file and writes the pictures
and `review.html`. It needs the site's dev server running and Playwright
installed in the site. It uses the site's own copy, so the plugin carries no
browser.

## Install

This directory is both the plugin and a one-plugin marketplace called `ooer`:

```bash
claude plugin marketplace add ~/projects/ooer-design
claude plugin install ooer-design@ooer
```

Sessions run from a copy of the plugin cached under
`~/.claude/plugins/cache/ooer/ooer-design/<version>/`, so an edit here reaches
them only once the version has moved. After editing:

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Run `claude plugin marketplace update ooer`, which refreshes the listing.
3. Run `claude plugin update ooer-design@ooer`, which refreshes the installed copy.

While working on the plugin, skip all of that and start a session with
`claude --plugin-dir ~/projects/ooer-design`, which reads this directory
directly.

If `claude` is not on your PATH, the desktop app's copy lives at
`~/Library/Application Support/Claude/claude-code/<app version>/claude.app/Contents/MacOS/claude`.
