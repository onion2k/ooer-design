// Tests for the proposals file and the review page the redesign skill shows.
//
// The review page is where the user approves every change at once, so a
// proposal that goes missing from it, a picture shown under the wrong
// decision, or site text that breaks the page would all mean approving
// something that was never seen.
//
// Run with: node --test tests/

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkProposals, pictureName, pictureSets, renderReview } from "../skills/redesign/review.mjs";

function proposals(overrides = {}) {
  return {
    site: "Panic & Wonder",
    url: "http://localhost:4321",
    decisions: [
      {
        id: "radius-lg",
        title: "Card corners",
        category: "radius",
        action: "change",
        current: "14px",
        proposed: "2px",
        why: "Soft cards read as a template.",
        source: "design-system/tokens.json",
        used_in: ["src/components/Card.astro"],
        css: ":root { --radius-lg: 2px; }",
      },
      {
        id: "antiquity-paper",
        title: "Antiquity paper",
        category: "beige",
        action: "keep",
        current: "#efe6d2",
        why: "Parchment is the point of this era.",
        source: "design-system/tokens.json",
      },
    ],
    ...overrides,
  };
}

test("a good proposals file gets the default pages and widths", () => {
  const checked = checkProposals(proposals());
  assert.deepEqual(checked.pages, [{ name: "Home", path: "/" }]);
  assert.deepEqual(checked.widths, [1280, 375]);
});

test("a proposals file must name a web address", () => {
  assert.throws(() => checkProposals(proposals({ url: "localhost:4321" })), /url/);
});

test("a change must carry the CSS that previews it and what it becomes", () => {
  const p = proposals();
  delete p.decisions[0].css;
  assert.throws(() => checkProposals(p), /radius-lg.*css/);
  const q = proposals();
  delete q.decisions[0].proposed;
  assert.throws(() => checkProposals(q), /radius-lg.*proposed/);
});

test("a keep must say why, and must not carry CSS", () => {
  const p = proposals();
  p.decisions[1].why = " ";
  assert.throws(() => checkProposals(p), /antiquity-paper.*why/);
  const q = proposals();
  q.decisions[1].css = ":root {}";
  assert.throws(() => checkProposals(q), /antiquity-paper.*css/);
});

test("an action other than change or keep is refused", () => {
  const p = proposals();
  p.decisions[0].action = "maybe";
  assert.throws(() => checkProposals(p), /radius-lg.*action/);
});

test("ids must be unique and safe to use in a file name", () => {
  const p = proposals();
  p.decisions[1].id = "radius-lg";
  assert.throws(() => checkProposals(p), /radius-lg.*twice/);
  const q = proposals();
  q.decisions[0].id = "../escape";
  assert.throws(() => checkProposals(q), /id/);
});

test("widths must be whole numbers of pixels", () => {
  assert.throws(() => checkProposals(proposals({ widths: [1280, "375"] })), /widths/);
  assert.throws(() => checkProposals(proposals({ widths: [0] })), /widths/);
});

test("picture names are unique for page, width and variant", () => {
  const pages = [
    { name: "Home", path: "/" },
    { name: "Medieval era", path: "/", setup: "x" },
  ];
  const names = new Set();
  for (const page of pages) {
    for (const width of [1280, 375]) {
      for (const variant of ["before", "all", "radius-lg"]) {
        names.add(pictureName(page, width, variant));
      }
    }
  }
  assert.equal(names.size, 12);
  assert.equal(pictureName(pages[1], 375, "before"), "medieval-era-375-before.png");
});

test("only changes are pictured, and all together carries every change's CSS", () => {
  const all = pictureSets(twoChanges()).find((s) => s.variant === "all");
  assert.equal(all.css, ":root { --radius-lg: 2px; }\n:root { --font-body: 'Source Serif 4'; }");
});

test("the review page shows every decision, with its pictures under it", () => {
  const html = renderReview(checkProposals(proposals()), "pictures");
  assert.match(html, /Card corners/);
  assert.match(html, /Antiquity paper/);
  assert.match(html, /Parchment is the point of this era\./);
  assert.match(html, /14px/);
  assert.match(html, /2px/);
  const cardSection = html.slice(html.indexOf('id="radius-lg"'), html.indexOf('id="antiquity-paper"'));
  assert.match(cardSection, /pictures\/home-1280-before\.png/);
  assert.match(cardSection, /pictures\/home-1280-radius-lg\.png/);
  assert.match(cardSection, /pictures\/home-375-radius-lg\.png/);
  const keepSection = html.slice(html.indexOf('id="antiquity-paper"'));
  assert.doesNotMatch(keepSection, /<img/);
});

test("the review page counts changes and keeps", () => {
  const html = renderReview(checkProposals(proposals()), "pictures");
  assert.match(html, /1 change/);
  assert.match(html, /1 keep/);
});

test("text from the site is escaped", () => {
  const p = proposals();
  p.decisions[0].why = "<script>alert(1)</script> & more";
  const html = renderReview(checkProposals(p), "pictures");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/);
  assert.match(html, /Panic &amp; Wonder/);
});

test("dev server overlays are hidden in every picture, and more can be named", async () => {
  const { hiddenCss } = await import("../skills/redesign/review.mjs");
  const css = hiddenCss(checkProposals(proposals()));
  assert.match(css, /astro-dev-toolbar/);
  assert.match(css, /nextjs-portal/);
  assert.match(css, /display: none !important/);
  assert.match(hiddenCss(checkProposals(proposals({ hide: [".cookie-banner"] }))), /\.cookie-banner/);
  assert.throws(() => checkProposals(proposals({ hide: ".cookie-banner" })), /hide/);
});

function twoChanges() {
  const p = proposals();
  p.decisions.push({
    id: "font-body",
    title: "Body face",
    action: "change",
    current: "Inter",
    proposed: "Source Serif 4",
    why: "Inter is the default.",
    css: ":root { --font-body: 'Source Serif 4'; }",
  });
  return checkProposals(p);
}

test("with a single change there is no separate all-together section", () => {
  const html = renderReview(checkProposals(proposals()), "pictures");
  assert.doesNotMatch(html, /All changes together/);
  assert.doesNotMatch(html, /-all\.png/);
});

test("with two changes the all-together section comes first", () => {
  const html = renderReview(twoChanges(), "pictures");
  assert.ok(html.indexOf("home-1280-all.png") < html.indexOf('id="radius-lg"'));
});

test("with a single change only that change is pictured", () => {
  assert.deepEqual(pictureSets(checkProposals(proposals())).map((s) => s.variant), ["radius-lg"]);
  assert.deepEqual(pictureSets(twoChanges()).map((s) => s.variant), ["all", "radius-lg", "font-body"]);
});

test("a change that looks the same as before says so instead of showing the pair", () => {
  const unchanged = new Set(["home-375-radius-lg.png"]);
  const html = renderReview(checkProposals(proposals()), "pictures", unchanged);
  const section = html.slice(html.indexOf('id="radius-lg"'), html.indexOf('id="antiquity-paper"'));
  assert.match(section, /home-1280-radius-lg\.png/);
  assert.doesNotMatch(section, /home-375-radius-lg\.png/);
  assert.match(section, /Home · 375px[\s\S]*No visible difference/);
});

test("a change with no visible difference anywhere is flagged", () => {
  const unchanged = new Set(["home-1280-radius-lg.png", "home-375-radius-lg.png"]);
  const html = renderReview(checkProposals(proposals()), "pictures", unchanged);
  assert.match(html, /class="warning"[^>]*>[^<]*No visible difference on any page/);
});

function withCopyChange() {
  const p = proposals();
  p.decisions.push({
    id: "hero-copy",
    title: "Hero line",
    category: "copy",
    action: "change",
    kind: "text",
    current: "Elevate your workflow, seamlessly.",
    proposed: "Plan the week in one screen.",
    why: "Verb cosplay with no object.",
    source: "src/pages/index.astro",
  });
  return p;
}

test("a text change needs no CSS and is not pictured", () => {
  const checked = checkProposals(withCopyChange());
  assert.equal(checked.decisions.length, 3);
  assert.deepEqual(pictureSets(checked).map((s) => s.variant), ["radius-lg"]);
});

test("a text change must say what the text becomes", () => {
  const p = withCopyChange();
  delete p.decisions[2].proposed;
  assert.throws(() => checkProposals(p), /hero-copy.*proposed/);
});

test("a text change must not carry CSS", () => {
  const p = withCopyChange();
  p.decisions[2].css = ":root {}";
  assert.throws(() => checkProposals(p), /hero-copy.*css/);
});

test("the review page shows a text change as before and after words", () => {
  const html = renderReview(checkProposals(withCopyChange()), "pictures");
  const section = html.slice(html.indexOf('id="hero-copy"'));
  assert.match(section, /Elevate your workflow, seamlessly\./);
  assert.match(section, /Plan the week in one screen\./);
  assert.doesNotMatch(section, /<img/);
  assert.doesNotMatch(section, /No visible difference/);
});

test("text changes count as changes in the summary", () => {
  const html = renderReview(checkProposals(withCopyChange()), "pictures");
  assert.match(html, /2 changes/);
});

test("a text change with no visible difference is not flagged as invisible", () => {
  const unchanged = new Set(["home-1280-radius-lg.png", "home-375-radius-lg.png"]);
  const html = renderReview(checkProposals(withCopyChange()), "pictures", unchanged);
  const section = html.slice(html.indexOf('id="hero-copy"'));
  assert.doesNotMatch(section, /class="warning"/);
});

test("one pictured change beside a text change has no all-together section", () => {
  const html = renderReview(checkProposals(withCopyChange()), "pictures");
  assert.doesNotMatch(html, /All changes together/);
  assert.doesNotMatch(html, /-all\.png/);
});
