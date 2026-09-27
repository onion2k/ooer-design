// Tests for the preflight skill's pure parts: finding pages, deciding each
// check from what was observed, and handing results back in the shape the
// Preflight Checklist imports.
//
// The rules the checklist enforces in its own tool layer are enforced here
// too, because a result that breaks them is silently ignored or wrong on
// import: a human check is never recorded, evidence is what was observed
// and at least eight characters, and a fail is a fail. The browser-driven
// parts are checked by running the skill against a real site.
//
// Run with: node --test 'tests/**/*.test.mjs'

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";

import { internalLinks, externalLinks, isDevServer, isLocalTarget, sitemapUrls, templatePages } from "../skills/preflight/discover.mjs";
import { BUILD_ONLY, RULES, PRODUCTION_ONLY } from "../skills/preflight/rules.mjs";
import { blob, decodeLink, encodeLink, loadChecks, renderReport, settle } from "../skills/preflight/results.mjs";

const CHECKS = loadChecks(JSON.parse(readFileSync(new URL("../skills/preflight/checks.json", import.meta.url), "utf8")));

function page(overrides = {}) {
  return {
    url: "https://example.org/",
    status: 200,
    html: "<html lang=\"en\"><body><main><h1>Hi</h1></main></body></html>",
    title: "Example",
    description: "An example page for the tests.",
    lang: "en",
    canonical: "https://example.org/",
    robotsMeta: null,
    xRobotsTag: null,
    headings: [{ level: 1, text: "Hi" }, { level: 2, text: "Next" }],
    landmarks: { nav: true, main: true, footer: true },
    skipLink: true,
    images: [],
    iconOnlyControls: [],
    unlabelledControls: [],
    og: { title: "Example", description: "An example.", image: "https://example.org/og.png" },
    jsonLd: [],
    scripts: [],
    frames: [],
    fonts: { requested: 0, preloaded: 0 },
    hasPrintStyles: true,
    feedLinks: [],
    autoplayWithSound: 0,
    comments: 0,
    sourceMaps: 0,
    hreflang: [],
    contacts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Discovery

test("sitemap urls are read, and a sitemap index is told apart", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://a.org/</loc></url><url><loc> https://a.org/b </loc></url></urlset>`;
  assert.deepEqual(sitemapUrls(xml), { pages: ["https://a.org/", "https://a.org/b"], sitemaps: [] });
  const index = `<sitemapindex><sitemap><loc>https://a.org/s1.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(sitemapUrls(index), { pages: [], sitemaps: ["https://a.org/s1.xml"] });
});

test("internal links are absolute, on the same origin, without hashes, and unique", () => {
  const html = `<a href="/about">a</a><a href="about#team">b</a><a href="https://example.org/blog/">c</a>
    <a href="https://other.org/">d</a><a href="mailto:x@y.z">e</a><a href="tel:1">f</a><a href="javascript:void(0)">g</a><a href="#">h</a>`;
  assert.deepEqual(internalLinks(html, "https://example.org/"), ["https://example.org/about", "https://example.org/blog/"]);
  assert.deepEqual(externalLinks(html, "https://example.org/"), ["https://other.org/"]);
});

test("template pages are the root and one per first path segment", () => {
  const urls = ["https://a.org/", "https://a.org/blog/1", "https://a.org/blog/2", "https://a.org/about", "https://a.org/docs/x"];
  assert.deepEqual(templatePages(urls, 3), ["https://a.org/", "https://a.org/blog/1", "https://a.org/about"]);
});

test("local targets are recognised", () => {
  for (const url of ["http://localhost:4321", "http://127.0.0.1:3000/", "http://[::1]:8080", "http://app.localhost", "https://site.test"]) {
    assert.equal(isLocalTarget(url), true, url);
  }
  assert.equal(isLocalTarget("https://panicandwonder.com"), false);
});

// ---------------------------------------------------------------------------
// Results and the rules the checklist enforces

test("the check list is flat, with section and blocker on each item", () => {
  const csp = CHECKS.find((c) => c.id === "security.csp");
  assert.equal(csp.section, "security");
  assert.equal(csp.verify, "agent");
  assert.equal(csp.blocker, true);
  assert.equal(CHECKS.length, 73);
});

test("a human check is never recorded", () => {
  assert.throws(() => settle(CHECKS, "a11y.keyboard", { status: "pass", evidence: "tabbed through every page" }), /needs a person/);
});

test("evidence is required and must be observed, not a restatement", () => {
  assert.throws(() => settle(CHECKS, "security.hsts", { status: "pass", evidence: "ok" }), /evidence/i);
  assert.throws(() => settle(CHECKS, "security.hsts", { status: "maybe", evidence: "strict-transport-security: max-age=1" }), /status/i);
  assert.throws(() => settle(CHECKS, "no.such-check", { status: "pass", evidence: "anything at all" }), /no check/i);
});

test("a settled record carries the agent's name and a timestamp, and a fail stays a fail", () => {
  const record = settle(CHECKS, "security.hsts", { status: "fail", evidence: "no strict-transport-security header", note: "add it at the edge" });
  assert.equal(record.by, "agent");
  assert.equal(record.status, "fail");
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(record.note, "add it at the edge");
});

test("the blob is the shape the checklist imports", () => {
  const results = { "security.hsts": settle(CHECKS, "security.hsts", { status: "pass", evidence: "strict-transport-security: max-age=31536000" }) };
  const out = blob("https://example.org", results);
  assert.equal(out.preflight, 1);
  assert.equal(out.target, "https://example.org");
  assert.match(out.savedAt, /^\d{4}-/);
  assert.deepEqual(Object.keys(out.results), ["security.hsts"]);
});

test("the share link is gzipped, base64url, prefixed z, and round-trips", () => {
  const out = blob("https://example.org", { "security.hsts": settle(CHECKS, "security.hsts", { status: "pass", evidence: "strict-transport-security: max-age=31536000" }) });
  const link = encodeLink(out);
  assert.match(link, /^https:\/\/onion2k\.github\.io\/preflight\/#results=z[A-Za-z0-9_-]+$/);
  const encoded = link.split("#results=z")[1];
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(padded, "base64")).toString()), out);
  assert.deepEqual(decodeLink(link), out);
});

test("a run too big for a link gives no link", () => {
  const results = {};
  for (let i = 0; i < 400; i++) {
    results[`x${i}`] = { status: "fail", by: "agent", evidence: randomBytes(200).toString("hex"), at: "2026-01-01T00:00:00Z" };
  }
  assert.equal(encodeLink(blob("https://example.org", results)), null);
});

// ---------------------------------------------------------------------------
// Rules, each both ways

function ctx(overrides = {}) {
  return { target: "https://example.org", local: false, pages: [page()], home: page(), ...overrides };
}

test("placeholder text in any page's rendered html fails the blocker", () => {
  const dirty = ctx({ pages: [page(), page({ url: "https://example.org/about", html: "<p>Lorem ipsum</p><!-- TODO -->" })] });
  const result = RULES["content.no-placeholder-text"](dirty);
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /about.*lorem/i);
  assert.equal(RULES["content.no-placeholder-text"](ctx()).status, "pass");
});

test("a broken link fails, a slow external link is reported without failing", () => {
  const broken = ctx({ linkStatuses: { "https://example.org/gone": 404, "https://other.org/": 200 } });
  const result = RULES["content.links-resolve"](broken);
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /gone.*404/);
  const slow = ctx({ linkStatuses: { "https://example.org/a": 200, "https://other.org/": "timeout" } });
  assert.equal(RULES["content.links-resolve"](slow).status, "pass");
  assert.match(RULES["content.links-resolve"](slow).evidence, /timeout/);
});

test("heavy, unsized and old-format images fail the image check", () => {
  const bad = ctx({ pages: [page({ images: [{ src: "/hero.jpg", alt: "x", width: null, height: null, bytes: 400000 }] })] });
  const result = RULES["content.images"](bad);
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /hero\.jpg/);
  assert.match(result.evidence, /width/);
  const good = ctx({ pages: [page({ images: [{ src: "/hero.avif", alt: "x", width: 800, height: 600, bytes: 90000 }] })] });
  assert.equal(RULES["content.images"](good).status, "pass");
});

test("lang on html passes the locale check and its absence fails it", () => {
  assert.equal(RULES["content.locale"](ctx()).status, "pass");
  const result = RULES["content.locale"](ctx({ pages: [page({ lang: null })] }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /lang/);
});

test("semantics: one h1, no skipped levels, landmarks and a skip link", () => {
  assert.equal(RULES["a11y.semantics"](ctx()).status, "pass");
  const bad = page({
    headings: [{ level: 1, text: "A" }, { level: 1, text: "B" }, { level: 3, text: "C" }],
    landmarks: { nav: true, main: false, footer: true },
    skipLink: false,
  });
  const result = RULES["a11y.semantics"](ctx({ pages: [bad] }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /2 h1/);
  assert.match(result.evidence, /h1 to h3|skipped/);
  assert.match(result.evidence, /main/);
  assert.match(result.evidence, /skip link/);
});

test("images without alt and icon-only controls without a name fail the description check", () => {
  const bad = page({ images: [{ src: "/a.png", alt: null }], iconOnlyControls: [{ tag: "button", html: "<button><svg></svg></button>" }] });
  const result = RULES["a11y.alt-text"](ctx({ pages: [bad] }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /a\.png/);
  assert.match(result.evidence, /button/);
  const decorative = page({ images: [{ src: "/a.png", alt: "" }] });
  assert.equal(RULES["a11y.alt-text"](ctx({ pages: [decorative] })).status, "pass");
});

test("an unlabelled form control fails the forms check; a site with no forms is na", () => {
  const bad = page({ unlabelledControls: [{ tag: "input", name: "email" }], hasForms: true });
  assert.equal(RULES["a11y.forms"](ctx({ pages: [bad] })).status, "fail");
  assert.equal(RULES["a11y.forms"](ctx({ pages: [page({ hasForms: false })] })).status, "na");
  assert.equal(RULES["a11y.forms"](ctx({ pages: [page({ hasForms: true })] })).status, "pass");
});

test("overflow at 320px, animation under reduced motion, or autoplay with sound fail zoom-reflow", () => {
  const home = page({ overflow: { 320: true, zoom200: false }, animatesUnderReducedMotion: 0 });
  assert.equal(RULES["a11y.zoom-reflow"](ctx({ home })).status, "fail");
  const noisy = page({ overflow: { 320: false, zoom200: false }, animatesUnderReducedMotion: 3 });
  assert.match(RULES["a11y.zoom-reflow"](ctx({ home: noisy })).evidence, /3 elements still animate /);
  const fine = page({ overflow: { 320: false, zoom200: false }, animatesUnderReducedMotion: 0 });
  assert.equal(RULES["a11y.zoom-reflow"](ctx({ home: fine })).status, "pass");
});

test("axe violations decide the automated scan and contrast; no axe leaves them outstanding", () => {
  const violations = [{ id: "button-name", impact: "critical", nodes: 2 }, { id: "color-contrast", impact: "serious", nodes: 5 }];
  const scanned = ctx({ axe: { light: violations, dark: [] } });
  assert.equal(RULES["a11y.automated-scan"](scanned).status, "fail");
  assert.match(RULES["a11y.automated-scan"](scanned).evidence, /button-name/);
  assert.equal(RULES["a11y.contrast"](scanned).status, "fail");
  assert.match(RULES["a11y.contrast"](scanned).evidence, /5 nodes in light/);
  assert.equal(RULES["a11y.automated-scan"](ctx({ axe: { light: [], dark: [] } })).status, "pass");
  assert.equal(RULES["a11y.automated-scan"](ctx({ axe: null })), null);
});

test("production-only checks are left outstanding on a local target", () => {
  const local = ctx({ local: true, headers: {} });
  for (const id of PRODUCTION_ONLY) {
    assert.equal(RULES[id](local), null, id);
  }
  assert.ok(PRODUCTION_ONLY.includes("security.csp"));
  assert.ok(PRODUCTION_ONLY.includes("security.tls"));
  assert.ok(PRODUCTION_ONLY.includes("errors.status-codes"));
  assert.ok(!PRODUCTION_ONLY.includes("files.files-present"));
});

test("a dev server is told from a build by its fingerprints", () => {
  assert.equal(isDevServer('<script type="module" src="/@vite/client"></script>', []), true);
  assert.equal(isDevServer("<html></html>", ["http://localhost:4321/@id/astro:scripts/page.js"]), true);
  assert.equal(isDevServer("<html></html>", ["http://localhost:3000/_next/static/development/_buildManifest.js"]), true);
  assert.equal(isDevServer("<astro-dev-toolbar></astro-dev-toolbar>", []), true);
  assert.equal(isDevServer('<script src="/_astro/index.a1b2c3d4.js"></script>', ["http://localhost:4321/_astro/index.a1b2c3d4.js"]), false);
});

test("what only the build can answer is left outstanding on a dev server", () => {
  const dev = ctx({ local: true, dev: true, transferredBytes: 3472000, home: page({ scripts: [], fonts: { requested: 4, preloaded: 0 } }), sitemap: [] });
  for (const id of BUILD_ONLY) assert.equal(RULES[id](dev), null, id);
  assert.ok(BUILD_ONLY.includes("perf.page-weight"));
  const build = ctx({ local: true, dev: false, transferredBytes: 420000 });
  assert.equal(RULES["perf.page-weight"](build).status, "pass");
});

test("a dev server is not failed for the sitemap its build would write", () => {
  const files = {
    "/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nAllow: /\n" },
    "/sitemap.xml": { status: 404 }, "/favicon.ico": { status: 200, contentType: "image/x-icon", body: "" },
    "/llms.txt": { status: 404 }, "/.well-known/security.txt": { status: 404 },
  };
  const onDev = RULES["files.files-present"](ctx({ local: true, dev: true, files }));
  assert.equal(onDev.status, "pass");
  assert.match(onDev.evidence, /sitemap\.xml: 404 on a dev server/);
  assert.equal(RULES["files.files-present"](ctx({ files })).status, "fail");
});

test("a favicon linked from the head counts when /favicon.ico is missing", () => {
  const files = {
    "/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nAllow: /\n" },
    "/sitemap.xml": { status: 200, contentType: "application/xml", body: "<urlset/>" }, "/favicon.ico": { status: 404 },
    "/llms.txt": { status: 404 }, "/.well-known/security.txt": { status: 404 },
  };
  const linked = RULES["files.files-present"](ctx({ files, icon: { href: "/favicon.svg", status: 200 } }));
  assert.equal(linked.status, "pass");
  assert.match(linked.evidence, /favicon\.svg/);
  assert.equal(RULES["files.files-present"](ctx({ files, icon: { href: "/favicon.svg", status: 404 } })).status, "fail");
  assert.equal(RULES["files.files-present"](ctx({ files })).status, "fail");
});

test("source maps are not counted against a dev server", () => {
  const onDev = RULES["content.nothing-private"](ctx({ dev: true, pages: [page({ sourceMaps: 25, comments: 0 })] }));
  assert.doesNotMatch(onDev.evidence, /25 source map/);
  assert.match(onDev.evidence, /dev server/);
  const built = RULES["content.nothing-private"](ctx({ pages: [page({ sourceMaps: 2, comments: 1 })] }));
  assert.match(built.evidence, /2 source map references, 1 HTML comment\b/);
});

test("axe nodes are counted once, not once per colour scheme", () => {
  const v = [{ id: "button-name", impact: "critical", nodes: 2 }];
  const result = RULES["a11y.automated-scan"](ctx({ axe: { light: v, dark: v, pages: 1 } }));
  assert.match(result.evidence, /button-name \(2 nodes\)/);
});

test("evidence is singular for one and plural for many", () => {
  assert.match(RULES["content.locale"](ctx()).evidence, /on 1 page$/);
  const one = page({ overflow: { 320: false, zoom200: false }, animatesUnderReducedMotion: 1 });
  assert.match(RULES["a11y.zoom-reflow"](ctx({ home: one })).evidence, /1 element still animates/);
  const scanned = ctx({ axe: { light: [{ id: "color-contrast", impact: "serious", nodes: 1 }], dark: [] } });
  assert.match(RULES["a11y.contrast"](scanned).evidence, /1 node in light/);
});

test("entities in a task name are decoded for the report", () => {
  const lighthouse = CHECKS.find((c) => c.id === "perf.lighthouse");
  assert.match(lighthouse.task, /Lighthouse ≥ 90/);
});

test("gathered evidence stays on one line", () => {
  const result = RULES["legal.licence"](ctx({ licence: { footer: "Product\n  Company\n\n  © 2024 Your Company", file: false } }));
  assert.doesNotMatch(result.evidence, /\n/);
});

test("csp: missing fails, meta-only fails and says so, unsafe-inline fails, a full policy passes", () => {
  assert.match(RULES["security.csp"](ctx({ headers: {}, metaCsp: null })).evidence, /no content-security-policy header/);
  const meta = RULES["security.csp"](ctx({ headers: {}, metaCsp: "default-src 'self'" }));
  assert.equal(meta.status, "fail");
  assert.match(meta.evidence, /meta/);
  const inline = RULES["security.csp"](ctx({ headers: { "content-security-policy": "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; report-to csp" } }));
  assert.equal(inline.status, "fail");
  assert.match(inline.evidence, /unsafe-inline/);
  const good = RULES["security.csp"](ctx({ headers: { "content-security-policy": "script-src 'self' 'nonce-abc'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; report-to csp" } }));
  assert.equal(good.status, "pass");
});

test("hsts needs a year", () => {
  assert.equal(RULES["security.hsts"](ctx({ headers: { "strict-transport-security": "max-age=31536000; includeSubDomains" } })).status, "pass");
  assert.equal(RULES["security.hsts"](ctx({ headers: { "strict-transport-security": "max-age=300" } })).status, "fail");
  assert.equal(RULES["security.hsts"](ctx({ headers: {} })).status, "fail");
});

test("the header set names what is missing", () => {
  const result = RULES["security.header-set"](ctx({ headers: { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" } }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /permissions-policy/);
  assert.match(result.evidence, /cross-origin-opener-policy/);
});

test("a server banner with a version fails; a bare product name passes", () => {
  assert.equal(RULES["security.server-banner"](ctx({ headers: { server: "nginx/1.25.3" } })).status, "fail");
  assert.equal(RULES["security.server-banner"](ctx({ headers: { "x-powered-by": "Express" } })).status, "fail");
  assert.equal(RULES["security.server-banner"](ctx({ headers: { server: "cloudflare" } })).status, "pass");
});

test("cookies: none set is na, an insecure one fails", () => {
  assert.equal(RULES["security.cookies"](ctx({ setCookies: [] })).status, "na");
  const result = RULES["security.cookies"](ctx({ setCookies: ["session=abc; Path=/"] }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /session.*Secure/);
  assert.equal(RULES["security.cookies"](ctx({ setCookies: ["s=1; Secure; HttpOnly; SameSite=Lax"] })).status, "pass");
});

test("tls: redirect, a valid chain and TLS 1.2 or later pass", () => {
  const good = ctx({ tls: { protocol: "TLSv1.3", validTo: new Date(Date.now() + 60 * 86400000).toISOString(), authorized: true }, http: { status: 301, location: "https://example.org/" } });
  assert.equal(RULES["security.tls"](good).status, "pass");
  const soon = ctx({ tls: { protocol: "TLSv1.2", validTo: new Date(Date.now() + 5 * 86400000).toISOString(), authorized: true }, http: { status: 301, location: "https://example.org/" } });
  assert.match(RULES["security.tls"](soon).evidence, /expires in 5 days/);
  const noRedirect = ctx({ tls: { protocol: "TLSv1.3", validTo: new Date(Date.now() + 60 * 86400000).toISOString(), authorized: true }, http: { status: 200, location: null } });
  assert.equal(RULES["security.tls"](noRedirect).status, "fail");
});

test("key-shaped strings in a bundle fail the secrets check", () => {
  // Assembled here so that no key-shaped literal sits in the repository for
  // a secret scanner to find. It is the alphabet, not a key.
  const shaped = ["sk", "live", "51H8abcdefghijklmnopqrstuvwxyz"].join("_");
  const leaky = ctx({ bundles: [{ url: "/app.js", text: `const k = "${shaped}";` }] });
  const result = RULES["security.secrets"](leaky);
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /app\.js.*sk_live_/);
  assert.equal(RULES["security.secrets"](ctx({ bundles: [{ url: "/app.js", text: "const x = 1;" }] })).status, "pass");
});

test("files: a staging robots disallow fails the blocker, the optional files are only noted", () => {
  const staging = ctx({ files: {
    "/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /\n" },
    "/sitemap.xml": { status: 200, contentType: "application/xml", body: "<urlset/>" },
    "/favicon.ico": { status: 200, contentType: "image/x-icon", body: "" },
    "/llms.txt": { status: 404 }, "/.well-known/security.txt": { status: 404 },
  } });
  const result = RULES["files.files-present"](staging);
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /Disallow: \//);
  const fine = ctx({ files: {
    "/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nAllow: /\nSitemap: https://example.org/sitemap.xml\n" },
    "/sitemap.xml": { status: 200, contentType: "application/xml", body: "<urlset/>" },
    "/favicon.ico": { status: 200, contentType: "image/x-icon", body: "" },
    "/llms.txt": { status: 404 }, "/.well-known/security.txt": { status: 404 },
  } });
  assert.equal(RULES["files.files-present"](fine).status, "pass");
  assert.match(RULES["files.files-present"](fine).evidence, /llms\.txt: 404/);
});

test("a sitemap url that redirects or disagrees with its canonical fails", () => {
  const bad = ctx({ sitemap: [{ url: "https://example.org/a", status: 301, location: "https://example.org/a/", canonical: null }] });
  assert.equal(RULES["files.sitemap-urls"](bad).status, "fail");
  const good = ctx({ sitemap: [{ url: "https://example.org/a/", status: 200, location: null, canonical: "https://example.org/a/" }] });
  assert.equal(RULES["files.sitemap-urls"](good).status, "pass");
  assert.equal(RULES["files.sitemap-urls"](ctx({ sitemap: null })), null);
});

test("noindex on any page fails", () => {
  assert.equal(RULES["files.no-accidental-noindex"](ctx()).status, "pass");
  const result = RULES["files.no-accidental-noindex"](ctx({ pages: [page({ url: "https://example.org/x", xRobotsTag: "noindex" })] }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /\/x.*x-robots-tag/i);
});

test("a nonsense url must be a 404", () => {
  assert.equal(RULES["errors.status-codes"](ctx({ nonsense: { status: 404, html: "" } })).status, "pass");
  const result = RULES["errors.status-codes"](ctx({ nonsense: { status: 200, html: "<h1>Not found</h1>" } }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /200/);
});

test("titles and descriptions: duplicates, missing and over-length are named", () => {
  const pages = [page({ url: "https://example.org/", title: "Same" }), page({ url: "https://example.org/b", title: "Same", description: null })];
  const result = RULES["seo.titles-descriptions"](ctx({ pages }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /duplicate title/);
  assert.match(result.evidence, /\/b.*no description/);
  assert.equal(RULES["seo.titles-descriptions"](ctx()).status, "pass");
});

test("canonicals must be absolute and self-referential", () => {
  assert.equal(RULES["seo.canonicals"](ctx()).status, "pass");
  const relative = RULES["seo.canonicals"](ctx({ pages: [page({ canonical: "/" })] }));
  assert.equal(relative.status, "fail");
  const elsewhere = RULES["seo.canonicals"](ctx({ pages: [page({ url: "https://example.org/a", canonical: "https://example.org/b" })] }));
  assert.match(elsewhere.evidence, /\/a.*\/b/);
});

test("social cards need a title, a description and an absolute image that loads", () => {
  assert.equal(RULES["seo.social-cards"](ctx({ ogImageStatus: 200 })).status, "pass");
  const missing = RULES["seo.social-cards"](ctx({ home: page({ og: { title: "T", description: null, image: null } }) }));
  assert.equal(missing.status, "fail");
  assert.match(missing.evidence, /og:image/);
  const broken = RULES["seo.social-cards"](ctx({ ogImageStatus: 404 }));
  assert.match(broken.evidence, /og\.png.*404/);
});

test("structured data: none is na, broken json fails, typed json-ld passes", () => {
  assert.equal(RULES["seo.structured-data"](ctx()).status, "na");
  assert.equal(RULES["seo.structured-data"](ctx({ pages: [page({ jsonLd: ["{ not json"] })] })).status, "fail");
  const typed = RULES["seo.structured-data"](ctx({ pages: [page({ jsonLd: ['{"@context":"https://schema.org","@type":"Article"}'] })] }));
  assert.equal(typed.status, "pass");
  assert.match(typed.evidence, /Article/);
});

test("viewports: overflow at any width fails and names it", () => {
  const result = RULES["qa.viewports"](ctx({ home: page({ overflow: { 320: false, 768: true, 1280: false, 2560: false } }) }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /768/);
  assert.equal(RULES["qa.viewports"](ctx({ home: page({ overflow: { 320: false, 768: false, 1280: false, 2560: false } }) })).status, "pass");
});

test("no-js: the main content and navigation must survive", () => {
  assert.equal(RULES["qa.no-js"](ctx({ noJs: { mainText: 800, hasNav: true } })).status, "pass");
  const result = RULES["qa.no-js"](ctx({ noJs: { mainText: 12, hasNav: false } }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /12 characters/);
});

test("print styles are found or not", () => {
  assert.equal(RULES["qa.print"](ctx()).status, "pass");
  assert.equal(RULES["qa.print"](ctx({ home: page({ hasPrintStyles: false }) })).status, "fail");
});

test("page weight is measured against a stated threshold", () => {
  const light = RULES["perf.page-weight"](ctx({ transferredBytes: 420000 }));
  assert.equal(light.status, "pass");
  assert.match(light.evidence, /420 kB/);
  assert.equal(RULES["perf.page-weight"](ctx({ transferredBytes: 2600000 })).status, "fail");
});

test("render-blocking scripts and unpreloaded fonts are reported", () => {
  const home = page({ scripts: [{ src: "https://cdn.x.com/a.js", async: false, defer: false, inHead: true, integrity: null }], fonts: { requested: 2, preloaded: 0 } });
  const result = RULES["perf.request-chain"](ctx({ home }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /cdn\.x\.com/);
  assert.match(result.evidence, /2 fonts requested, 0 preloaded/);
  const preloaded = page({ scripts: [], fonts: { requested: 2, preloaded: 2 } });
  assert.equal(RULES["perf.request-chain"](ctx({ home: preloaded })).status, "pass");
});

test("lighthouse scores decide the lighthouse and vitals checks when a run exists", () => {
  const runs = [{ url: "https://example.org/", performance: 95, accessibility: 100, bestPractices: 92, seo: 100, lcp: 1800, cls: 0.02, inp: null }];
  assert.equal(RULES["perf.lighthouse"](ctx({ lighthouse: runs })).status, "pass");
  assert.equal(RULES["perf.core-web-vitals"](ctx({ lighthouse: runs })).status, "pass");
  const slow = [{ url: "https://example.org/", performance: 61, accessibility: 100, bestPractices: 92, seo: 100, lcp: 4100, cls: 0.2, inp: null }];
  assert.match(RULES["perf.lighthouse"](ctx({ lighthouse: slow })).evidence, /performance 61/);
  assert.equal(RULES["perf.core-web-vitals"](ctx({ lighthouse: slow })).status, "fail");
  assert.equal(RULES["perf.lighthouse"](ctx({ lighthouse: null })), null);
});

test("cookies before consent fail the consent check; none is a pass that says no banner is needed", () => {
  const result = RULES["legal.cookie-consent"](ctx({ cookiesBeforeConsent: [{ name: "_ga", domain: ".example.org" }] }));
  assert.equal(result.status, "fail");
  assert.match(result.evidence, /_ga/);
  const none = RULES["legal.cookie-consent"](ctx({ cookiesBeforeConsent: [] }));
  assert.equal(none.status, "pass");
  assert.match(none.evidence, /no cookies/i);
});

test("shared checks that only gather evidence are not recorded but their evidence is kept", () => {
  const result = RULES["content.contact-details"](ctx({ pages: [page({ contacts: ["mailto:hi@example.org", "tel:+441234"] })] }));
  assert.equal(result.status, null);
  assert.match(result.evidence, /hi@example\.org/);
});

test("email auth is production only and reads the records", () => {
  assert.equal(RULES["infra.email-auth"](ctx({ local: true })), null);
  const good = RULES["infra.email-auth"](ctx({ dns: { spf: "v=spf1 include:_spf.google.com ~all", dmarc: "v=DMARC1; p=reject", mx: ["aspmx.l.google.com"] } }));
  assert.equal(good.status, "pass");
  const none = RULES["infra.email-auth"](ctx({ dns: { spf: null, dmarc: null, mx: [] } }));
  assert.equal(none.status, "na");
  const half = RULES["infra.email-auth"](ctx({ dns: { spf: "v=spf1 -all", dmarc: null, mx: ["mx.example.org"] } }));
  assert.equal(half.status, "fail");
  assert.match(half.evidence, /no DMARC/i);
});

// ---------------------------------------------------------------------------
// The report

test("the report leads with failures, then what needs a decision, then what needs a person", () => {
  const results = {
    "security.hsts": settle(CHECKS, "security.hsts", { status: "fail", evidence: "no strict-transport-security header", note: "Add it at the edge." }),
    "content.locale": settle(CHECKS, "content.locale", { status: "pass", evidence: "<html lang=\"en\"> on 12 pages" }),
    "security.cookies": settle(CHECKS, "security.cookies", { status: "na", evidence: "no Set-Cookie on any response" }),
  };
  const gathered = { "content.contact-details": "mailto:hi@example.org" };
  const outstanding = { "a11y.automated-scan": "the site has no @axe-core/playwright; install it and run again" };
  const text = renderReport({ checks: CHECKS, target: "https://example.org", results, gathered, outstanding, seconds: 42 });
  const failed = text.indexOf("Failed (1)");
  const decide = text.indexOf("For you to decide");
  const person = text.indexOf("Needs a person");
  assert.ok(failed > -1 && failed < decide && decide < person);
  assert.match(text, /HSTS with a long max-age[\s\S]*no strict-transport-security header[\s\S]*Add it at the edge/);
  assert.match(text, /Could not check \(1\)[\s\S]*axe-core/);
  assert.match(text, /Whole site operable by keyboard alone/);
  assert.match(text, /42 seconds/);
  assert.doesNotMatch(text, /<code>/);
});

test("site text in evidence is shown as text, not markup", () => {
  const results = { "content.no-placeholder-text": settle(CHECKS, "content.no-placeholder-text", { status: "fail", evidence: "<script>alert(1)</script> found on /" }) };
  const text = renderReport({ checks: CHECKS, target: "https://example.org", results, gathered: {}, outstanding: {}, seconds: 1 });
  assert.match(text, /<script>alert\(1\)<\/script> found on \//);
});

// ---------------------------------------------------------------------------
// The orchestrator's arguments

test("the target, the out folder and the project are read", async () => {
  const { parseArgs } = await import("../skills/preflight/preflight.mjs");
  const args = parseArgs(["https://example.org", "--out", "run", "--project", "../site", "--max-pages", "10", "--no-lighthouse"]);
  assert.equal(args.url, "https://example.org/");
  assert.equal(args.out, "run");
  assert.equal(args.project, "../site");
  assert.equal(args.maxPages, 10);
  assert.equal(args.lighthouse, false);
});

test("a target that is not http or https is refused, as the checklist refuses it", async () => {
  const { parseArgs } = await import("../skills/preflight/preflight.mjs");
  assert.throws(() => parseArgs(["ftp://example.org", "--out", "run"]), /Only http and https/);
  assert.throws(() => parseArgs(["example", "--out", "run"]), /Not a URL/);
  assert.throws(() => parseArgs(["https://example.org"]), /--out is required/);
  assert.throws(() => parseArgs(["--out", "run"]), /usage/);
  assert.throws(() => parseArgs(["https://example.org", "--out", "run", "--max-pages", "0"]), /whole number/);
  assert.throws(() => parseArgs(["https://example.org", "--out", "run", "--fast"]), /unknown option --fast/);
});

test("every rule belongs to a check an agent may settle", () => {
  for (const id of Object.keys(RULES)) {
    const check = CHECKS.find((c) => c.id === id);
    assert.ok(check, `${id} is not in checks.json`);
    assert.notEqual(check.verify, "human", `${id} is a human check`);
  }
});

test("every production-only id is a rule", () => {
  for (const id of PRODUCTION_ONLY) assert.ok(RULES[id], id);
});

// ---------------------------------------------------------------------------
// Sharper cases, each added because a bug put back on purpose got past the
// tests above.

test("markup in a task or a note is stripped when the checks are loaded", () => {
  const checks = loadChecks({ sections: [{ id: "x", title: "X", items: [{ id: "x.y", task: "No <code>noindex</code> left", note: "Check <code>robots</code>", verify: "agent" }] }] });
  assert.equal(checks[0].task, "No noindex left");
  assert.equal(checks[0].note, "Check robots");
});

test("each placeholder word in the recipe is found, and a class name is not", () => {
  for (const [word, html] of [["TODO", "<!-- TODO -->"], ["FIXME", "<p>FIXME</p>"], ["example.com", '<a href="https://example.com">x</a>'], ["Coming soon", "<h2>Coming Soon</h2>"], ["@test", "<p>user@test</p>"]]) {
    const result = RULES["content.no-placeholder-text"](ctx({ pages: [page({ html })] }));
    assert.equal(result.status, "fail", word);
    assert.match(result.evidence, new RegExp(word.replace(".", "\\."), "i"), word);
  }
  assert.equal(RULES["content.no-placeholder-text"](ctx({ pages: [page({ html: '<ul class="todo-list"><li>Buy milk</li></ul>' })] })).status, "pass");
});

test("an image fails for weight alone, for format alone, and for size alone", () => {
  const heavy = RULES["content.images"](ctx({ pages: [page({ images: [{ src: "/a.avif", alt: "x", width: 10, height: 10, bytes: 400000 }] })] }));
  assert.equal(heavy.status, "fail");
  assert.match(heavy.evidence, /400 kB/);
  const old = RULES["content.images"](ctx({ pages: [page({ images: [{ src: "/a.png", alt: "x", width: 10, height: 10, bytes: 1000 }] })] }));
  assert.equal(old.status, "fail");
  assert.match(old.evidence, /png/);
  const unsized = RULES["content.images"](ctx({ pages: [page({ images: [{ src: "/a.webp", alt: "x", width: null, height: null, bytes: 1000 }] })] }));
  assert.equal(unsized.status, "fail");
  assert.match(unsized.evidence, /no width\/height/);
});

test("moderate and minor axe issues do not fail the scan", () => {
  const mild = [{ id: "region", impact: "moderate", nodes: 4 }, { id: "meta-viewport", impact: "minor", nodes: 1 }];
  assert.equal(RULES["a11y.automated-scan"](ctx({ axe: { light: mild, dark: mild, pages: 1 } })).status, "pass");
});

test("a relative canonical is called relative", () => {
  const result = RULES["seo.canonicals"](ctx({ pages: [page({ canonical: "/" })] }));
  assert.match(result.evidence, /relative/);
});

test("each vital fails on its own", () => {
  const base = { url: "https://example.org/", performance: 95, accessibility: 95, bestPractices: 95, seo: 95, lcp: 1800, cls: 0.02, inp: 100 };
  assert.equal(RULES["perf.core-web-vitals"](ctx({ lighthouse: [base] })).status, "pass");
  for (const [slow, evidence] of [[{ lcp: 3000 }, /LCP 3000ms/], [{ cls: 0.3 }, /CLS 0\.3/], [{ inp: 350 }, /INP 350ms/]]) {
    const result = RULES["perf.core-web-vitals"](ctx({ lighthouse: [{ ...base, ...slow }] }));
    assert.equal(result.status, "fail", JSON.stringify(slow));
    assert.match(result.evidence, evidence);
  }
});

test("why a check was left outstanding is said in words a person can act on", async () => {
  const { whyNot } = await import("../skills/preflight/preflight.mjs");
  assert.match(whyNot("security.csp", { local: true, dev: true }), /production/);
  assert.match(whyNot("perf.page-weight", { local: true, dev: true }), /dev server.*preview of the build/);
  assert.match(whyNot("files.sitemap-urls", { local: true, dev: false, fromSitemap: false }), /no sitemap\.xml/);
  assert.match(whyNot("a11y.contrast", { local: true, dev: false, axe: null }), /npm i -D @axe-core\/playwright/);
  assert.match(whyNot("perf.lighthouse", { local: false, dev: false, lighthouseRuns: null }), /npm i -D lighthouse/);
  assert.match(whyNot("perf.lighthouse", { local: true, dev: false, lighthouseRuns: null }), /production/);
});
