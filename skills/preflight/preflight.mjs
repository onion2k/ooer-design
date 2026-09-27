#!/usr/bin/env node
// Run the Preflight Checklist against a site and hand the results back in
// the checklist's own shape.
//
// The checklist at https://onion2k.github.io/preflight/ says what to verify
// and how; this script does the fetching, loads pages in the site's own
// Playwright, and gives each rule in rules.mjs what it needs. What it writes
// is a plain report, the results JSON the checklist's "Save, load or share
// this run" panel imports, and a share link that opens the checklist with
// the run already in place. It never writes into the site.
//
// Usage: node preflight.mjs <url> --out <folder> [--project <site folder>]
//        [--max-pages 50] [--checks <path or url>] [--no-lighthouse]

import { execFile } from "node:child_process";
import { promises as dns } from "node:dns";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { findPlaywright } from "../redesign/preview.mjs";
import { externalLinks, internalLinks, isDevServer, isLocalTarget, sitemapUrls, templatePages } from "./discover.mjs";
import { BUILD_ONLY, PRODUCTION_ONLY, RULES } from "./rules.mjs";
import { CHECKLIST, blob, encodeLink, loadChecks, renderReport, settle } from "./results.mjs";

const FETCH_TIMEOUT = 8000;
const EXTERNAL_LINK_CAP = 50;
const TEMPLATE_CAP = 5;
const LIGHTHOUSE_PAGES = 3;
const FILES = ["/robots.txt", "/sitemap.xml", "/llms.txt", "/.well-known/security.txt", "/favicon.ico", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"];
const PROBES = ["/.env", "/.git/HEAD", "/admin", "/wp-admin/", "/phpmyadmin/", "/.DS_Store"];
const ANALYTICS = /google-analytics|googletagmanager|plausible|fathom|umami|posthog|segment\.io|mixpanel|hotjar|clarity\.ms|matomo|cloudflareinsights|vercel-insights|_vercel\/insights/i;
const SOCIAL = /(?:twitter|x|facebook|linkedin|instagram|github|youtube|tiktok|mastodon|bsky|threads)\.(?:com|social|app)/i;

export function parseArgs(argv) {
  const args = { url: undefined, out: undefined, project: process.cwd(), maxPages: 50, checks: undefined, lighthouse: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" || arg === "--project" || arg === "--checks" || arg === "--max-pages") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--max-pages") {
        args.maxPages = Number(value);
        if (!Number.isInteger(args.maxPages) || args.maxPages < 1) throw new Error("--max-pages must be a whole number of pages");
      } else {
        args[arg.slice(2)] = value;
      }
    } else if (arg === "--no-lighthouse") {
      args.lighthouse = false;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else if (args.url === undefined) {
      args.url = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (!args.url) throw new Error("usage: preflight.mjs <url> --out <folder> [--project <site folder>]");
  if (!args.out) throw new Error("--out is required: the folder the report and results go in");
  let url;
  try {
    url = new URL(args.url);
  } catch {
    throw new Error(`Not a URL: ${args.url}. Pass a full address such as https://example.com`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http and https targets are supported; got ${url.protocol}`);
  args.url = url.href;
  return args;
}

// ---------------------------------------------------------------------------
// Plain requests

async function get(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal, ...options });
    const headers = {};
    for (const [name, value] of response.headers) headers[name.toLowerCase()] = value;
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    const type = headers["content-type"] ?? "";
    const text = options.method === "HEAD" || !/text|xml|json|javascript/i.test(type) ? "" : await response.text();
    return { status: response.status, headers, setCookies, contentType: type, location: headers.location ?? null, text };
  } catch (error) {
    return { status: null, error: error.name === "AbortError" ? "timeout" : error.message, headers: {}, setCookies: [], contentType: "", location: null, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function follow(url, hops = 5) {
  let current = url;
  for (let i = 0; i < hops; i++) {
    const response = await get(current);
    if (response.status && response.status >= 300 && response.status < 400 && response.location) {
      current = new URL(response.location, current).href;
      continue;
    }
    return { ...response, url: current };
  }
  return { status: null, error: "too many redirects", headers: {}, setCookies: [], contentType: "", location: null, text: "", url: current };
}

async function discoverPages(target, maxPages) {
  const sitemap = await get(new URL("/sitemap.xml", target).href);
  let pages = [];
  if (sitemap.status === 200 && /<(?:urlset|sitemapindex)\b/i.test(sitemap.text)) {
    let { pages: found, sitemaps } = sitemapUrls(sitemap.text);
    for (const child of sitemaps.slice(0, 5)) {
      const response = await get(child);
      if (response.status === 200) found = found.concat(sitemapUrls(response.text).pages);
    }
    pages = found.filter((u) => u.startsWith(new URL(target).origin));
  }
  const crawled = new Map();
  const queue = pages.length ? [] : [new URL("/", target).href];
  const statuses = {};
  const external = new Set();
  while (queue.length && crawled.size < maxPages) {
    const url = queue.shift();
    if (crawled.has(url)) continue;
    const response = await follow(url);
    crawled.set(url, response);
    statuses[url] = response.status ?? response.error;
    if (response.status === 200 && /text\/html/.test(response.contentType)) {
      for (const link of internalLinks(response.text, url)) if (!crawled.has(link)) queue.push(link);
      for (const link of externalLinks(response.text, url)) external.add(link);
    }
  }
  if (!pages.length) pages = [...crawled.keys()].filter((u) => crawled.get(u).status === 200 && /text\/html/.test(crawled.get(u).contentType));
  return { pages: pages.slice(0, maxPages), fromSitemap: sitemap.status === 200 && pages.length > 0, statuses, external: [...external], crawled };
}

async function checkLinks(pages, external, statuses) {
  const out = { ...statuses };
  for (const url of pages) {
    if (out[url] === undefined) {
      const response = await get(url, { method: "HEAD" });
      out[url] = response.status ?? response.error;
    }
  }
  for (const url of external.slice(0, EXTERNAL_LINK_CAP)) {
    let response = await get(url, { method: "HEAD" });
    if (response.status === 405 || response.status === 403) response = await get(url);
    out[url] = response.status ?? response.error;
  }
  return out;
}

async function fetchFiles(target) {
  const files = {};
  for (const file of FILES) {
    const response = await follow(new URL(file, target).href);
    files[file] = { status: response.status, contentType: response.contentType, body: response.text.slice(0, 20000) };
  }
  return files;
}

async function probe(target) {
  const out = {};
  for (const p of PROBES) out[p] = (await get(new URL(p, target).href)).status;
  return out;
}

function tlsInfo(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: FETCH_TIMEOUT }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ protocol: socket.getProtocol(), validTo: cert.valid_to ? new Date(cert.valid_to).toISOString() : null, authorized: socket.authorized });
      socket.end();
    });
    socket.on("error", (error) => resolve({ error: error.message }));
    socket.on("timeout", () => { socket.destroy(); resolve({ error: "timeout" }); });
  });
}

async function dnsInfo(host) {
  const apex = host.replace(/^www\./, "");
  const quiet = (promise) => promise.catch(() => []);
  const [a, www, caa, txt, dmarc, mx] = await Promise.all([
    quiet(dns.resolve4(apex)), quiet(dns.resolve4(`www.${apex}`)), quiet(dns.resolveCaa(apex)),
    quiet(dns.resolveTxt(apex)), quiet(dns.resolveTxt(`_dmarc.${apex}`)), quiet(dns.resolveMx(apex)),
  ]);
  const flat = (records) => records.map((r) => r.join(""));
  return {
    apex: a, www, caa: caa.map((c) => `${c.issue ?? c.issuewild ?? c.iodef}`),
    spf: flat(txt).find((t) => /^v=spf1/i.test(t)) ?? null,
    dmarc: flat(dmarc).find((t) => /^v=DMARC1/i.test(t)) ?? null,
    mx: mx.map((m) => m.exchange),
  };
}

// ---------------------------------------------------------------------------
// In the browser

// Runs inside the page: everything a rule needs to know about its DOM.
function extract() {
  const q = (s, root = document) => [...root.querySelectorAll(s)];
  const text = (el) => (el ? (el.textContent || "").trim() : "");
  const origin = location.origin;
  const named = (el) => el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.hasAttribute("title");
  const headings = q("h1, h2, h3, h4, h5, h6").map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 80) }));
  const skip = q("a[href^='#']").slice(0, 3).some((a) => /skip/i.test(text(a)) || /#(?:main|content)/i.test(a.getAttribute("href")));
  const iconOnly = q("button, a[href]").filter((el) => !text(el) && !named(el) && !q("img[alt]", el).some((img) => img.getAttribute("alt")))
    .map((el) => ({ tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 80) }));
  const controls = q("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea");
  const unlabelled = controls.filter((el) => {
    if (named(el) || el.closest("label")) return false;
    return !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
  }).map((el) => ({ tag: el.tagName.toLowerCase(), name: el.getAttribute("name") || el.getAttribute("type") || "" }));
  const scripts = q("script[src]").map((s) => {
    let external = false;
    try { external = new URL(s.src, location.href).origin !== origin; } catch {}
    return { src: s.getAttribute("src"), async: s.async, defer: s.defer, module: s.type === "module", inHead: !!s.closest("head"), integrity: s.getAttribute("integrity"), external };
  });
  let fontFaces = 0, printRules = false;
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.constructor.name === "CSSFontFaceRule") fontFaces++;
        if (rule.media && /print/.test(rule.media.mediaText)) printRules = true;
        if (rule.cssRules) for (const inner of rule.cssRules) if (inner.constructor.name === "CSSFontFaceRule") fontFaces++;
      }
    } catch {}
  }
  const printLink = q("link[rel=stylesheet][media]").some((l) => /print/.test(l.media));
  const fontLinks = q("link[rel=stylesheet][href*='fonts.googleapis'], link[rel=stylesheet][href*='fonts.bunny'], link[rel=stylesheet][href*='fontshare']").length;
  const links = q("a[href]").map((a) => ({ href: a.getAttribute("href"), text: text(a).slice(0, 60) }));
  const contacts = [...new Set(links.map((l) => l.href).filter((h) => /^(?:mailto|tel):/i.test(h) || SOCIAL_HOSTS.test(h)))];
  const staging = [...new Set(links.map((l) => l.href).filter((h) => /(?:localhost|127\.0\.0\.1|\bstaging\.|\bdev\.)/i.test(h) && !h.startsWith(origin)))];
  return {
    url: location.href,
    title: document.title || null,
    description: document.querySelector("meta[name=description]")?.getAttribute("content") || null,
    lang: document.documentElement.getAttribute("lang") || null,
    canonical: document.querySelector("link[rel=canonical]")?.getAttribute("href") || null,
    robotsMeta: document.querySelector("meta[name=robots]")?.getAttribute("content") || null,
    headings,
    landmarks: {
      nav: !!document.querySelector("nav, [role=navigation]"),
      main: !!document.querySelector("main, [role=main]"),
      footer: !!document.querySelector("footer, [role=contentinfo]"),
    },
    skipLink: skip,
    images: q("img").map((img) => ({ src: img.getAttribute("src") || img.currentSrc || "", alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null, width: Number(img.getAttribute("width")) || null, height: Number(img.getAttribute("height")) || null, resolved: img.currentSrc || img.src })),
    iconOnlyControls: iconOnly,
    unlabelledControls: unlabelled,
    hasForms: !!document.querySelector("form, input, select, textarea"),
    og: {
      title: document.querySelector("meta[property='og:title']")?.getAttribute("content") || null,
      description: document.querySelector("meta[property='og:description']")?.getAttribute("content") || null,
      image: document.querySelector("meta[property='og:image']")?.getAttribute("content") || null,
    },
    jsonLd: q("script[type='application/ld+json']").map((s) => s.textContent),
    scripts,
    frames: [...new Set(q("iframe[src]").map((f) => { try { return new URL(f.src, location.href).origin; } catch { return f.getAttribute("src"); } }))],
    fonts: { declared: fontFaces + fontLinks, requested: 0, preloaded: q("link[rel=preload][as=font]").length },
    icons: q("link[rel~=icon]").map((l) => l.getAttribute("href")).filter(Boolean),
    hasPrintStyles: printRules || printLink,
    feedLinks: q("link[rel=alternate][type]").filter((l) => /rss|atom|xml|json/.test(l.type)).map((l) => l.getAttribute("href")),
    autoplayWithSound: q("video[autoplay]:not([muted]), audio[autoplay]").length,
    hreflang: q("link[rel=alternate][hreflang]").map((l) => l.hreflang),
    links,
    contacts,
    stagingLinks: staging,
    privacyLink: links.find((l) => /privacy/i.test(l.text))?.href || null,
    footerText: text(document.querySelector("footer")).slice(0, 400),
  };
}

function overflowing() {
  return document.documentElement.scrollWidth > window.innerWidth + 1;
}

function zoomedOverflow() {
  document.documentElement.style.zoom = "2";
  const result = document.documentElement.scrollWidth > window.innerWidth + 1;
  document.documentElement.style.zoom = "";
  return result;
}

function animating() {
  let count = 0;
  for (const el of document.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.animationName !== "none" && style.animationPlayState !== "paused" && parseFloat(style.animationDuration) > 0) count++;
  }
  return count;
}

function backgroundColour() {
  return getComputedStyle(document.body).backgroundColor + "|" + getComputedStyle(document.body).color;
}

function mainText() {
  const main = document.querySelector("main, [role=main]") || document.body;
  return { mainText: (main.textContent || "").replace(/\s+/g, " ").trim().length, hasNav: !!document.querySelector("nav, [role=navigation]") };
}

// The extraction function is serialised into the page, so the regex it
// shares with this file has to travel with it.
const EXTRACT = `(${extract.toString().replace("SOCIAL_HOSTS", SOCIAL.toString())})()`;

async function loadPage(context, url, options = {}) {
  const page = await context.newPage();
  const sizes = new Map();
  const requests = [];
  if (options.light) {
    await page.route("**/*", (route) => (["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue()));
  }
  page.on("response", async (response) => {
    requests.push({ url: response.url(), type: response.request().resourceType() });
    if (options.sizes) {
      try {
        const body = await response.body();
        sizes.set(response.url(), body.length);
      } catch {}
    }
  });
  try {
    const response = await page.goto(url, { waitUntil: options.light ? "domcontentloaded" : "load", timeout: 30000 });
    await page.waitForTimeout(options.light ? 0 : 500);
    return { page, response, sizes, requests };
  } catch (error) {
    await page.close();
    throw error;
  }
}

async function axeFor(project, page) {
  try {
    const { default: AxeBuilder } = await import(createRequire(path.join(path.resolve(project), "package.json")).resolve("@axe-core/playwright"));
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  } catch (error) {
    if (/Cannot find module|MODULE_NOT_FOUND/.test(String(error))) return null;
    throw error;
  }
}

async function lighthouseFor(project, urls) {
  const require = createRequire(path.join(path.resolve(project), "package.json"));
  let cli;
  try {
    cli = require.resolve("lighthouse/cli/index.js");
  } catch {
    return null;
  }
  const run = promisify(execFile);
  const results = [];
  for (const url of urls.slice(0, LIGHTHOUSE_PAGES)) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const { stdout } = await run(process.execPath, [cli, url, "--output=json", "--quiet", "--chrome-flags=--headless=new", "--only-categories=performance,accessibility,best-practices,seo"], { maxBuffer: 64 * 1024 * 1024 });
      const report = JSON.parse(stdout);
      runs.push({
        performance: Math.round(report.categories.performance.score * 100),
        accessibility: Math.round(report.categories.accessibility.score * 100),
        bestPractices: Math.round(report.categories["best-practices"].score * 100),
        seo: Math.round(report.categories.seo.score * 100),
        lcp: report.audits["largest-contentful-paint"]?.numericValue ?? null,
        cls: report.audits["cumulative-layout-shift"]?.numericValue ?? null,
        inp: report.audits["interaction-to-next-paint"]?.numericValue ?? null,
      });
    }
    const median = (key) => { const v = runs.map((r) => r[key]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    results.push({ url, performance: median("performance"), accessibility: median("accessibility"), bestPractices: median("bestPractices"), seo: median("seo"), lcp: median("lcp"), cls: median("cls"), inp: median("inp") });
  }
  return results;
}

// Why a check was left outstanding, in words the person can act on.
export function whyNot(id, { local, dev, axe, lighthouseRuns, fromSitemap }) {
  if (PRODUCTION_ONLY.includes(id) && local) return "a fact about production; run this against the live URL";
  if (BUILD_ONLY.includes(id) && dev) return "a fact about the build, and this is a dev server; run this against a preview of the build, or the live URL";
  if (id === "files.sitemap-urls" && !fromSitemap) return "the site serves no sitemap.xml to read";
  if ((id === "a11y.automated-scan" || id === "a11y.contrast") && !axe) return "the site has no @axe-core/playwright; install it with npm i -D @axe-core/playwright and run again";
  if (id === "perf.lighthouse" || id === "perf.core-web-vitals") {
    return local ? "Lighthouse is a fact about production; run this against the live URL" : "the site has no lighthouse package; install it with npm i -D lighthouse, or run npx lighthouse yourself";
  }
  return "could not be observed on this run";
}

// ---------------------------------------------------------------------------
// The run

export async function run(argv) {
  const started = Date.now();
  const args = parseArgs(argv);
  const target = new URL(args.url);
  const origin = target.origin;
  const local = isLocalTarget(args.url);
  const say = (message) => console.error(message);

  let checksJson;
  const source = args.checks ?? `${CHECKLIST}checks.json`;
  try {
    if (/^https?:/.test(source)) {
      const response = await get(source);
      if (response.status !== 200) throw new Error(`${response.status}`);
      checksJson = JSON.parse(response.text);
      say(`Checks: ${source}`);
    } else {
      checksJson = JSON.parse(await readFile(source, "utf8"));
      say(`Checks: ${source}`);
    }
  } catch {
    checksJson = JSON.parse(await readFile(new URL("./checks.json", import.meta.url), "utf8"));
    say("Checks: the vendored copy (the live checks.json could not be fetched)");
  }
  const checks = loadChecks(checksJson);

  const { chromium } = findPlaywright(args.project);
  const home = await follow(args.url);
  if (home.status === null) throw new Error(`Nothing answered at ${args.url}: ${home.error}. Start the site, then run this again.`);

  say(`Finding pages…`);
  const found = await discoverPages(origin, args.maxPages);
  const pages = found.pages.length ? found.pages : [args.url];
  say(`${pages.length} pages ${found.fromSitemap ? "from the sitemap" : "by crawling"}; ${found.external.length} external links`);
  const linkStatuses = await checkLinks(pages, found.external, found.statuses);
  const files = await fetchFiles(origin);
  const nonsensePath = `there-is-no-page-here-${Date.now().toString(36)}`;
  const nonsense = await get(`${origin}/${nonsensePath}`);
  const probes = await probe(origin);

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (/Executable doesn't exist|install/i.test(String(error))) {
      throw new Error(`Playwright has no Chromium yet. In ${path.resolve(args.project)}, run "npx playwright install chromium".`);
    }
    throw error;
  }

  const models = [];
  let homeModel, transferredBytes = 0, thirdPartyOrigins = new Set(), analytics = new Set(), bundles = [], hashedAsset = null;
  let axe = null, cookiesBeforeConsent, noJs, darkMode, overflow = {}, animatesUnderReducedMotion = 0, dev = false;
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    // The home page in full, with every response measured.
    say("Loading the home page…");
    const first = await loadPage(context, args.url, { sizes: true });
    homeModel = await first.page.evaluate(EXTRACT);
    for (const [url, bytes] of first.sizes) {
      transferredBytes += bytes;
      if (!url.startsWith(origin)) thirdPartyOrigins.add(new URL(url).origin);
      if (ANALYTICS.test(url)) analytics.add(new URL(url).hostname);
      if (!hashedAsset && url.startsWith(origin) && /[.-][0-9a-f]{8,}\.(?:js|css)/i.test(url)) hashedAsset = url;
    }
    // Fonts are counted as the page requested them; a declared face that is
    // never used costs nothing.
    homeModel.fonts.requested = first.requests.filter((r) => r.type === "font").length;
    dev = local && isDevServer(home.text, first.requests.map((r) => r.url));
    for (const image of homeModel.images) {
      const hit = [...first.sizes].find(([url]) => url === image.resolved);
      if (hit) image.bytes = hit[1];
    }
    for (const request of first.requests) {
      if (request.type === "script" && request.url.startsWith(origin)) {
        const response = await get(request.url);
        if (response.text) bundles.push({ url: request.url, text: response.text.slice(0, 2_000_000) });
      }
    }
    cookiesBeforeConsent = (await context.cookies()).map((c) => ({ name: c.name, domain: c.domain }));
    for (const width of [320, 768, 1280, 2560]) {
      await first.page.setViewportSize({ width, height: 900 });
      await first.page.waitForTimeout(100);
      overflow[width] = await first.page.evaluate(overflowing);
    }
    await first.page.setViewportSize({ width: 1280, height: 800 });
    overflow.zoom200 = await first.page.evaluate(zoomedOverflow);
    const lightColours = await first.page.evaluate(backgroundColour);
    await first.page.emulateMedia({ colorScheme: "dark" });
    const darkColours = await first.page.evaluate(backgroundColour);
    await first.page.emulateMedia({ colorScheme: "light", forcedColors: "active" });
    const forcedColours = await first.page.evaluate(backgroundColour);
    darkMode = { changes: darkColours !== lightColours, forcedColors: forcedColours !== lightColours };
    await first.page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
    await first.page.close();

    // Every other page, lightly: the DOM without images, fonts or media.
    say(`Reading ${pages.length} pages…`);
    models.push(homeModel);
    for (const url of pages.filter((u) => u !== args.url)) {
      try {
        const loaded = await loadPage(context, url, { light: true });
        const model = await loaded.page.evaluate(EXTRACT);
        model.xRobotsTag = loaded.response?.headers()["x-robots-tag"] ?? null;
        models.push(model);
        await loaded.page.close();
      } catch (error) {
        say(`  could not read ${url}: ${error.message.split("\n")[0]}`);
      }
    }
    homeModel.xRobotsTag = home.headers["x-robots-tag"] ?? null;
    for (const model of models) {
      const raw = found.crawled.get(model.url)?.text ?? (model.url === args.url ? home.text : "");
      model.html = raw;
      model.comments = (raw.match(/<!--/g) ?? []).length;
      model.sourceMaps = (raw.match(/sourceMappingURL/g) ?? []).length;
    }
    for (const bundle of bundles) if (/sourceMappingURL/.test(bundle.text)) homeModel.sourceMaps++;

    // Reduced motion, then no JavaScript, each in a context of its own.
    const quiet = await browser.newContext({ reducedMotion: "reduce" });
    const still = await loadPage(quiet, args.url);
    animatesUnderReducedMotion = await still.page.evaluate(animating);
    await quiet.close();
    const plain = await browser.newContext({ javaScriptEnabled: false });
    const bare = await loadPage(plain, args.url);
    noJs = await bare.page.evaluate(mainText);
    await plain.close();

    // axe on one page per template, in both colour schemes.
    const templates = templatePages(pages, TEMPLATE_CAP);
    say(`Accessibility scan on ${templates.length} pages…`);
    const light = [], dark = [];
    let axeAvailable = true;
    for (const url of templates) {
      if (!axeAvailable) break;
      const loaded = await loadPage(context, url);
      const violations = await axeFor(args.project, loaded.page);
      if (violations === null) { axeAvailable = false; await loaded.page.close(); break; }
      light.push(...violations);
      await loaded.page.emulateMedia({ colorScheme: "dark" });
      dark.push(...(await axeFor(args.project, loaded.page)));
      await loaded.page.close();
    }
    if (axeAvailable) axe = { light, dark, pages: templates.length };
    await context.close();
  } finally {
    await browser.close();
  }

  const host = target.hostname;
  const production = !local;
  const [tlsResult, dnsResult, httpResult, altResult, cacheBust, caching] = production ? await Promise.all([
    target.protocol === "https:" ? tlsInfo(host) : Promise.resolve({ error: "the target is not https" }),
    dnsInfo(host),
    get(`http://${host}/`),
    (async () => {
      const alt = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
      const response = await get(`${target.protocol}//${alt}/`);
      return { host: alt, status: response.status, location: response.location };
    })(),
    (async () => {
      const busted = await follow(`${args.url}${args.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`);
      return { same: busted.text === home.text };
    })(),
    (async () => {
      const asset = hashedAsset ? await get(hashedAsset) : null;
      return { html: { contentEncoding: home.headers["content-encoding"] ?? null, cacheControl: home.headers["cache-control"] ?? null }, asset: asset ? { url: hashedAsset, contentEncoding: asset.headers["content-encoding"] ?? null, cacheControl: asset.headers["cache-control"] ?? null } : null };
    })(),
  ]) : [null, null, null, null, null, null];

  const iconHref = homeModel.icons[0] ?? null;
  const icon = iconHref ? { href: iconHref, status: (await follow(new URL(iconHref, args.url).href)).status } : null;
  const ogImageStatus = homeModel.og.image && /^https?:/.test(homeModel.og.image) ? (await follow(homeModel.og.image)).status : null;
  const sitemapEntries = found.fromSitemap ? await Promise.all(pages.slice(0, args.maxPages).map(async (url) => {
    const response = await get(url);
    const model = models.find((m) => m.url === url || m.url === `${url}/`);
    return { url, status: response.status, location: response.location, canonical: model?.canonical ?? null };
  })) : null;
  const licence = { footer: /licen[cs]e|©|CC BY|MIT/i.test(homeModel.footerText) ? homeModel.footerText.match(/[^.]*(?:licen[cs]e|©|CC BY|MIT)[^.]*/i)?.[0].trim() : null, file: !!args.project && ["LICENSE", "LICENSE.md", "LICENCE", "LICENSE.txt"].some((f) => existsSync(path.join(args.project, f))) };

  let lighthouseRuns = null;
  if (args.lighthouse && production) {
    say("Lighthouse, if the site has it…");
    lighthouseRuns = await lighthouseFor(args.project, templatePages(pages, LIGHTHOUSE_PAGES));
  }

  const ctx = {
    target: origin, local, dev, icon, pages: models, home: homeModel, linkStatuses, files, nonsense: { status: nonsense.status, html: nonsense.text, path: nonsensePath },
    probes, headers: home.headers, metaCsp: (/<meta[^>]+http-equiv=["']content-security-policy["'][^>]+content=["']([^"']+)/i.exec(home.text) ?? [])[1] ?? null,
    setCookies: home.setCookies, tls: tlsResult, http: httpResult, hostAlt: altResult, cacheBust, caching, dns: dnsResult,
    axe, lighthouse: lighthouseRuns, bundles, transferredBytes, cookiesBeforeConsent, noJs, darkMode, ogImageStatus, sitemap: sitemapEntries, licence,
    thirdParty: { origins: [...thirdPartyOrigins], policy: homeModel.privacyLink }, analytics: [...analytics],
  };
  homeModel.overflow = overflow;
  homeModel.animatesUnderReducedMotion = animatesUnderReducedMotion;

  const results = {}, gathered = {}, outstanding = {};
  for (const check of checks) {
    if (check.verify === "human") continue;
    const rule = RULES[check.id];
    if (!rule) { outstanding[check.id] = "no automated recipe here; settle it in the checklist"; continue; }
    const verdict = rule(ctx);
    if (verdict === null) {
      outstanding[check.id] = whyNot(check.id, { local, dev, axe, lighthouseRuns, fromSitemap: found.fromSitemap });
    } else if (verdict.status === null) {
      gathered[check.id] = verdict.evidence;
    } else {
      results[check.id] = settle(checks, check.id, verdict);
    }
  }

  const seconds = (Date.now() - started) / 1000;
  const out = blob(origin, results);
  const link = encodeLink(out);
  await mkdir(args.out, { recursive: true });
  const slug = host.replace(/[^a-z0-9.-]/gi, "") || "site";
  const jsonPath = path.join(args.out, `preflight-${slug}.json`);
  const reportPath = path.join(args.out, "report.txt");
  const kind = !local ? "production" : dev ? "a dev server" : "a local build";
  const report = renderReport({ checks, target: origin, kind, results, gathered, outstanding, seconds });
  await writeFile(jsonPath, JSON.stringify(out, null, 1));
  await writeFile(reportPath, report + (link ? `\nShare link:\n${link}\n` : `\nThe run is too large for a share link; load ${jsonPath} in the checklist instead.\n`));
  return { report, jsonPath, reportPath, link, results, gathered, outstanding, seconds, kind };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(process.argv.slice(2)).then(
    ({ report, jsonPath, reportPath, link }) => {
      console.log(report);
      console.log(`Results JSON: ${jsonPath}`);
      console.log(`Report: ${reportPath}`);
      console.log(link ? `Share link: ${link}` : "The run is too large for a share link; load the JSON in the checklist instead.");
    },
    (error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    },
  );
}
