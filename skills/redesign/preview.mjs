#!/usr/bin/env node
// Picture every proposed change on the running site, and write the review page.
//
// The redesign skill shows the user what each change looks like before any
// source is edited. This script loads the dev server in a fresh headless
// browser, takes a before picture, then injects each change's CSS and takes
// an after picture, once for every page and width. It uses the site's own
// Playwright, so the plugin carries no browser of its own, and a fresh context,
// so the user's own browser and its saved state are never touched.
//
// Usage: node preview.mjs <proposals.json> --out <folder> [--project <site folder>]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { checkProposals, hiddenCss, pictureName, pictureSets, renderReview } from "./review.mjs";

const PICTURES = "pictures";
const HEIGHT_FOR_WIDTH = (width) => (width < 600 ? 812 : 800);

export function parseArgs(argv) {
  const args = { proposals: undefined, out: undefined, project: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" || arg === "--project") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a folder`);
      args[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else if (args.proposals === undefined) {
      args.proposals = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (!args.proposals) throw new Error("usage: preview.mjs <proposals.json> --out <folder> [--project <site folder>]");
  if (!args.out) throw new Error("--out is required: the folder the pictures and review page go in");
  return args;
}

// The site's Playwright, under whichever name it was installed.
export function findPlaywright(project) {
  const require = createRequire(path.join(path.resolve(project), "package.json"));
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    try {
      return require(name);
    } catch {
      // Try the next name.
    }
  }
  throw new Error(
    `No Playwright in ${path.resolve(project)}. Install it there with "npm i -D playwright", or pass --project with the site's folder.`,
  );
}

async function checkServer(url) {
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(`Nothing answered at ${url}. Start the site's dev server, then run this again.`);
  }
}

// Two animation frames after fonts are ready is when the page has painted
// with its real faces; waiting on a clock would be slower and still guess.
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function shoot(context, proposals, page, width, css, file) {
  const tab = await context.newPage();
  try {
    await tab.setViewportSize({ width, height: HEIGHT_FOR_WIDTH(width) });
    await tab.goto(new URL(page.path, proposals.url).href, { waitUntil: "load" });
    if (page.setup) await tab.evaluate(page.setup);
    await tab.addStyleTag({ content: hiddenCss(proposals) });
    if (css) await tab.addStyleTag({ content: css });
    await settle(tab);
    await tab.screenshot({ path: file, fullPage: page.fullPage === true });
  } finally {
    await tab.close();
  }
}

// The after pictures whose file is byte for byte the before. The same pixels
// from the same browser encode to the same file, so no image decoder is needed.
export async function unchangedPictures(proposals, folder) {
  const unchanged = new Set();
  const sets = pictureSets(proposals);
  for (const page of proposals.pages) {
    for (const width of proposals.widths) {
      const before = await readFile(path.join(folder, pictureName(page, width, "before")));
      for (const set of sets) {
        const name = pictureName(page, width, set.variant);
        if (before.equals(await readFile(path.join(folder, name)))) unchanged.add(name);
      }
    }
  }
  return unchanged;
}

export async function run(argv) {
  const args = parseArgs(argv);
  const proposals = checkProposals(JSON.parse(await readFile(args.proposals, "utf8")));
  const { chromium } = findPlaywright(args.project);
  await checkServer(proposals.url);

  const folder = path.join(args.out, PICTURES);
  await mkdir(folder, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (/Executable doesn't exist|install/i.test(String(error))) {
      throw new Error(`Playwright has no Chromium yet. In ${path.resolve(args.project)}, run "npx playwright install chromium".`);
    }
    throw error;
  }
  const written = [];
  try {
    const context = await browser.newContext({ reducedMotion: "reduce", deviceScaleFactor: 1 });
    const sets = [{ variant: "before", css: "" }, ...pictureSets(proposals)];
    for (const page of proposals.pages) {
      for (const width of proposals.widths) {
        for (const set of sets) {
          const file = path.join(folder, pictureName(page, width, set.variant));
          await shoot(context, proposals, page, width, set.css, file);
          written.push(file);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const unchanged = await unchangedPictures(proposals, folder);
  const review = path.join(args.out, "review.html");
  await writeFile(review, renderReview(proposals, PICTURES, unchanged));
  return { review, pictures: written, unchanged };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(process.argv.slice(2)).then(
    ({ review, pictures, unchanged }) => {
      console.log(`${pictures.length} pictures written, ${unchanged.size} the same as before.`);
      console.log(`Review page: ${review}`);
    },
    (error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    },
  );
}
