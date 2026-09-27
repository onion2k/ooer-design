// Results in the shape the Preflight Checklist imports, and the report.
//
// The checklist at https://onion2k.github.io/preflight/ enforces three rules
// in its own tool layer, and they are enforced here so that what this skill
// hands back is never silently ignored or wrong on import: a human check is
// never recorded, evidence is what was observed and at least eight
// characters, and a fail is a fail. The blob and the share link match
// state.js there byte for byte, so a link opens the checklist with this run
// already in place.

import { gunzipSync, gzipSync } from "node:zlib";

export const CHECKLIST = "https://onion2k.github.io/preflight/";
export const MIN_EVIDENCE = 8;
export const MAX_LINK = 30000;
const STATUSES = new Set(["pass", "fail", "na"]);

const ENTITIES = { "&mdash;": "—", "&ndash;": "–", "&ge;": "≥", "&le;": "≤", "&times;": "×", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&" };

function plain(text) {
  return String(text ?? "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, (entity) => ENTITIES[entity] ?? entity);
}

// checks.json is sections of items; a flat list is what everything else wants.
export function loadChecks(json) {
  const checks = [];
  for (const section of json.sections ?? []) {
    for (const item of section.items ?? []) {
      checks.push({
        id: item.id,
        section: section.id,
        sectionTitle: plain(section.title),
        task: plain(item.task),
        note: plain(item.note),
        verify: item.verify,
        blocker: item.blocker === true || (item.tag && item.tag.kind === "block"),
        conditional: item.conditional ?? (item.tag && item.tag.kind === "ifapp" ? plain(item.tag.label) : null),
        recipe: item.recipe ?? null,
      });
    }
  }
  return checks;
}

export function settle(checks, id, outcome) {
  const check = checks.find((c) => c.id === id);
  if (!check) throw new Error(`No check with id ${id}`);
  if (check.verify === "human") {
    throw new Error(`${id} needs a person: it is judgement or off-site knowledge, so an agent cannot settle it`);
  }
  if (!STATUSES.has(outcome.status)) throw new Error(`status must be pass, fail or na, not ${outcome.status}`);
  const evidence = String(outcome.evidence ?? "").trim();
  if (evidence.length < MIN_EVIDENCE) {
    throw new Error(`evidence is required for ${id}: what was observed, at least ${MIN_EVIDENCE} characters`);
  }
  return { status: outcome.status, by: "agent", evidence, note: outcome.note ?? null, at: new Date().toISOString() };
}

export function blob(target, results) {
  return { preflight: 1, target, savedAt: new Date().toISOString(), results };
}

export function encodeLink(value, base = CHECKLIST) {
  const encoded = "z" + gzipSync(Buffer.from(JSON.stringify(value))).toString("base64url");
  if (encoded.length > MAX_LINK) return null;
  return `${base}#results=${encoded}`;
}

export function decodeLink(link) {
  const marker = link.indexOf("#results=");
  const value = link.slice(marker + "#results=".length);
  const bytes = Buffer.from(value.slice(1), "base64url");
  return JSON.parse(value[0] === "z" ? gunzipSync(bytes).toString() : bytes.toString());
}

function line(check, prefix = "") {
  const flag = check.blocker ? "[blocker] " : "";
  return `${prefix}${flag}${check.id}  ${check.task}`;
}

function section(title, entries) {
  if (entries.length === 0) return [];
  return [`${title} (${entries.length})`, ...entries, ""];
}

// The report reads in the order a person needs it: what failed and what to
// do, then what the person must decide from gathered evidence, then what
// could not be checked and why, then what only a person can settle.
const NEXT = {
  "a dev server": "A dev server is not the build: run this against a preview of the build for weight and the request chain, and against the live URL for headers, TLS, DNS and error pages.",
  "a local build": "A local build cannot answer for the host: run this against the live URL for headers, TLS, DNS and error pages.",
};

export function renderReport({ checks, target, kind, results, gathered = {}, outstanding = {}, seconds }) {
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const settled = Object.entries(results).filter(([id]) => byId[id]);
  const of = (status) => settled.filter(([, r]) => r.status === status);
  const describe = ([id, record]) => {
    const rows = [line(byId[id], "  "), `    ${record.evidence}`];
    if (record.note) rows.push(`    → ${record.note}`);
    return rows.join("\n");
  };
  const failed = of("fail").map(describe);
  const passed = of("pass").map(([id, r]) => `${line(byId[id], "  ")}\n    ${r.evidence}`);
  const na = of("na").map(([id, r]) => `${line(byId[id], "  ")}\n    ${r.evidence}`);
  const decide = Object.entries(gathered).filter(([id]) => byId[id]).map(([id, evidence]) => `${line(byId[id], "  ")}\n    ${evidence}`);
  const could = Object.entries(outstanding).filter(([id]) => byId[id]).map(([id, reason]) => `${line(byId[id], "  ")}\n    ${reason}`);
  const person = checks.filter((c) => c.verify === "human").map((c) => `${line(c, "  ")}\n    ${c.note || ""}`.trimEnd());
  const blockers = checks.filter((c) => c.blocker && !results[c.id]).map((c) => `  ${c.id}  ${c.task}`);

  return [
    `Preflight for ${target}${kind ? `, ${kind}` : ""}: ${settled.length} checks settled in ${Math.round(seconds)} seconds.`,
    ...(NEXT[kind] ? [NEXT[kind]] : []),
    "",
    ...section("Failed", failed),
    ...section("Blockers not yet settled", blockers),
    ...section("For you to decide", decide),
    ...section("Could not check", could),
    ...section("Passed", passed),
    ...section("Not applicable", na),
    ...section("Needs a person", person),
  ].join("\n").trimEnd() + "\n";
}
