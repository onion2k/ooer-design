// The proposals file and the review page built from it.
//
// The redesign skill writes every proposed change and keep into one
// proposals file, previews them, and shows this page so the user can approve
// the lot at once. Checking the file here, before any browser starts, means a
// change with no CSS to preview it, or a keep with no reason, is refused
// rather than shown as if it had been thought through. The page is pure: it
// takes checked proposals and returns HTML, so it is tested without a browser.

const ACTIONS = new Set(["change", "keep"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_PAGES = [{ name: "Home", path: "/" }];
const DEFAULT_WIDTHS = [1280, 375];

// The overlays dev servers draw over the page. They are not the site, and
// left in they sit on top of the very corner or colour being compared.
const DEV_OVERLAYS = ["astro-dev-toolbar", "nextjs-portal", "vite-error-overlay", "#__next-build-watcher"];

function blank(value) {
  return typeof value !== "string" || value.trim() === "";
}

export function checkProposals(input) {
  if (typeof input !== "object" || input === null) throw new Error("proposals: expected an object");
  if (blank(input.url) || !/^https?:\/\//.test(input.url)) {
    throw new Error("proposals: 'url' must be the dev server's address, such as http://localhost:4321");
  }
  const pages = input.pages ?? DEFAULT_PAGES;
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("proposals: 'pages' must be a list");
  for (const page of pages) {
    if (blank(page.name) || typeof page.path !== "string" || !page.path.startsWith("/")) {
      throw new Error("proposals: each page needs a 'name' and a 'path' starting with /");
    }
  }
  const widths = input.widths ?? DEFAULT_WIDTHS;
  if (!Array.isArray(widths) || widths.length === 0 || !widths.every((w) => Number.isInteger(w) && w > 0)) {
    throw new Error("proposals: 'widths' must be a list of whole numbers of pixels");
  }
  const hide = input.hide ?? [];
  if (!Array.isArray(hide) || !hide.every((selector) => !blank(selector))) {
    throw new Error("proposals: 'hide' must be a list of CSS selectors");
  }
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) {
    throw new Error("proposals: 'decisions' must be a list with at least one decision");
  }
  const seen = new Set();
  for (const decision of input.decisions) {
    const id = decision.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      throw new Error(`proposals: id ${JSON.stringify(id)} must be lower-case letters, digits and hyphens`);
    }
    if (seen.has(id)) throw new Error(`proposals: ${id} is used twice`);
    seen.add(id);
    if (!ACTIONS.has(decision.action)) throw new Error(`proposals: ${id} has action '${decision.action}'; use change or keep`);
    if (blank(decision.title)) throw new Error(`proposals: ${id} needs a 'title'`);
    if (blank(decision.why)) throw new Error(`proposals: ${id} needs a 'why'`);
    if (decision.action === "change") {
      if (blank(decision.css)) throw new Error(`proposals: ${id} is a change, so it needs the 'css' that previews it`);
      if (blank(decision.proposed)) throw new Error(`proposals: ${id} is a change, so it needs 'proposed'`);
    } else if (decision.css !== undefined) {
      throw new Error(`proposals: ${id} is a keep, so it must not carry 'css'`);
    }
  }
  return { ...input, pages, widths, hide };
}

export function hiddenCss(proposals) {
  return `${[...DEV_OVERLAYS, ...proposals.hide].join(",\n")} { display: none !important; }`;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
}

export function pictureName(page, width, variant) {
  return `${slug(page.name)}-${width}-${variant}.png`;
}

// Every picture after the before: all the changes together, then each change
// on its own so its effect can be told apart from the rest. With a single
// change, all together would be the same picture twice.
export function pictureSets(proposals) {
  const changes = proposals.decisions.filter((d) => d.action === "change");
  const each = changes.map((d) => ({ variant: d.id, css: d.css }));
  if (changes.length < 2) return each;
  return [{ variant: "all", css: changes.map((d) => d.css).join("\n") }, ...each];
}

function escape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function pairs(proposals, variant) {
  return proposals.pages.flatMap((page) => proposals.widths.map((width) => ({ page, width, name: pictureName(page, width, variant) })));
}

// A pair that came out pixel for pixel the same is not shown: the change does
// not reach that page, or its CSS did not take, and either way the user
// should read that rather than hunt for a difference that is not there.
function comparison(proposals, folder, variant, label, unchanged) {
  const rows = [];
  for (const { page, width, name } of pairs(proposals, variant)) {
    if (unchanged.has(name)) {
      rows.push(`
    <figure class="pair same">
      <figcaption>${escape(page.name)} · ${width}px</figcaption>
      <p>No visible difference on this page.</p>
    </figure>`);
      continue;
    }
    const before = `${folder}/${pictureName(page, width, "before")}`;
    const after = `${folder}/${name}`;
    rows.push(`
    <figure class="pair${width < 600 ? " narrow" : ""}">
      <figcaption>${escape(page.name)} · ${width}px</figcaption>
      <a href="${escape(before)}"><img src="${escape(before)}" alt="${escape(page.name)} at ${width}px, as it is" loading="lazy"><span>Before</span></a>
      <a href="${escape(after)}"><img src="${escape(after)}" alt="${escape(page.name)} at ${width}px, ${escape(label)}" loading="lazy"><span>After</span></a>
    </figure>`);
  }
  return rows.join("");
}

function decisionSection(proposals, folder, decision, number, unchanged) {
  const change = decision.action === "change";
  const value = change
    ? `<code>${escape(decision.current)}</code> <span class="arrow" aria-label="becomes">→</span> <code>${escape(decision.proposed)}</code>`
    : `<code>${escape(decision.current)}</code> stays`;
  const usedIn = (decision.used_in ?? []).map((f) => `<code>${escape(f)}</code>`).join(", ");
  return `
    <section class="decision ${change ? "change" : "keep"}" id="${escape(decision.id)}">
      <header>
        <span class="number">${number}</span>
        <h2>${escape(decision.title)}</h2>
        <span class="action">${change ? "Change" : "Keep"}</span>
      </header>
      <p class="value">${value}</p>
      <p class="why">${escape(decision.why)}</p>
      <dl>
        ${decision.source ? `<dt>Source</dt><dd><code>${escape(decision.source)}</code></dd>` : ""}
        ${usedIn ? `<dt>Used in</dt><dd>${usedIn}</dd>` : ""}
        ${decision.category ? `<dt>Tell</dt><dd>${escape(decision.category)}</dd>` : ""}
      </dl>
      ${change && pairs(proposals, decision.id).every((p) => unchanged.has(p.name))
        ? `<p class="warning" role="note">No visible difference on any page pictured. Check that its CSS uses the same selector as the rule it overrides, or add a page where it shows.</p>`
        : ""}
      ${change ? `<div class="pairs">${comparison(proposals, folder, decision.id, "with this change", unchanged)}</div>` : ""}
    </section>`;
}

export function renderReview(proposals, folder, unchanged = new Set()) {
  const changes = proposals.decisions.filter((d) => d.action === "change");
  const keeps = proposals.decisions.filter((d) => d.action === "keep");
  const title = `Redesign proposals · ${proposals.site ?? proposals.url}`;
  const sections = proposals.decisions.map((d, i) => decisionSection(proposals, folder, d, i + 1, unchanged)).join("");
  const together = changes.length >= 2
    ? `<section class="together">
      <h2>All changes together</h2>
      <div class="pairs">${comparison(proposals, folder, "all", "with every change", unchanged)}</div>
    </section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root {
    --ink: #111111;
    --muted: #5a5a5a;
    --rule: #d0d0d0;
    --page: #ffffff;
    --accent: #c8321e;
    --keep: #1f5f99;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f2f2f2; --muted: #a8a8a8; --rule: #3a3a3a; --page: #121212; --accent: #ff6a52; --keep: #7db4ec; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font: 17px/1.5 "Iowan Old Style", Charter, "Palatino Linotype", Georgia, serif;
  }
  main { max-width: 1180px; margin: 0 auto; padding: 48px 16px 96px; }
  code, .number, .action, figcaption, .pair span, dt {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.05; margin: 0 0 8px; letter-spacing: -0.01em; }
  .summary { color: var(--muted); margin: 0 0 40px; }
  .summary strong { color: var(--ink); }
  h2 { font-size: 22px; line-height: 1.2; margin: 0; }
  section { border-top: 2px solid var(--ink); padding: 20px 0 40px; }
  .decision header { display: flex; align-items: baseline; gap: 12px; }
  .number { color: var(--muted); font-size: 14px; min-width: 2ch; }
  .action {
    margin-left: auto;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border: 1px solid currentColor;
  }
  .change .action { color: var(--accent); }
  .keep .action { color: var(--keep); }
  .value { font-size: 20px; margin: 12px 0 4px; }
  .arrow { color: var(--accent); padding: 0 4px; }
  .why { margin: 0 0 12px; max-width: 64ch; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; margin: 0 0 20px; font-size: 15px; }
  dt { color: var(--muted); font-size: 13px; padding-top: 2px; }
  dd { margin: 0; }
  .pairs { display: grid; gap: 24px; }
  .pair { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; align-items: start; }
  .pair.narrow { grid-template-columns: repeat(2, minmax(0, 320px)); }
  figcaption { grid-column: 1 / -1; font-size: 13px; color: var(--muted); }
  .pair a { display: block; position: relative; border: 1px solid var(--rule); color: inherit; text-decoration: none; }
  .pair img { display: block; width: 100%; height: auto; }
  .pair span {
    position: absolute; left: 0; top: 0;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    background: var(--ink); color: var(--page); padding: 2px 6px;
  }
  .together { border-top-width: 4px; }
  .same p { grid-column: 1 / -1; margin: 0; padding: 12px; border: 1px dashed var(--rule); color: var(--muted); font-size: 15px; }
  .warning { border-left: 4px solid var(--accent); padding: 8px 12px; margin: 0 0 20px; max-width: 64ch; }
  .together h2 { margin-bottom: 16px; }
  @media (max-width: 640px) {
    .pair, .pair.narrow { grid-template-columns: 1fr 1fr; }
    .value { font-size: 17px; }
  }
</style>
</head>
<body>
<main>
  <h1>${escape(proposals.site ?? "Redesign")}: proposals</h1>
  <p class="summary"><strong>${plural(changes.length, "change")}</strong> and <strong>${plural(keeps.length, "keep")}</strong>, previewed on <code>${escape(proposals.url)}</code>. Approve or amend them in the chat. Nothing in the site has changed yet.</p>
  ${together}
  ${sections}
</main>
</body>
</html>
`;
}
