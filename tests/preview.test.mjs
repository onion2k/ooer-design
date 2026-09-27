// Tests for how the preview script reads its arguments and finds Playwright.
//
// The pictures themselves need a browser and a running site, so they are
// checked by running the script against a real dev server. What can go wrong
// without one is covered here: a missing folder argument, and a site with no
// Playwright, which must say what to do rather than throw a stack trace.
//
// Run with: node --test 'tests/**/*.test.mjs'

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { findPlaywright, parseArgs, unchangedPictures } from "../skills/redesign/preview.mjs";
import { checkProposals } from "../skills/redesign/review.mjs";

test("the proposals file, the out folder and the project are read", () => {
  const args = parseArgs(["p.json", "--out", "shots", "--project", "../site"]);
  assert.deepEqual(args, { proposals: "p.json", out: "shots", project: "../site" });
});

test("the project defaults to the current folder", () => {
  assert.equal(parseArgs(["p.json", "--out", "shots"]).project, process.cwd());
});

test("the out folder is required", () => {
  assert.throws(() => parseArgs(["p.json"]), /--out is required/);
  assert.throws(() => parseArgs(["p.json", "--out"]), /--out needs a folder/);
  assert.throws(() => parseArgs(["p.json", "--out", "--project", "x"]), /--out needs a folder/);
});

test("the proposals file is required, and only one", () => {
  assert.throws(() => parseArgs(["--out", "shots"]), /usage/);
  assert.throws(() => parseArgs(["a.json", "b.json", "--out", "shots"]), /unexpected argument b\.json/);
});

test("an unknown option is refused", () => {
  assert.throws(() => parseArgs(["p.json", "--out", "x", "--full"]), /unknown option --full/);
});

test("a site with no Playwright is told how to install it", () => {
  const site = mkdtempSync(path.join(tmpdir(), "ooer-site-"));
  writeFileSync(path.join(site, "package.json"), "{}");
  assert.throws(() => findPlaywright(site), /No Playwright in .*npm i -D playwright/);
});

test("an after picture that is byte for byte the before is found unchanged", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "ooer-pictures-"));
  const proposals = checkProposals({
    url: "http://localhost:4321",
    widths: [1280],
    decisions: [
      { id: "a", title: "A", action: "change", proposed: "x", why: "w", css: "a {}" },
      { id: "b", title: "B", action: "change", proposed: "y", why: "w", css: "b {}" },
    ],
  });
  writeFileSync(path.join(folder, "home-1280-before.png"), "same pixels");
  writeFileSync(path.join(folder, "home-1280-a.png"), "same pixels");
  writeFileSync(path.join(folder, "home-1280-b.png"), "other pixels");
  writeFileSync(path.join(folder, "home-1280-all.png"), "other pixels");
  assert.deepEqual([...(await unchangedPictures(proposals, folder))], ["home-1280-a.png"]);
});

test("the site's Playwright is found under whichever name it was installed", () => {
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    const site = mkdtempSync(path.join(tmpdir(), "ooer-site-"));
    writeFileSync(path.join(site, "package.json"), "{}");
    const folder = path.join(site, "node_modules", ...name.split("/"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, main: "index.js" }));
    writeFileSync(path.join(folder, "index.js"), `module.exports = { found: ${JSON.stringify(name)} };`);
    assert.equal(findPlaywright(site).found, name);
  }
});
