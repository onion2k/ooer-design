# ooer-design

This is a Claude Code plugin with three skills. `polish` audits a website for
the stereotypical "AI design" look and applies a direction. `redesign`
previews a fix for every finding, has the user approve them on one review
page, and applies them at the real source. `preflight` checks accessibility
and launch hygiene against the Preflight Checklist at
https://onion2k.github.io/preflight/ (source in `~/projects/preflight`) and
hands results back in that checklist's shape. The directory is also a local
marketplace called `ooer`, so it can be installed with
`claude plugin install ooer-design@ooer`.

## Commands

- **Full check:** `python3 -m unittest discover tests && node --test 'tests/**/*.test.mjs'`,
  then `claude plugin validate . --strict`. There is no pre-commit hook yet.
  - The Python tests hold the scanner (`test_scan.py` for the original visual
    tells, `test_visual.py` for the rest, `test_content.py` for the content
    tells and the slop fixture) and the decisions file (`test_config.py`).
  - The Node tests hold the proposals file, the review page, and the preview
    script's arguments (`review.test.mjs`, `preview.test.mjs`), and the
    preflight skill's page discovery, rules, results and arguments
    (`preflight.test.mjs`).
  - Mutation checks are run by putting each bug back in turn; the runner
    must disable bytecode caching (`python3 -B`, and remove `__pycache__`),
    because a same-size edit within the same second is otherwise run against
    the stale compiled copy.
- **Preflight by hand:** serve the fixture with
  `python3 -m http.server 8765 --bind 127.0.0.1` in `tests/fixtures/slop`,
  then `node skills/preflight/preflight.mjs http://127.0.0.1:8765/ --out <folder> --project <a site with Playwright>`.
  The fixture should fail about eighteen checks; Humanity's dev server about
  five, every one a real fact about the site.
- **Calibration:** `python3 skills/polish/scan.py tests/fixtures/slop` should
  light up nearly every category (it is a synthetic generated landing page);
  a considered site such as `~/projects/humanity` should give a handful of
  findings, every one of them a keep decision.
- **Preview by hand:** from a site with a running dev server, run
  `node skills/redesign/preview.mjs <proposals.json> --out <folder>`.
- **Scanner by hand:** `python3 skills/polish/scan.py <path> [--json] [--strict]`.

## Layout

- `skills/polish/scan.py` is the scanner. It runs headless, uses the
  standard library only, and reads files without ever writing them. It also
  reads a site's `.ooer-design.json`, the decisions file with `exclude` and
  `keep`. Its checkers come in three kinds: line checkers in `CHECKS`
  (`regex_tell` for one pattern, `all_of` for several that must share a
  line, and hand-written functions that measure), file checkers in
  `FILE_CHECKS` for tells that are only a tell in bulk or span lines, and
  one site-wide check for the reduced-motion guard.
- `tests/fixtures/slop/` is a synthetic generated landing page assembled
  from the researched tells, for the end-to-end run.
- `skills/redesign/review.mjs` holds the proposals file's rules and renders
  the review page. It is pure, with no browser and no file access.
- `skills/redesign/preview.mjs` takes the pictures. It uses the site's own
  Playwright in a fresh context, then hands the results to `review.mjs`.
- `skills/preflight/rules.mjs` is one pure rule per check an agent may
  settle: it takes what was observed and returns a verdict with evidence, a
  null status with evidence for a shared check that only gathers, or null
  when the check could not be run. `PRODUCTION_ONLY` and `BUILD_ONLY` name the
  checks a local build or a dev server cannot answer.
- `skills/preflight/results.mjs` holds the checklist's rules (no human
  check recorded, evidence required, a fail stays a fail), the results blob,
  the share link and the report. `skills/preflight/discover.mjs` finds pages
  and tells production, a local build and a dev server apart.
- `skills/preflight/preflight.mjs` is the orchestrator: plain requests, the
  site's own Playwright, axe and Lighthouse where the site has them.
- `skills/preflight/checks.json` is a vendored copy of the checklist's data,
  the offline fallback. Refresh it from `~/projects/preflight/checks.json`;
  never edit it.
- `skills/polish/SKILL.md`, `skills/redesign/SKILL.md` and
  `skills/preflight/SKILL.md` present these tools. They hold the workflows Claude follows, and they call the scripts
  through `${CLAUDE_PLUGIN_ROOT}`.
- `skills/polish/tells.md` is the content: the catalogue of tells and what
  to do instead.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` are the
  manifests. Their `name` fields must stay in step, and `version` must be
  bumped for an installed copy to update.

## Model features

- For a tell one regular expression finds, copy the dead-link check: a
  pattern, a `regex_tell` line in `CHECKS`, an entry in `CATEGORIES` if it is
  a new category, a found case and a left-alone case in the tests, and an
  entry in `tells.md` with its sources.
- For a tell that is several things on one line, copy the pulsing dot
  (`all_of`). For one that has to measure, copy the beige colour check. For
  one that is only a tell in bulk, copy the buzzword cluster in
  `FILE_CHECKS`.
- For a tell that can only be seen, add an entry to `tells.md` without
  *(scanned)*.

## The test API

- **Scanner:** `scan.scan_line(line)` returns `(category, snippet)` pairs.
  `scan.scan(root, config)` walks a directory. `scan.load_config(path)` reads
  a decisions file. `scan.main(argv)` returns the exit code. The tests build
  throwaway sites in a temporary directory (`Site` in `tests/test_config.py`).
- **Redesign:** `checkProposals`, `pictureSets`, `pictureName`, `hiddenCss`
  and `renderReview(proposals, folder, unchanged)` come from `review.mjs`.
  `parseArgs` and `findPlaywright` come from `preview.mjs`.
- **Preflight:** `RULES[id](ctx)` from `rules.mjs`, where `ctx` is a plain
  object of observations (`pages`, `home`, `headers`, `files`, `axe` and so
  on) that a test builds by hand; `settle`, `blob`, `encodeLink`,
  `decodeLink`, `loadChecks` and `renderReport` from `results.mjs`;
  `sitemapUrls`, `internalLinks`, `templatePages`, `isLocalTarget` and
  `isDevServer` from `discover.mjs`; `parseArgs` and `whyNot` from
  `preflight.mjs`.
- **Pictures:** these need a real dev server. They are checked by running
  `preview.mjs` against one and looking at what it writes, which no
  automated test does.

## The edge-case checklist

For a new tell:

- it is found in CSS, in Tailwind classes, and in JS or TS config where each
  applies;
- the nearby considered choice is left alone;
- it does not double-report a line another category already claims (purple
  inside a gradient is the gradient's; a coloured glow is not a shadow);
- `node_modules`, build output (any `dist*`), repo documents and `.min.`
  files are skipped;
- it appears in both the text report and `--json`, and a per-file finding
  has a fixed `match` and a one-line `detail`;
- it has an entry in `tells.md` with its sources;
- the slop fixture still hits it, and Humanity still gives only keeps.

For a change to the redesign tools:

- a proposals file that breaks a rule is refused, with the decision's id
  named;
- a single change, several changes, and keeps only;
- a change that shows on no page pictured, and one that shows on some pages;
- phone and desktop widths, and light and dark on the review page;
- a site with no dev server running, no Playwright, and no Chromium;
- site text containing HTML;
- the site's files are never written, apart from `.ooer-design.json` by the
  skill, after approval.

For a change to the preflight skill:

- every rule's id is in `checks.json` and is not a `human` check;
- the rule is tested both ways, and returns null rather than a verdict when
  what it needs was not observed;
- a fact about production is in `PRODUCTION_ONLY`, a fact about the build in
  `BUILD_ONLY`, and neither is recorded from a target that cannot answer it;
- evidence is the observed value, on one line, singular for one;
- a shared check whose recipe only gathers evidence is not recorded;
- the share link still opens in the live checklist and imports every result
  (run the fixture, then open the link headless and read `localStorage`);
- a missing server, Playwright, Chromium, axe or Lighthouse gives a plain
  message or a plain reason in the report, never a stack trace.

## The gates and their baselines

Both test suites must pass with no tolerance, and every new test must be
mutation-checked by putting the bug back. `claude plugin validate .` must
pass.
