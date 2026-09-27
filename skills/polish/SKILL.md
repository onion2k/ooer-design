---
name: polish
description: Polish a website's design so it stops looking AI-generated. Finds and replaces the stereotypical tells (beige and cream palettes, Inter and the other default fonts, large rounded corners, purple-to-indigo gradients, soft floating shadows, frosted glass, stock hero copy) with a considered direction applied at the design-token level. Use when the user asks to polish, de-slop, de-AI, give character to, or make less generic a site, page, component or stylesheet, or complains it "looks like AI made it".
---

# Polish a design

The job is to take a site that looks like every other generated site and make
it look chosen. Swapping one default for the next default is not the job:
Inter for DM Sans, beige for slate-50 and `rounded-2xl` for `rounded-xl`
leave the site just as anonymous. Each replacement must be a decision that
could be defended to a designer.

The user may name a path, a page or a component. Otherwise the scope is the
whole site in the current project.

## 1. Find where the design lives

Before changing anything, find the source of truth for the look, because a
fix made in a component and not in the tokens comes back the next time
anything is generated:

- Tailwind: `tailwind.config.*`, or the `@theme` block in the main CSS for
  Tailwind 4.
- CSS custom properties: the `:root` block, usually in a global stylesheet.
- A theme file for a component library (shadcn's `globals.css` and
  `components.json`, Chakra, MUI, Mantine).
- Font loading: `<link>` tags to Google Fonts, `next/font` imports,
  `@font-face` and `@import` rules.

Note which of these the project uses. Say so briefly to the user.

## 2. Audit

Run the scanner over the scope. It only reads files:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/polish/scan.py" <path>
```

Add `--json` if you want to sort or count the findings. The scanner finds
what can be grepped, in some thirty categories: the visual tells (fonts,
palettes, radii, gradients, shadows, glows, glass, backdrops, template
chrome, the card kit, icons, emoji, display type, layout, motion, dark mode,
imagery), the fingerprints of generators and starters, and the content tells
(placeholders, dead links, fake testimonials, fabricated statistics, generic
calls to action, stock headings, generated-sounding phrases). Two things are
counted over a whole file and reported once: a buzzword cluster of four or
more distinct marketing words, and five or more em dashes. One is counted
over the whole site: animation with no reduced-motion guard anywhere.

Read the report the way the sources behind it say to: no single finding is
proof, and density is the signal. A purple button is a colour; a purple
gradient button under a pill badge over three icon cards is a template. Then
read [tells.md](tells.md) and look for the tells the scanner cannot see,
which are layout and composition tells, in the markup and in the running
page: the centred hero stack, the rule of three, Title Case everywhere,
uniform sentence length.

If the project has a dev server and a way to take headless screenshots
(Playwright, or the project's own look tests), take a *before* picture of the
main pages at desktop and phone widths. If it has neither, say that the result
was not looked at, rather than implying it was.

Report the audit to the user grouped by tell, with counts and the worst few
file:line examples for each. Do not list every hit. Say which findings are
near-certain on their own (placeholders, builder badges, chatbot register
leaking through, starter leftovers) and which only count together.

## 3. Propose a direction and agree it

Propose one coherent direction in a few lines, not a menu of options. Base it
on what the site is for and anything it already has that is distinctive,
such as a logo, a brand colour or a photograph. A direction covers:

- **Type:** a display face and a text face, or one family used with
  intent, named, with where they come from and their licence. It must not be
  one of the fonts the scanner flags.
- **Colour:** a background that is white, a true neutral, or a committed
  colour, never a hesitant cream. Add one accent used sparingly, and the ink
  colour. Give hex values and check text contrast against WCAG AA.
- **Shape:** a radius scale. The default here is square or nearly square
  (0 to 4px), with larger radii only where the shape means something, such as
  avatars or toggles.
- **Depth:** borders, rules and contrast in place of diffuse shadows. Keep a
  shadow only where something actually floats, like a menu or a dialog.
- **Layout:** the one or two composition changes that matter most, for
  example left-aligning the hero or breaking the three-card grid.

Wait for the user to agree or adjust before editing more than a file or two.
If they asked you to just go ahead, proceed and say which direction you
chose.

If the user would rather see every change before anything is edited, or
wants to keep some findings on purpose, switch to `/ooer-design:redesign`.
It previews each change on the running site, shows one review page to
approve, and records what was kept. When it applies to the site, offer it at
this point.

## 4. Apply

Work from the tokens outward:

1. Change the tokens first: the Tailwind theme, the CSS variables and the
   font loading. Remove the old font's loading entirely, so it is not still
   downloaded.
2. Then change the components. Replace utility classes such as
   `rounded-2xl`, `shadow-xl`, `bg-stone-50` and `from-purple-600` with the
   new tokens, not with other hard-coded values.
3. Change layout and composition last. These are the riskiest changes, so
   keep them to what was agreed.

Keep these while you edit:

- Visible focus styles. If you remove a ring, replace it with something at
  least as visible.
- Text contrast of at least 4.5:1, and 3:1 for large text and UI edges.
- Behaviour. This is a visual pass, so do not change logic, routes or data.
- Copy. The scanner reports stock phrases, buzzword clusters, generic
  calls to action and stock headings, but rewriting them is the user's
  call. List them and offer rewrites, and do not change them silently.
  Placeholders, dead links and fake testimonials are different: they are
  not copy, and the fix is to remove them or the section they sit in.
- The project's own rules. If its CLAUDE.md names look tests or picture
  baselines, this change is meant to move them, so rewrite them, look at
  every one, and say so.

## 5. Verify and report

Run the scanner again. Every remaining finding must either be fixed or be
listed with a reason it stays. A logo lockup that genuinely uses Inter is an
example of one that stays.

Run the project's own checks (build, lint, tests) and take *after* pictures
at the same widths as *before*. Look at them. Check the phone width in
particular, because radius and spacing changes show there first.

Report:

- the direction applied,
- the scanner count before and after, by category,
- the files changed, with token files first,
- the before and after pictures, or a plain statement that none were taken,
- what was left alone and why, including copy awaiting the user's decision.
