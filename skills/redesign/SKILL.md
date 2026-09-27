---
name: redesign
description: Guide the user through redesigning a website to remove the AI design tells an audit found. Drafts a change or a keep for every finding, previews each change as before and after screenshots of the running dev server without editing anything, shows one review page for the user to approve, then applies the approved changes at the real source (including the files that generated token files are built from) and records what was kept so it stops coming back. Use after /ooer-design:polish or a scan has found tells, or when the user asks to fix, redesign or work through what the audit found.
---

# Redesign from the audit

The audit says what looks generated. This skill turns it into a redesign the
user has seen and agreed before any line of the site changes. There are
three rules:

- **Nothing is edited until the user approves the review page.**
- **A change goes into the site's real source.** That is the file a token is
  defined in, not the generated file that repeats it.
- **A keep is a decision with a reason, written down,** so that it is not
  asked about again.

The user may name a path, a page or some findings. Otherwise the scope is
every finding not already kept.

## 1. Read the audit and the decisions so far

Run the scanner from the site's root:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/polish/scan.py" . --json
```

The output has `findings`, each marked `kept` and `generated`, and
`stale_keeps`. Read `.ooer-design.json` if it exists. It holds `exclude`, the
file patterns left out of the audit, and `keep`, the findings kept with a
reason.

- **Tests, fixtures and prototypes in the findings:** offer to add them to
  `exclude`, such as `"tests/**"` and `"prototype/**"`. They are not the site.
- **A stale keep:** it matched nothing, so the thing it kept has gone. Offer
  to remove it from `keep`.
- **Decisions already made:** respect them. Only look at findings that are
  not kept.

## 2. Turn findings into decisions

One decision is one value at its source, however many lines show it.

1. **Trace generated files to their source.** A finding marked `generated`
   sits in a file built from something else, and its header usually says
   what. Find the value in that source, for example with `grep -rn '#efe6d8'`,
   excluding the generated file. The decision's `source` is that file. Find
   the command that rebuilds the generated file from the project's CLAUDE.md
   or package.json.
2. **Group repeats.** Twelve uses of `--radius-lg` make one decision, not
   twelve. List where it is used in `used_in`.
3. **Read the context before proposing.** A tell is sometimes the point. A
   parchment colour in a theme about antiquity, or rounded corners in a
   theme meant to evoke the 1950s, may be deliberate. Look at the names
   around the value, the project's docs and the design notes. Where it is
   plausibly deliberate, propose a keep and say why, and let the user
   overrule it.
4. **For each change, choose one concrete replacement,** following the
   "Instead" advice in [tells.md](../polish/tells.md). Never replace a
   default with another default, such as Inter with DM Sans. Check text
   contrast (4.5:1, and 3:1 for large text and UI edges) for any colour you
   propose. Treat the site's own contrast or design gates as the final word.

## 3. Write the proposals file

Write `proposals.json` in the scratchpad, not in the site:

```json
{
  "site": "Site name",
  "url": "http://localhost:4321",
  "pages": [
    { "name": "Home", "path": "/" },
    { "name": "Atomic era", "path": "/", "setup": "document.querySelector('[data-theme=\"atomic\"]')?.scrollIntoView()" }
  ],
  "widths": [1280, 375],
  "hide": [".cookie-banner"],
  "decisions": [
    {
      "id": "radius-lg",
      "title": "Rounded corners on era cards",
      "category": "radius",
      "action": "change",
      "current": "14px",
      "proposed": "3px",
      "why": "One sentence the user can agree or disagree with.",
      "source": "design-system/tokens.json",
      "used_in": ["src/styles/skins.css"],
      "css": ":root { --radius-lg: 3px; }"
    },
    {
      "id": "antiquity-ground",
      "title": "Antiquity paper colour",
      "category": "beige",
      "action": "keep",
      "current": "#efe6d8",
      "why": "Parchment is what this era is dressed as.",
      "source": "design-system/tokens.json"
    }
  ]
}
```

- **`url`:** the dev server that is already running. Find the port from
  the project's config or ask. Do not start or stop the user's server; if
  nothing answers, ask them to start it.
- **`pages`:** every place a decision shows. Where a decision only shows in
  one theme, section or state, add a page with a `setup` script that gets
  there, for example by scrolling or setting an attribute. Keep it to what a
  user could reach.
- **`css`:** a change's preview is CSS injected over the page. Override the
  token with the same selector that defines it, such as `:root` or
  `[data-theme="medieval"]`. Otherwise a more specific rule wins and the
  preview shows nothing.
- **`hide`:** anything that covers the page and is not part of the design.
  Dev-server toolbars are hidden already.
- **`id`:** lower-case letters, digits and hyphens.
- A `change` needs `css` and `proposed`. A `keep` needs `why` and no `css`.

## 4. Preview and review

From the site's root, so its own Playwright is used:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/redesign/preview.mjs" <scratchpad>/proposals.json --out <scratchpad>/redesign
```

It writes a before picture for each page and width, an after picture for
each change (and for all the changes together when there are several), and
`review.html`. It edits nothing in the site and uses a fresh browser, so the
user's own browser is untouched. If it fails, it says why: no dev server, no
Playwright in the site, or no Chromium installed. Pass the fix on to the
user.

Before showing the page, read it yourself:

- **A change marked "No visible difference on any page"** has CSS that did
  not take, or no page where it shows. Fix the selector or add a page, and
  run the preview again. Never show the user a change they cannot see.
- **The pictures:** look at every after picture. If a change made something
  worse, such as illegible text, a clash or a broken layout, revise it
  before the user sees it.

Then send the user `review.html`, rendered, with a two-line summary: how
many changes and keeps there are, and anything they should look at hardest.
Ask them to approve it, or to amend any decision by its number. If they
amend, update `proposals.json`, preview again and show the new page. Do not
apply a proposal they have not seen.

## 5. Apply what was approved

All at once, and in this order:

1. **Edit the sources.** Change each value where it is defined, which is
   the `source` of the decision. Then rebuild the generated files with the
   project's own command, and never edit a generated file by hand. Where a
   value is hard-coded in components, as in `rounded-2xl` or `#faf7f2`,
   replace it with the token, not with another literal.
2. **Record the keeps.** Add each approved keep to `.ooer-design.json` at
   the site's root, with the `match` exactly as the scanner reported it, the
   `file` it is in, and the `why` as the `reason`. Add any agreed `exclude`
   patterns. Create the file if it is missing, and keep entries already in
   it. For example:

   ```json
   {
     "exclude": ["tests/**", "prototype/**"],
     "keep": [
       { "match": "#efe6d8", "file": "src/styles/tokens.css", "reason": "Parchment is what the Antiquity era is dressed as." }
     ]
   }
   ```

3. **Load fonts properly.** If a font changed, load the new one the way the
   project loads fonts, and remove the old one's loading.

## 6. Verify and report

- **Scan again.** Every finding you decided on is now gone or kept. Anything
  left is either new, which you should name, or missed, which you should fix.
- **Run the project's checks.** Use the full check its CLAUDE.md names:
  contrast gates, look tests, build. This change is meant to move picture
  baselines, so where the project has them, rewrite them the project's way,
  look at every picture written, and say so.
- **Compare with the proposal.** Run the preview again with the same
  proposals file into a new folder. Every applied change should now show "No
  visible difference", because its override only repeats what the site does.
  The new before pictures should also match the approved after pictures:
  compare each pair with `cmp`, and look at any that differ. A small
  difference can be right, such as a token that was also used somewhere
  the preview did not override. Say which ones differ and why.

Report:

- the decisions applied and kept, by number, as on the review page,
- the scanner count before and after, with the kept findings counted apart,
- the files changed, sources first, then generated, then components,
- the project's checks, with their results,
- anything not verified, said plainly.

Nothing is committed unless the user asks.
