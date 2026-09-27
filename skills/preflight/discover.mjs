// Finding the pages of a site, and telling a dev server from production.
//
// The preflight skill checks a whole site, not one page, so it needs the
// list of pages first: the sitemap when there is one, and otherwise a crawl
// of internal links. Whether the target is local matters just as much,
// because a dev server has no security headers or TLS to speak of, and
// recording those as failures would be recording the wrong thing.

const SKIPPED_SCHEMES = /^(?:mailto|tel|sms|javascript|data|blob):/i;

export function sitemapUrls(xml) {
  const index = /<sitemapindex\b/i.test(xml);
  const found = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  return index ? { pages: [], sitemaps: found } : { pages: found, sitemaps: [] };
}

function linksIn(html, pageUrl) {
  const out = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']*)["']/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || SKIPPED_SCHEMES.test(href)) continue;
    let url;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    out.push(url);
  }
  return out;
}

function unique(urls) {
  return [...new Set(urls.map((u) => u.href))];
}

export function internalLinks(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  return unique(linksIn(html, pageUrl).filter((u) => u.origin === origin));
}

export function externalLinks(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  return unique(linksIn(html, pageUrl).filter((u) => u.origin !== origin));
}

// One page per template is enough for the slow checks. The first path
// segment is a fair guess at the template: /blog/1 and /blog/2 share one.
export function templatePages(urls, max = 5) {
  const chosen = [];
  const seen = new Set();
  const root = urls.find((u) => new URL(u).pathname === "/");
  if (root) {
    chosen.push(root);
    seen.add("");
  }
  for (const url of urls) {
    if (chosen.length >= max) break;
    const segment = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
    if (seen.has(segment)) continue;
    seen.add(segment);
    chosen.push(url);
  }
  return chosen.slice(0, max);
}

export function isLocalTarget(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".test") ||
    host.startsWith("127.") || host.startsWith("192.168.") || host.startsWith("10.")
  );
}

// A dev server is on localhost too, but it is not the build: it serves
// unbundled modules, its own 404 page and no generated files. It gives
// itself away in the page or in what the page requests.
const DEV_FINGERPRINTS = /\/@vite\/client|\/@react-refresh|\/@id\/|\/@fs\/|\/_next\/static\/development\/|webpack-hmr|__webpack_hmr|astro-dev-toolbar|__nuxt_devtools__|\/__vite_ping/;

export function isDevServer(html, requestUrls = []) {
  return DEV_FINGERPRINTS.test(html) || requestUrls.some((url) => DEV_FINGERPRINTS.test(url));
}
