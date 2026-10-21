// Deterministic LLD change detection: section-level fingerprints against the baseline snapshot
// taken when the plan was last generated or synchronised, mapped onto requirements, test cases
// and Playwright tests. The semantic reading of each change is the requirements-analyzer's job.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError, featurePaths, fingerprint, normalizeText, parseFrontMatter, rel } from "./common.mjs";
import { parsePlan, renderApproval, requirement } from "./plan.mjs";
import { traceAutomation } from "./automation.mjs";

const PREAMBLE = "(preamble)";

/** Each heading owns only its own text (not its subsections), keyed by its heading path. */
export function splitSections(text) {
  const lines = normalizeText(text).split("\n");
  const sections = [];
  const stack = [];
  let cur = { key: PREAMBLE, title: PREAMBLE, level: 0, lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) {
      cur.lines.push(line);
      continue;
    }
    sections.push(cur);
    const level = h[1].length;
    const title = h[2].trim();
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    stack.push({ level, title });
    cur = { key: stack.map((s) => s.title).join(" > "), title, level, lines: [] };
  }
  sections.push(cur);
  const out = [];
  const seen = new Map();
  for (const s of sections) {
    const content = s.lines.join("\n").trim();
    if (s.key === PREAMBLE && !content) continue;
    // Duplicate heading paths get a positional suffix so every key stays unique.
    const n = (seen.get(s.key) ?? 0) + 1;
    seen.set(s.key, n);
    const key = n > 1 ? `${s.key} [${n}]` : s.key;
    out.push({ key, title: s.title, content, hash: fingerprint(content) });
  }
  return out;
}

export function diffSections(oldText, newText) {
  const a = splitSections(oldText);
  const b = splitSections(newText);
  const aMap = new Map(a.map((s) => [s.key, s]));
  const bMap = new Map(b.map((s) => [s.key, s]));
  const modified = [];
  const unchanged = [];
  for (const s of b) {
    const old = aMap.get(s.key);
    if (!old) continue;
    if (old.hash === s.hash) unchanged.push(s.key);
    else modified.push({ key: s.key, title: s.title, before: old.content, after: s.content });
  }
  let added = b.filter((s) => !aMap.has(s.key));
  let removed = a.filter((s) => !bMap.has(s.key));
  // A heading renamed with identical content is a rename, not a removal plus an addition.
  const renamed = [];
  for (const r of [...removed]) {
    const match = added.find((s) => s.hash === r.hash && r.content);
    if (match) {
      renamed.push({ from: r.key, to: match.key });
      removed = removed.filter((x) => x !== r);
      added = added.filter((x) => x !== match);
    }
  }
  return {
    changed: Boolean(modified.length || added.length || removed.length || renamed.length),
    added: added.map((s) => ({ key: s.key, title: s.title, after: s.content })),
    modified,
    removed: removed.map((s) => ({ key: s.key, title: s.title, before: s.content })),
    renamed,
    unchanged: unchanged.length,
  };
}

function norm(s) {
  return s.replace(/`/g, "").replace(/^§\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A requirement's LLD section cell may hold the full heading path or just the heading title. */
function sectionMatches(cell, section) {
  const c = norm(cell);
  return Boolean(c) && (c === norm(section.key) || c === norm(section.title) || c === norm(section.key.replace(/ \[\d+\]$/, "")));
}

export function lldImpact(root, config, feature) {
  const paths = featurePaths(root, config, feature);
  if (!existsSync(paths.plan)) throw new UsageError(`no test plan at ${rel(root, paths.plan)}`);
  const plan = parsePlan(readFileSync(paths.plan, "utf8"));
  const lldFile = plan.meta.lld_path ? join(root, plan.meta.lld_path) : paths.lld;
  if (!existsSync(lldFile)) throw new UsageError(`LLD not found at ${plan.meta.lld_path}`);
  const current = readFileSync(lldFile, "utf8");
  const currentFp = fingerprint(current);
  const result = {
    feature,
    status: plan.meta.status,
    lld: plan.meta.lld_path,
    recordedFingerprint: plan.meta.lld_fingerprint,
    currentFingerprint: currentFp,
    lldChanged: currentFp !== plan.meta.lld_fingerprint,
    baseline: existsSync(paths.baseline) ? rel(root, paths.baseline) : null,
  };
  if (!result.baseline) {
    return { ...result, sections: null, note: "No baseline snapshot: only the whole-document fingerprint can be compared. Use read-only `git log -p -- <lld>` to see what changed." };
  }
  const baselineText = readFileSync(paths.baseline, "utf8");
  if (fingerprint(baselineText) !== plan.meta.lld_fingerprint) {
    result.baselineMismatch = "the baseline snapshot does not match the recorded fingerprint; treat the section diff with care";
  }
  const sections = diffSections(baselineText, current);
  const fid = plan.meta.feature_id;
  const reqs = plan.requirements.map((r) => requirement(r, fid));
  const currentSections = splitSections(current);
  const touched = [
    ...sections.modified.map((s) => ({ ...s, change: "modified" })),
    ...sections.removed.map((s) => ({ ...s, change: "removed" })),
    ...sections.renamed.map((s) => ({ key: s.from, title: s.from.split(" > ").at(-1), change: "renamed" })),
  ];
  const affectedRequirements = [];
  for (const r of reqs) {
    const hit = touched.find((s) => sectionMatches(r.section, s));
    if (hit) affectedRequirements.push({ id: r.id, section: r.section, change: hit.change });
  }
  const unmappedRequirements = reqs
    .filter((r) => !currentSections.some((s) => sectionMatches(r.section, s)))
    .filter((r) => !affectedRequirements.some((a) => a.id === r.id))
    .map((r) => ({ id: r.id, section: r.section }));
  const affectedIds = new Set([...affectedRequirements, ...unmappedRequirements].map((r) => r.id));
  const affectedTestCases = plan.testCases
    .filter((tc) => tc.requirements.some((r) => affectedIds.has(r)))
    .map((tc) => ({ id: tc.id, title: tc.title, requirements: tc.requirements.filter((r) => affectedIds.has(r)) }));
  const tcIds = new Set(affectedTestCases.map((t) => t.id));
  const trace = traceAutomation(root, config, feature);
  const affectedTests = trace.tests.filter((t) => tcIds.has(t.id));
  return {
    ...result,
    sections,
    impact: {
      affectedRequirements,
      unmappedRequirements,
      affectedTestCases,
      affectedTests,
      newSectionsWithoutRequirements: sections.added.map((s) => s.key),
    },
  };
}

/**
 * Record the current LLD as the analysed version (snapshot + fingerprint). On an APPROVED plan
 * this is only allowed with keepApproval — the QA engineer's explicit "no test impact" decision.
 */
export function recordBaseline(root, config, feature, { keepApproval = false } = {}) {
  const paths = featurePaths(root, config, feature);
  if (!existsSync(paths.plan)) throw new UsageError(`no test plan at ${rel(root, paths.plan)}`);
  const { data, body } = parseFrontMatter(readFileSync(paths.plan, "utf8"));
  const lldFile = data.lld_path ? join(root, data.lld_path) : paths.lld;
  const text = readFileSync(lldFile, "utf8");
  const fp = fingerprint(text);
  if (data.status === "APPROVED" && fp !== data.lld_fingerprint && !keepApproval) {
    throw new UsageError("plan is APPROVED: either move it to DRAFT before applying LLD changes, or pass --keep-approval after the QA engineer confirmed the LLD change has no test impact");
  }
  if (["REVIEWED"].includes(data.status) && fp !== data.lld_fingerprint) {
    throw new UsageError("plan is REVIEWED against the previous LLD; move it to DRAFT (with a reason) before recording the new LLD");
  }
  const previous = data.lld_fingerprint;
  data.lld_fingerprint = fp;
  writeFileSync(paths.plan, renderApproval(data, body));
  writeFileSync(paths.baseline, text);
  return { feature, previous, current: fp, baseline: rel(root, paths.baseline), status: data.status };
}

