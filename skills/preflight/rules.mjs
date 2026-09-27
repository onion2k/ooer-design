// One rule per check the Preflight Checklist lets an agent settle.
//
// Each rule takes what the run observed and returns a verdict: a status with
// the evidence that decided it; a status of null with evidence, for a shared
// check whose recipe only gathers what a person then judges; or null itself,
// meaning the check could not be run. The rules are pure so that every one
// can be tested against a small made-up observation, and the evidence is
// always the observed value, never a restatement of the check, because that
// is what the checklist's own tool layer would refuse.

// A check is settled only when the target can answer it. Headers, TLS, DNS
// and what the host does with a missing page are facts about production.
export const PRODUCTION_ONLY = [
  "security.csp", "security.hsts", "security.header-set", "security.tls",
  "security.cookies", "security.server-banner", "perf.caching",
  "errors.status-codes", "errors.styled-error-pages",
  "infra.email-auth", "infra.dns", "day.purge-caches", "day.rerun-checks",
];

// Weight, the request chain and the sitemap are facts about the build, which
// a dev server is not: it serves unbundled modules and generates no files.
export const BUILD_ONLY = ["perf.page-weight", "perf.request-chain", "files.sitemap-urls"];

const KB = 1000;
const HEAVY_IMAGE = 300 * KB;
const HEAVY_PAGE = 1500 * KB;
const YEAR = 31536000;
const OLD_FORMATS = /\.(?:jpe?g|png|gif|bmp)(?:\?|$)/i;
const SECRET_PATTERNS = [
  /sk_live_[0-9A-Za-z]{10,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /ghp_[0-9A-Za-z]{30,}/, /xox[bp]-[0-9A-Za-z-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/,
  /(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{24,}["']/i,
];

function verdict(status, evidence, note) {
  return note ? { status, evidence, note } : { status, evidence };
}

function gathered(evidence) {
  return { status: null, evidence };
}

function path(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function productionOnly(rule) {
  return (ctx) => (ctx.local ? null : rule(ctx));
}

function buildOnly(rule) {
  return (ctx) => (ctx.dev ? null : rule(ctx));
}

function count(n, noun, plural = `${noun}s`) {
  return `${n} ${n === 1 ? noun : plural}`;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function kb(bytes) {
  return `${Math.round(bytes / KB)} kB`;
}

// ---------------------------------------------------------------------------
// Content

const PLACEHOLDERS = [
  ["lorem", /lorem/i], ["TODO", /\bTODO\b/], ["FIXME", /\bFIXME\b/],
  ["example.com", /example\.com/i], ["Coming soon", /coming soon/i], ["@test", /@test\b/i],
];

function noPlaceholderText(ctx) {
  const hits = [];
  for (const page of ctx.pages) {
    const found = PLACEHOLDERS.filter(([, pattern]) => pattern.test(page.html)).map(([word]) => word);
    if (found.length) hits.push(`${path(page.url)}: ${found.join(", ")}`);
  }
  if (hits.length) return verdict("fail", hits.join("; "), "Delete the placeholder, or the section it sits in.");
  return verdict("pass", `${count(ctx.pages.length, "page")} searched for lorem, TODO, FIXME, example.com, "Coming soon" and @test; none found`);
}

function linksResolve(ctx) {
  if (!ctx.linkStatuses) return null;
  const broken = [], slow = [];
  for (const [url, status] of Object.entries(ctx.linkStatuses)) {
    if (typeof status === "number" && status >= 400) broken.push(`${url}: ${status}`);
    else if (typeof status === "string") slow.push(`${url}: ${status}`);
  }
  const total = Object.keys(ctx.linkStatuses).length;
  if (broken.length) return verdict("fail", broken.join("; "), "Fix or remove each link.");
  const tail = slow.length ? `; could not settle ${slow.join(", ")}` : "";
  return verdict("pass", `${count(total, "link")} checked, all resolve${tail}`);
}

function images(ctx) {
  const problems = [];
  let total = 0;
  for (const page of ctx.pages) {
    for (const image of page.images ?? []) {
      total++;
      const why = [];
      if (image.bytes > HEAVY_IMAGE) why.push(kb(image.bytes));
      if (!image.width || !image.height) why.push("no width/height");
      if (OLD_FORMATS.test(image.src)) why.push(image.src.split(".").pop().split("?")[0]);
      if (why.length) problems.push(`${image.src}: ${why.join(", ")}`);
    }
  }
  if (problems.length) return verdict("fail", problems.join("; "), "Compress, size and convert to WebP or AVIF with a fallback.");
  return verdict("pass", total ? `${count(total, "image")}: all under ${kb(HEAVY_IMAGE)}, sized, and WebP, AVIF or SVG` : "no images on the pages checked");
}

function locale(ctx) {
  const missing = ctx.pages.filter((p) => !p.lang).map((p) => path(p.url));
  if (missing.length) return verdict("fail", `no <html lang> on ${missing.join(", ")}`, "Set lang on <html> to the page's language.");
  const langs = [...new Set(ctx.pages.map((p) => p.lang))];
  const hreflang = ctx.pages.some((p) => (p.hreflang ?? []).length);
  return verdict("pass", `<html lang="${langs.join('", "')}">${hreflang ? ", with hreflang," : ""} on ${count(ctx.pages.length, "page")}`);
}

function contactDetails(ctx) {
  const contacts = [...new Set(ctx.pages.flatMap((p) => p.contacts ?? []))];
  return gathered(contacts.length ? contacts.join(", ") : "no mailto:, tel: or social links found");
}

function nothingPrivate(ctx) {
  const maps = ctx.pages.reduce((n, p) => n + (p.sourceMaps ?? 0), 0);
  const comments = ctx.pages.reduce((n, p) => n + (p.comments ?? 0), 0);
  const staging = ctx.pages.flatMap((p) => (p.stagingLinks ?? []));
  const sourceMaps = ctx.dev ? "source maps not counted on a dev server" : count(maps, "source map reference");
  return gathered(`${sourceMaps}, ${count(comments, "HTML comment")}${staging.length ? `, links to ${staging.join(", ")}` : ""}`);
}

// ---------------------------------------------------------------------------
// Accessibility

function serious(violations) {
  return violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

function automatedScan(ctx) {
  if (!ctx.axe) return null;
  // The same node fails in both schemes, so the larger count is the count.
  const found = new Map();
  for (const scheme of ["light", "dark"]) {
    const totals = new Map();
    for (const v of serious(ctx.axe[scheme] ?? [])) totals.set(v.id, (totals.get(v.id) ?? 0) + v.nodes);
    for (const [id, nodes] of totals) found.set(id, Math.max(found.get(id) ?? 0, nodes));
  }
  if (found.size) {
    const list = [...found].map(([id, nodes]) => `${id} (${count(nodes, "node")})`).join(", ");
    return verdict("fail", `axe critical/serious: ${list}`, "Fix each rule's nodes; axe names the element and the fix.");
  }
  return verdict("pass", `axe: no critical or serious issues on ${count(ctx.axe.pages ?? 1, "page")}, light and dark`);
}

function contrast(ctx) {
  if (!ctx.axe) return null;
  const nodesIn = (scheme) => (ctx.axe[scheme] ?? []).filter((v) => v.id === "color-contrast").reduce((n, v) => n + v.nodes, 0);
  const light = nodesIn("light"), dark = nodesIn("dark");
  if (light || dark) return verdict("fail", `color-contrast: ${count(light, "node")} in light, ${dark} in dark`, "Raise the contrast to 4.5:1 for text and 3:1 for UI.");
  return verdict("pass", "axe color-contrast: no failures in light or dark");
}

function semantics(ctx) {
  const problems = [];
  for (const page of ctx.pages) {
    const where = path(page.url);
    const h1 = page.headings.filter((h) => h.level === 1).length;
    if (h1 !== 1) problems.push(`${h1} h1 on ${where}`);
    let previous = 0;
    for (const heading of page.headings) {
      if (previous && heading.level > previous + 1) problems.push(`h${previous} to h${heading.level} skipped on ${where}`);
      previous = heading.level;
    }
    for (const landmark of ["nav", "main", "footer"]) {
      if (!page.landmarks?.[landmark]) problems.push(`no <${landmark}> on ${where}`);
    }
    if (!page.skipLink) problems.push(`no skip link on ${where}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), "One h1, headings in order, real landmarks, and a skip link first in the tab order.");
  return verdict("pass", `${count(ctx.pages.length, "page")}: one h1 each, no skipped levels, nav/main/footer, skip link`);
}

function altText(ctx) {
  const problems = [];
  for (const page of ctx.pages) {
    const where = path(page.url);
    for (const image of page.images ?? []) {
      if (image.alt === null || image.alt === undefined) problems.push(`img ${image.src} has no alt on ${where}`);
    }
    for (const control of page.iconOnlyControls ?? []) problems.push(`<${control.tag}> with no accessible name on ${where}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), 'Describe the content, alt="" for decoration, aria-label on icon-only controls.');
  return verdict("pass", `every image has alt and every icon-only control has a name on ${count(ctx.pages.length, "page")}`);
}

function forms(ctx) {
  if (!ctx.pages.some((p) => p.hasForms)) return verdict("na", `no forms on ${count(ctx.pages.length, "page")}`);
  const problems = [];
  for (const page of ctx.pages) {
    for (const control of page.unlabelledControls ?? []) problems.push(`${control.tag}${control.name ? `[name=${control.name}]` : ""} has no label on ${path(page.url)}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), "A visible <label for> on every control.");
  return verdict("pass", "every form control has an associated label");
}

function zoomReflow(ctx) {
  const home = ctx.home;
  if (!home?.overflow) return null;
  const problems = [];
  if (home.overflow[320]) problems.push("horizontal overflow at 320px");
  if (home.overflow.zoom200) problems.push("horizontal overflow at 200% zoom");
  if (home.animatesUnderReducedMotion) problems.push(`${count(home.animatesUnderReducedMotion, "element still animates", "elements still animate")} with prefers-reduced-motion: reduce`);
  if (home.autoplayWithSound) problems.push(`${home.autoplayWithSound} media autoplay with sound`);
  if (problems.length) return verdict("fail", problems.join("; "), "Reflow at 320px, honour prefers-reduced-motion, mute or remove autoplay.");
  return verdict("pass", "no overflow at 320px or 200% zoom; nothing animates under prefers-reduced-motion; no autoplay with sound");
}

function statement(ctx) {
  const links = ctx.pages.flatMap((p) => (p.links ?? []).filter((l) => /accessibility/i.test(l.text ?? "")).map((l) => l.href));
  return gathered(links.length ? `accessibility link: ${[...new Set(links)].join(", ")}` : "no link whose text mentions accessibility");
}

// ---------------------------------------------------------------------------
// Security (production only)

function directives(policy) {
  const out = {};
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values;
  }
  return out;
}

const csp = productionOnly((ctx) => {
  const header = ctx.headers?.["content-security-policy"];
  if (!header) {
    if (ctx.metaCsp) {
      return verdict("fail", "no content-security-policy header; a policy is only in a <meta> tag, which applies from the parse point and ignores frame-ancestors, sandbox and report-uri", "Send the policy as a response header.");
    }
    return verdict("fail", "no content-security-policy header", "Ship in report-only first, then enforce.");
  }
  const d = directives(header);
  const problems = [];
  const scripts = d["script-src"] ?? d["default-src"] ?? [];
  if (scripts.includes("'unsafe-inline'")) problems.push("'unsafe-inline' in script-src");
  if (!(d["object-src"] ?? []).includes("'none'")) problems.push("no object-src 'none'");
  if (!d["base-uri"]) problems.push("no base-uri");
  if (!d["frame-ancestors"]) problems.push("no frame-ancestors");
  if (!d["report-uri"] && !d["report-to"]) problems.push("no report-uri or report-to");
  if (ctx.metaCsp && ctx.metaCsp !== header) problems.push("a different policy in a <meta> tag");
  if (problems.length) return verdict("fail", `content-security-policy: ${header}; ${problems.join(", ")}`, "Use nonces or hashes, and add the missing directives.");
  return verdict("pass", `content-security-policy: ${header}`);
});

const hsts = productionOnly((ctx) => {
  const header = ctx.headers?.["strict-transport-security"];
  if (!header) return verdict("fail", "no strict-transport-security header", `Add max-age=${YEAR}; includeSubDomains.`);
  const age = Number((/max-age=(\d+)/i.exec(header) ?? [])[1] ?? 0);
  if (age < YEAR) return verdict("fail", `strict-transport-security: ${header} (max-age under a year)`, `Raise max-age to ${YEAR}.`);
  return verdict("pass", `strict-transport-security: ${header}`);
});

const headerSet = productionOnly((ctx) => {
  const wanted = ["x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"];
  const missing = wanted.filter((h) => !ctx.headers?.[h]);
  const present = wanted.filter((h) => ctx.headers?.[h]).map((h) => `${h}: ${ctx.headers[h]}`);
  if (missing.length) return verdict("fail", `missing ${missing.join(", ")}${present.length ? `; present: ${present.join("; ")}` : ""}`, "Set them at the edge.");
  return verdict("pass", present.join("; "));
});

const tls = productionOnly((ctx) => {
  if (!ctx.tls) return null;
  if (ctx.tls.error) return verdict("fail", `TLS: ${ctx.tls.error}`);
  const problems = [];
  const days = Math.floor((new Date(ctx.tls.validTo) - Date.now()) / 86400000);
  if (ctx.tls.authorized === false) problems.push("certificate chain not trusted");
  if (/^TLSv1(?:\.[01])?$/.test(ctx.tls.protocol ?? "")) problems.push(`negotiated ${ctx.tls.protocol}`);
  if (days < 30) problems.push(`certificate expires in ${days} days`);
  const redirected = [301, 302, 307, 308].includes(ctx.http?.status) && /^https:/.test(ctx.http?.location ?? "");
  if (!redirected) problems.push(`http:// does not redirect to https:// (status ${ctx.http?.status ?? "unknown"})`);
  if (problems.length) return verdict("fail", problems.join("; "), "Renew, redirect, and pin a reminder before expiry.");
  return verdict("pass", `${ctx.tls.protocol}, certificate valid for ${days} days, http:// ${ctx.http.status} → https://`);
});

function secrets(ctx) {
  if (!ctx.bundles) return null;
  const hits = [];
  for (const bundle of ctx.bundles) {
    for (const pattern of SECRET_PATTERNS) {
      const match = pattern.exec(bundle.text);
      if (match) hits.push(`${bundle.url}: ${match[0].slice(0, 12)}…`);
    }
  }
  if (hits.length) return verdict("fail", hits.join("; "), "Rotate it now; anything ever committed is public.");
  return verdict("pass", `${count(ctx.bundles.length, "script")} searched for key-shaped strings; none found`);
}

function thirdPartyScripts(ctx) {
  const external = [];
  for (const page of ctx.pages) {
    for (const script of page.scripts ?? []) {
      if (script.external) external.push(`${script.src}${script.integrity ? " (integrity)" : " (no integrity)"}`);
    }
    for (const frame of page.frames ?? []) external.push(`frame ${frame}`);
  }
  const unique = [...new Set(external)];
  return gathered(unique.length ? unique.join("; ") : "no external scripts or frames");
}

const cookies = productionOnly((ctx) => {
  if (!ctx.setCookies) return null;
  if (ctx.setCookies.length === 0) return verdict("na", "no Set-Cookie on any response");
  const problems = [];
  for (const cookie of ctx.setCookies) {
    const name = cookie.split("=")[0].trim();
    const missing = ["Secure", "HttpOnly", "SameSite"].filter((flag) => !new RegExp(`;\\s*${flag}`, "i").test(cookie));
    if (missing.length) problems.push(`${name}: missing ${missing.join(", ")}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), "Set Secure, HttpOnly and SameSite on every cookie.");
  return verdict("pass", `${ctx.setCookies.length} cookies, all Secure, HttpOnly and SameSite`);
});

function adminStaging(ctx) {
  if (!ctx.probes) return null;
  const open = Object.entries(ctx.probes).filter(([, status]) => status === 200).map(([p]) => p);
  return gathered(open.length ? `reachable without auth: ${open.join(", ")}` : `${Object.keys(ctx.probes).length} admin and dotfile paths probed; none reachable`);
}

const serverBanner = productionOnly((ctx) => {
  const server = ctx.headers?.server, powered = ctx.headers?.["x-powered-by"];
  const problems = [];
  if (powered) problems.push(`x-powered-by: ${powered}`);
  if (server && /\d/.test(server)) problems.push(`server: ${server}`);
  if (problems.length) return verdict("fail", problems.join("; "), "Trim the version from Server and drop X-Powered-By.");
  return verdict("pass", `${server ? `server: ${server}` : "no server header"}; no x-powered-by`);
});

// ---------------------------------------------------------------------------
// Files crawlers look for

function filesPresent(ctx) {
  if (!ctx.files) return null;
  const f = ctx.files;
  const problems = [], notes = [];
  const robots = f["/robots.txt"];
  if (!robots || robots.status !== 200) problems.push(`robots.txt: ${robots?.status ?? "no response"}`);
  else if (!/text\/plain/.test(robots.contentType ?? "")) problems.push(`robots.txt served as ${robots.contentType}`);
  else if (/^\s*Disallow:\s*\/\s*$/m.test(robots.body ?? "")) problems.push("robots.txt: Disallow: / (blocks everything)");
  const sitemap = f["/sitemap.xml"];
  if (!sitemap || sitemap.status !== 200) {
    // A sitemap is usually written by the build, so a dev server has none.
    if (ctx.dev) notes.push(`sitemap.xml: ${sitemap?.status ?? "no response"} on a dev server, where the build has not written it`);
    else problems.push(`sitemap.xml: ${sitemap?.status ?? "no response"}`);
  }
  const favicon = f["/favicon.ico"];
  if (!favicon || favicon.status !== 200) {
    if (ctx.icon?.status === 200) notes.push(`favicon.ico: ${favicon?.status ?? "no response"}, but <link rel="icon" href="${ctx.icon.href}"> returns 200`);
    else problems.push(`favicon.ico: ${favicon?.status ?? "no response"}${ctx.icon ? `, and <link rel="icon" href="${ctx.icon.href}"> returns ${ctx.icon.status}` : ", and no <link rel=\"icon\">"}`);
  }
  for (const optional of ["/llms.txt", "/.well-known/security.txt"]) {
    notes.push(`${optional.replace(/^\/(\.well-known\/)?/, "")}: ${f[optional]?.status ?? "no response"}`);
  }
  if (problems.length) return verdict("fail", `${problems.join("; ")}; ${notes.join(", ")}`, "robots.txt must not disallow everything; publish the sitemap and favicon; decide on the optional files.");
  return verdict("pass", `robots.txt present and open; ${notes.join(", ")}`);
}

const sitemapUrls = buildOnly((ctx) => {
  if (!ctx.sitemap) return null;
  const problems = [];
  for (const entry of ctx.sitemap) {
    if (entry.status !== 200) problems.push(`${entry.url} → ${entry.status}${entry.location ? ` to ${entry.location}` : ""}`);
    else if (entry.canonical && entry.canonical !== entry.url) problems.push(`${entry.url} canonicalises to ${entry.canonical}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), "List the canonical URL, as the page itself declares it.");
  return verdict("pass", `${count(ctx.sitemap.length, "sitemap URL")} return 200 and match their canonicals`);
});

function noAccidentalNoindex(ctx) {
  const hits = [];
  for (const page of ctx.pages) {
    if (/noindex/i.test(page.robotsMeta ?? "")) hits.push(`${path(page.url)}: meta robots ${page.robotsMeta}`);
    if (/noindex/i.test(page.xRobotsTag ?? "")) hits.push(`${path(page.url)}: x-robots-tag: ${page.xRobotsTag}`);
  }
  if (hits.length) return verdict("fail", hits.join("; "), "Remove noindex unless the page is meant to be hidden.");
  return verdict("pass", `no noindex meta or x-robots-tag on ${count(ctx.pages.length, "page")}`);
}

function feed(ctx) {
  if (!ctx.files || !ctx.home) return null;
  const served = ["/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"].filter((p) => ctx.files[p]?.status === 200);
  const linked = ctx.home.feedLinks ?? [];
  if (!served.length && !linked.length) return verdict("na", "no feed at /feed.xml, /rss.xml, /atom.xml or /index.xml, and no link rel=alternate");
  if (served.length && !linked.length) return verdict("fail", `${served.join(", ")} served but no <link rel="alternate"> in <head>`, "Link the feed from <head>.");
  return verdict("pass", `feed linked from <head>: ${linked.join(", ")}${served.length ? `; served at ${served.join(", ")}` : ""}`);
}

// ---------------------------------------------------------------------------
// Performance

function lighthouse(ctx) {
  if (!ctx.lighthouse) return null;
  const low = [];
  for (const run of ctx.lighthouse) {
    const scores = { performance: run.performance, accessibility: run.accessibility, "best practices": run.bestPractices, seo: run.seo };
    const under = Object.entries(scores).filter(([, s]) => s < 90).map(([k, s]) => `${k} ${s}`);
    if (under.length) low.push(`${path(run.url)}: ${under.join(", ")}`);
  }
  if (low.length) return verdict("fail", low.join("; "), "Lighthouse names the audits behind each score.");
  return verdict("pass", ctx.lighthouse.map((r) => `${path(r.url)}: ${r.performance}/${r.accessibility}/${r.bestPractices}/${r.seo}`).join("; "));
}

function coreWebVitals(ctx) {
  if (!ctx.lighthouse) return null;
  const bad = [];
  for (const run of ctx.lighthouse) {
    const issues = [];
    if (run.lcp > 2500) issues.push(`LCP ${Math.round(run.lcp)}ms`);
    if (run.cls > 0.1) issues.push(`CLS ${run.cls}`);
    if (run.inp != null && run.inp > 200) issues.push(`INP ${Math.round(run.inp)}ms`);
    if (issues.length) bad.push(`${path(run.url)}: ${issues.join(", ")}`);
  }
  if (bad.length) return verdict("fail", bad.join("; "), "LCP under 2.5s, INP under 200ms, CLS under 0.1.");
  return verdict("pass", ctx.lighthouse.map((r) => `${path(r.url)}: LCP ${Math.round(r.lcp)}ms, CLS ${r.cls}${r.inp != null ? `, INP ${Math.round(r.inp)}ms` : ""}`).join("; "));
}

const caching = productionOnly((ctx) => {
  if (!ctx.caching) return null;
  const { html, asset } = ctx.caching;
  const problems = [];
  if (!/br|gzip|zstd/.test(html?.contentEncoding ?? "")) problems.push(`HTML content-encoding: ${html?.contentEncoding ?? "none"}`);
  if (asset) {
    const age = Number((/max-age=(\d+)/i.exec(asset.cacheControl ?? "") ?? [])[1] ?? 0);
    if (age < YEAR && !/immutable/.test(asset.cacheControl ?? "")) problems.push(`${path(asset.url)} cache-control: ${asset.cacheControl ?? "none"}`);
  } else {
    problems.push("no hashed static asset found to check");
  }
  if (problems.length) return verdict("fail", problems.join("; "), "Compress at the edge; long max-age with hashed filenames.");
  return verdict("pass", `HTML ${html.contentEncoding}; ${path(asset.url)} cache-control: ${asset.cacheControl}`);
});

const requestChain = buildOnly((ctx) => {
  const home = ctx.home;
  if (!home?.scripts) return null;
  const problems = [];
  const blocking = home.scripts.filter((s) => s.inHead && !s.async && !s.defer && !s.module);
  if (blocking.length) problems.push(`render-blocking in <head>: ${blocking.map((s) => s.src).join(", ")}`);
  const fonts = home.fonts ?? { requested: 0, preloaded: 0 };
  if (fonts.requested > fonts.preloaded) problems.push(`${count(fonts.requested, "font")} requested, ${fonts.preloaded} preloaded`);
  if (problems.length) return verdict("fail", problems.join("; "), "defer or async scripts, preload fonts with font-display: swap.");
  return verdict("pass", `no render-blocking scripts in <head>; ${count(fonts.requested, "font")} requested, ${fonts.preloaded} preloaded`);
});

const pageWeight = buildOnly((ctx) => {
  if (ctx.transferredBytes == null) return null;
  const evidence = `${kb(ctx.transferredBytes)} transferred on a cold load (threshold ${kb(HEAVY_PAGE)})`;
  if (ctx.transferredBytes > HEAVY_PAGE) return verdict("fail", evidence, "Compress images, defer scripts, drop what nobody asked for.");
  return verdict("pass", evidence);
});

// ---------------------------------------------------------------------------
// Errors, metadata, legal, DNS, monitoring, QA, launch day

const statusCodes = productionOnly((ctx) => {
  if (!ctx.nonsense) return null;
  if (ctx.nonsense.status === 404 || ctx.nonsense.status === 410) return verdict("pass", `GET /${ctx.nonsense.path ?? "a-nonsense-url"} returned ${ctx.nonsense.status}`);
  return verdict("fail", `GET /${ctx.nonsense.path ?? "a-nonsense-url"} returned ${ctx.nonsense.status}`, "Serve real 404s; a 200 hides every broken link.");
});

const styledErrorPages = productionOnly((ctx) => {
  if (!ctx.nonsense?.html) return null;
  const styled = /<style\b/i.test(ctx.nonsense.html);
  const nav = /<nav\b/i.test(ctx.nonsense.html);
  if (styled && nav) return verdict("pass", "the 404 page carries inline styles and a <nav>");
  return verdict("fail", `the 404 page has ${styled ? "inline styles" : "no inline styles"} and ${nav ? "a <nav>" : "no <nav>"}`, "Inline the CSS and give it the site's navigation.");
});

function titlesDescriptions(ctx) {
  const problems = [];
  const titles = new Map();
  for (const page of ctx.pages) {
    const where = path(page.url);
    if (!page.title) problems.push(`${where}: no title`);
    else {
      const key = page.title.trim().toLowerCase();
      const seen = titles.get(key) ?? { title: page.title.trim(), pages: [] };
      seen.pages.push(where);
      titles.set(key, seen);
      if (page.title.length > 60) problems.push(`${where}: title ${page.title.length} characters`);
    }
    if (!page.description) problems.push(`${where}: no description`);
    else if (page.description.length > 160) problems.push(`${where}: description ${page.description.length} characters`);
  }
  for (const { title, pages } of titles.values()) {
    if (pages.length > 1) problems.push(`duplicate title "${title}" on ${pages.join(" and ")}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), "A unique title and description per page, about 55 and 155 characters.");
  return verdict("pass", `${count(ctx.pages.length, "page")} with unique titles and descriptions`);
}

function canonicals(ctx) {
  const problems = [];
  for (const page of ctx.pages) {
    const where = path(page.url);
    if (!page.canonical) problems.push(`no canonical on ${where}`);
    else if (!/^https?:\/\//.test(page.canonical)) problems.push(`${where}: canonical is relative (${page.canonical})`);
    else if (page.canonical !== page.url) problems.push(`${where}: canonical points at ${path(page.canonical)}`);
  }
  if (ctx.hostAlt && !ctx.local) {
    const redirected = [301, 308].includes(ctx.hostAlt.status) && ctx.hostAlt.location?.startsWith(ctx.target);
    if (!redirected) problems.push(`${ctx.hostAlt.host} answers ${ctx.hostAlt.status} rather than 301 to ${ctx.target}`);
  }
  if (problems.length) return verdict("fail", problems.join("; "), "Absolute, self-referential canonicals; one host 301s to the other.");
  return verdict("pass", `${count(ctx.pages.length, "page")} with absolute self-referential canonicals${ctx.hostAlt ? `; ${ctx.hostAlt.host} 301s here` : ""}`);
}

function socialCards(ctx) {
  const og = ctx.home?.og;
  if (!og) return null;
  const missing = ["title", "description", "image"].filter((k) => !og[k]).map((k) => `og:${k}`);
  if (missing.length) return verdict("fail", `missing ${missing.join(", ")}`, "Set all three; the image 1200×630 and absolute.");
  if (!/^https?:\/\//.test(og.image)) return verdict("fail", `og:image is not absolute: ${og.image}`, "Use the full URL.");
  if (ctx.ogImageStatus == null) return null;
  if (ctx.ogImageStatus !== 200) return verdict("fail", `og:image ${og.image} returned ${ctx.ogImageStatus}`, "Publish the image at that URL.");
  return verdict("pass", `og:title, og:description, og:image ${og.image} (200)`);
}

function structuredData(ctx) {
  const blocks = ctx.pages.flatMap((p) => (p.jsonLd ?? []).map((raw) => ({ raw, where: path(p.url) })));
  if (!blocks.length) return verdict("na", `no JSON-LD on ${count(ctx.pages.length, "page")}`);
  const types = [], broken = [];
  for (const { raw, where } of blocks) {
    try {
      const data = JSON.parse(raw);
      for (const item of Array.isArray(data) ? data : [data]) types.push(item["@type"] ?? "untyped");
    } catch (error) {
      broken.push(`${where}: ${error.message}`);
    }
  }
  if (broken.length) return verdict("fail", `JSON-LD does not parse: ${broken.join("; ")}`, "Validate it in the Rich Results Test.");
  return verdict("pass", `JSON-LD types: ${[...new Set(types.flat())].join(", ")}`);
}

function licence(ctx) {
  if (!ctx.licence) return null;
  return gathered(`${ctx.licence.footer ? `footer says: ${oneLine(ctx.licence.footer)}` : "no licence statement in the footer"}; ${ctx.licence.file ? "LICENSE file in the repository" : "no LICENSE file found"}`);
}

function privacyPolicy(ctx) {
  if (!ctx.thirdParty) return null;
  const origins = ctx.thirdParty.origins ?? [];
  return gathered(`${origins.length ? `contacts ${origins.join(", ")}` : "contacts no third-party origins"}; ${ctx.thirdParty.policy ? `privacy policy at ${ctx.thirdParty.policy}` : "no privacy policy link found"}`);
}

function cookieConsent(ctx) {
  if (!ctx.cookiesBeforeConsent) return null;
  if (ctx.cookiesBeforeConsent.length === 0) return verdict("pass", "no cookies set before consent on a fresh load; no banner needed");
  const list = ctx.cookiesBeforeConsent.map((c) => `${c.name} (${c.domain})`).join(", ");
  return verdict("fail", `${list} set before consent`, "Gate non-essential cookies behind consent, or drop them.");
}

const emailAuth = productionOnly((ctx) => {
  if (!ctx.dns) return null;
  const { spf, dmarc, mx = [] } = ctx.dns;
  if (!mx.length && !spf) return verdict("na", "no MX and no SPF record: the domain does not send mail");
  const problems = [];
  if (!spf) problems.push("no SPF record");
  if (!dmarc) problems.push("no DMARC record");
  if (problems.length) return verdict("fail", `${spf ? `SPF: ${spf}` : ""}${spf && dmarc ? "; " : ""}${dmarc ? `DMARC: ${dmarc}` : ""}${spf || dmarc ? "; " : ""}${problems.join("; ")}`.replace(/^; /, ""), "Publish SPF and DMARC, and a DKIM selector for each sender.");
  return verdict("pass", `SPF: ${spf}; DMARC: ${dmarc}`);
});

const dns = productionOnly((ctx) => {
  if (!ctx.dns) return null;
  return gathered(`apex ${ctx.dns.apex?.join(", ") || "unresolved"}; www ${ctx.dns.www?.join(", ") || "unresolved"}; ${ctx.dns.caa?.length ? `CAA: ${ctx.dns.caa.join(", ")}` : "no CAA record"}`);
});

function analytics(ctx) {
  if (!ctx.analytics) return null;
  return gathered(ctx.analytics.length ? `analytics requests to ${ctx.analytics.join(", ")}` : "no analytics request on a page view");
}

function viewports(ctx) {
  const overflow = ctx.home?.overflow;
  if (!overflow) return null;
  const widths = ["320", "768", "1280", "2560"].filter((w) => overflow[w]);
  if (widths.length) return verdict("fail", `horizontal overflow at ${widths.map((w) => `${w}px`).join(", ")}`, "Find the element wider than the viewport.");
  return verdict("pass", "no horizontal overflow at 320, 768, 1280 or 2560px");
}

function darkMode(ctx) {
  if (!ctx.darkMode) return null;
  return gathered(`${ctx.darkMode.changes ? "styles change" : "styles do not change"} under prefers-color-scheme: dark; ${ctx.darkMode.forcedColors ? "respond to" : "do not respond to"} forced-colors`);
}

function print(ctx) {
  if (!ctx.home) return null;
  if (ctx.home.hasPrintStyles) return verdict("pass", "@media print or a print stylesheet found");
  return verdict("fail", "no @media print block or print stylesheet", "Add one if anything on the site gets printed.");
}

function noJs(ctx) {
  if (!ctx.noJs) return null;
  const { mainText, hasNav } = ctx.noJs;
  const evidence = `with JavaScript disabled: ${mainText} characters of main content, ${hasNav ? "nav present" : "no nav"}`;
  if (mainText < 200 || !hasNav) return verdict("fail", evidence, "Render core content and navigation on the server.");
  return verdict("pass", evidence);
}

const rerunChecks = productionOnly(() => gathered("this run was against the production URL"));

const purgeCaches = productionOnly((ctx) => {
  if (!ctx.cacheBust) return null;
  return gathered(ctx.cacheBust.same ? "a cache-busting request returned the same HTML as a normal one" : "a cache-busting request returned different HTML from a normal one");
});

export const RULES = {
  "content.no-placeholder-text": noPlaceholderText,
  "content.links-resolve": linksResolve,
  "content.images": images,
  "content.contact-details": contactDetails,
  "content.nothing-private": nothingPrivate,
  "content.locale": locale,
  "a11y.automated-scan": automatedScan,
  "a11y.contrast": contrast,
  "a11y.semantics": semantics,
  "a11y.alt-text": altText,
  "a11y.forms": forms,
  "a11y.zoom-reflow": zoomReflow,
  "a11y.statement": statement,
  "security.csp": csp,
  "security.hsts": hsts,
  "security.header-set": headerSet,
  "security.tls": tls,
  "security.secrets": secrets,
  "security.third-party-scripts": thirdPartyScripts,
  "security.cookies": cookies,
  "security.admin-staging": adminStaging,
  "security.server-banner": serverBanner,
  "files.files-present": filesPresent,
  "files.sitemap-urls": sitemapUrls,
  "files.no-accidental-noindex": noAccidentalNoindex,
  "files.feed": feed,
  "perf.lighthouse": lighthouse,
  "perf.core-web-vitals": coreWebVitals,
  "perf.caching": caching,
  "perf.request-chain": requestChain,
  "perf.page-weight": pageWeight,
  "errors.status-codes": statusCodes,
  "errors.styled-error-pages": styledErrorPages,
  "seo.titles-descriptions": titlesDescriptions,
  "seo.canonicals": canonicals,
  "seo.social-cards": socialCards,
  "seo.structured-data": structuredData,
  "legal.licence": licence,
  "legal.privacy-policy": privacyPolicy,
  "legal.cookie-consent": cookieConsent,
  "infra.dns": dns,
  "infra.email-auth": emailAuth,
  "ops.analytics": analytics,
  "qa.viewports": viewports,
  "qa.dark-mode": darkMode,
  "qa.print": print,
  "qa.no-js": noJs,
  "day.rerun-checks": rerunChecks,
  "day.purge-caches": purgeCaches,
};
