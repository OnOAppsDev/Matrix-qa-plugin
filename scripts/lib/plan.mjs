// The feature test-plan document: parsing, validation, the status state machine and stable IDs.
// Format contract: docs/plan-format.md. Everything here keys on language-independent tokens
// (LOGIN-TC-001, BLOCKING, OPEN) and <!-- mqa:section --> markers, never on translated labels,
// except the per-language field labels a test case block must contain.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUSES, UsageError, featurePaths, fingerprint, fingerprintFile,
  parseFrontMatter, rel, serializeFrontMatter,
} from "./common.mjs";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");

export const SECTIONS = [
  "feature", "strategy", "requirements", "test-cases", "assumptions",
  "open-questions", "review-findings", "retired", "change-log", "approval",
];
/** History and the script-owned approval record never count as test content. */
const UNHASHED_SECTIONS = new Set(["change-log", "approval"]);

export const KINDS = ["TC", "REQ", "Q", "RF"];
export const PRIORITIES = ["P1", "P2", "P3"];
const QUESTION_SEVERITIES = ["BLOCKING", "NON_BLOCKING"];
const QUESTION_STATES = ["OPEN", "RESOLVED"];
const FINDING_SEVERITIES = ["BLOCKING", "MAJOR", "MINOR"];
const FINDING_STATES = ["OPEN", "RESOLVED", "REJECTED"];
const COVERAGE = ["COVERED", "PARTIAL", "NOT_COVERED"];

/** Field labels every test case block must contain, per plan language. */
export const TC_LABELS = {
  he: ["דרישה", "עדיפות", "תנאים מקדימים", "נתוני בדיקה", "צעדי ביצוע", "תוצאה צפויה"],
  en: ["Requirement", "Priority", "Preconditions", "Test data", "Steps", "Expected result"],
};

const FRONT_MATTER_ORDER = [
  "feature", "feature_id", "title", "language", "lld_path", "lld_fingerprint", "status", "status_reason",
  "reviewed_at", "reviewed_fingerprint", "approved_by", "approved_at", "approved_fingerprint",
  "approval_scope", "approval_excluded", "plugin_version",
];

const MARKER = /^<!--\s*mqa:section\s+([a-z-]+)\s*-->\s*$/;

export function idRegex(featureId, kind, flags = "g") {
  return new RegExp(`\\b${featureId}-${kind}-(\\d{3,})\\b`, flags);
}

export function formatId(featureId, kind, n) {
  return `${featureId}-${kind}-${String(n).padStart(3, "0")}`;
}

function idsIn(text, featureId, kind) {
  return [...text.matchAll(idRegex(featureId, kind))].map((m) => m[0]);
}

export function parsePlan(text) {
  const { data, body } = parseFrontMatter(text);
  if (!data) throw new UsageError("plan has no front matter (--- ... ---) block");
  const sections = {};
  let current = null;
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    const m = MARKER.exec(line.trim());
    if (m) {
      current = m[1];
      sections[current] = sections[current] ?? { start: i, lines: [] };
      return;
    }
    if (current) sections[current].lines.push(line);
  });
  const fid = data.feature_id ?? "";
  const section = (name) => (sections[name]?.lines ?? []).join("\n");
  return {
    meta: data,
    body,
    sections,
    section,
    testCases: parseTestCases(section("test-cases"), fid),
    requirements: parseRows(section("requirements"), fid, "REQ"),
    questions: parseRows(section("open-questions"), fid, "Q"),
    findings: parseRows(section("review-findings"), fid, "RF"),
    retired: new Set(idsIn(section("retired"), fid, "TC")),
  };
}

function parseTestCases(text, fid) {
  const out = [];
  let cur = null;
  const head = new RegExp(`^###\\s+\`?(${fid}-TC-\\d{3,})\`?\\s*[:\\-—–]?\\s*(.*)$`);
  for (const line of text.split("\n")) {
    if (/^#{1,3}\s/.test(line)) {
      const m = head.exec(line);
      cur = m ? { id: m[1], title: m[2].trim(), lines: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return out.map((tc) => {
    const block = tc.lines.join("\n");
    return {
      id: tc.id,
      title: tc.title,
      block,
      requirements: [...new Set(idsIn(block, fid, "REQ"))],
      questions: [...new Set(idsIn(block, fid, "Q"))],
      priority: PRIORITIES.find((p) => new RegExp(`\\b${p}\\b`).test(block)) ?? null,
      hasSteps: /^\s*1\.\s+\S/m.test(block),
    };
  });
}

/** Table rows whose first cell holds an ID of `kind`. Cells keep their raw text. */
function parseRows(text, fid, kind) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const id = idsIn(cells[0] ?? "", fid, kind)[0];
    if (!id) continue;
    rows.push({ id, cells, line: line.trim() });
  }
  return rows;
}

function token(cell, allowed) {
  const c = (cell ?? "").replace(/`/g, "").trim();
  return allowed.includes(c) ? c : null;
}

export function question(row, fid) {
  return {
    id: row.id,
    severity: token(row.cells[1], QUESTION_SEVERITIES),
    state: token(row.cells[2], QUESTION_STATES),
    testCases: [...new Set(row.cells.slice(3).flatMap((c) => idsIn(c, fid, "TC")))],
  };
}

export function finding(row) {
  return { id: row.id, severity: token(row.cells[1], FINDING_SEVERITIES), state: token(row.cells[2], FINDING_STATES) };
}

export function requirement(row, fid) {
  return {
    id: row.id,
    section: (row.cells[1] ?? "").replace(/`/g, "").replace(/^§\s*/, "").trim(),
    testCases: [...new Set(row.cells.slice(2).flatMap((c) => idsIn(c, fid, "TC")))],
    coverage: row.cells.map((c) => token(c, COVERAGE)).find(Boolean) ?? null,
  };
}

/** Hash of the test content: body without the change log and approval sections. */
export function contentFingerprint(text) {
  const { body } = parseFrontMatter(text);
  const kept = [];
  let skip = false;
  for (const line of body.split("\n")) {
    const m = MARKER.exec(line.trim());
    if (m) skip = UNHASHED_SECTIONS.has(m[1]);
    if (!skip) kept.push(line);
  }
  return fingerprint(kept.join("\n"));
}

export function openBlockingQuestions(plan) {
  return plan.questions.map((r) => question(r, plan.meta.feature_id)).filter((q) => q.severity === "BLOCKING" && q.state === "OPEN");
}

/** TCs that cannot be approved while blocking questions are open (listed by the question or referencing it). */
export function blockedTestCases(plan) {
  const open = openBlockingQuestions(plan);
  const ids = new Set(open.map((q) => q.id));
  const blocked = new Set(open.flatMap((q) => q.testCases));
  for (const tc of plan.testCases) if (tc.questions.some((q) => ids.has(q))) blocked.add(tc.id);
  return [...blocked].sort();
}

function loadPlanFile(root, config, feature) {
  const paths = featurePaths(root, config, feature);
  if (!existsSync(paths.plan)) throw new UsageError(`no test plan at ${rel(root, paths.plan)} — run /qa-plan first`);
  const text = readFileSync(paths.plan, "utf8");
  return { paths, text, plan: parsePlan(text) };
}

/**
 * Whether the plan is approved *right now*: APPROVED, unchanged since approval,
 * and generated from the LLD as it currently is.
 */
export function approvalState(root, config, feature) {
  const { paths, text, plan } = loadPlanFile(root, config, feature);
  const m = plan.meta;
  if (m.status !== "APPROVED") return { effective: false, reason: `status is ${m.status}`, plan };
  if (m.approved_fingerprint !== contentFingerprint(text)) {
    return { effective: false, reason: "APPROVED_CONTENT_CHANGED: test content changed after approval; re-review and re-approve", plan };
  }
  const lld = lldPath(root, m, paths);
  if (!existsSync(lld)) return { effective: false, reason: `LLD ${m.lld_path} is missing`, plan };
  if (fingerprintFile(lld) !== m.lld_fingerprint) {
    return { effective: false, reason: "LLD_CHANGED: the LLD changed since this plan was analysed; run /qa-sync", plan };
  }
  const excluded = splitList(m.approval_excluded);
  return { effective: true, reason: m.approval_scope === "partial" ? "approved (partial)" : "approved", plan, excluded };
}

function lldPath(root, meta, paths) {
  return meta.lld_path ? join(root, meta.lld_path) : paths.lld;
}

export function splitList(v) {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function validatePlan(root, config, feature) {
  const { paths, text, plan } = loadPlanFile(root, config, feature);
  const errors = [];
  const warnings = [];
  const m = plan.meta;
  const fid = m.feature_id;

  for (const k of ["feature", "feature_id", "language", "lld_path", "lld_fingerprint", "status"]) {
    if (!m[k]) errors.push(`front matter: "${k}" is required`);
  }
  if (m.feature && m.feature !== feature) errors.push(`front matter: feature "${m.feature}" does not match file name "${feature}"`);
  if (fid && !/^[A-Z][A-Z0-9_]*$/.test(fid)) errors.push(`front matter: feature_id "${fid}" must be upper-case letters/digits (e.g. LOGIN)`);
  if (m.status && !STATUSES.includes(m.status)) errors.push(`front matter: status "${m.status}" is not one of ${STATUSES.join(", ")}`);
  if (m.language && !TC_LABELS[m.language]) errors.push(`front matter: language "${m.language}" is not supported`);
  for (const s of SECTIONS) if (!plan.sections[s]) errors.push(`section marker <!-- mqa:section ${s} --> is missing`);
  if (!fid) return { errors, warnings, summary: null };

  // Test cases: unique, never reusing a retired ID, traceable, complete.
  const seen = new Set();
  const reqIds = new Set(plan.requirements.map((r) => r.id));
  const labels = TC_LABELS[m.language] ?? TC_LABELS.en;
  for (const tc of plan.testCases) {
    if (seen.has(tc.id)) errors.push(`${tc.id}: duplicate test case ID`);
    seen.add(tc.id);
    if (plan.retired.has(tc.id)) errors.push(`${tc.id}: ID is retired and must never be reused`);
    if (!tc.title) errors.push(`${tc.id}: missing title`);
    if (!tc.requirements.length) errors.push(`${tc.id}: references no requirement (${fid}-REQ-nnn)`);
    for (const r of tc.requirements) if (!reqIds.has(r)) errors.push(`${tc.id}: references ${r}, which is not in the requirement coverage table`);
    if (!tc.priority) errors.push(`${tc.id}: missing priority (${PRIORITIES.join("/")})`);
    if (!tc.hasSteps) errors.push(`${tc.id}: missing numbered execution steps`);
    for (const l of labels) if (!tc.block.includes(l)) errors.push(`${tc.id}: missing field "${l}"`);
  }
  // Heading-like TC IDs outside "### ID: title" form are almost always a formatting slip.
  for (const line of plan.section("test-cases").split("\n")) {
    if (/^#{1,6}\s/.test(line) && idRegex(fid, "TC", "").test(line) && !/^###\s/.test(line)) {
      errors.push(`test case heading must use "### ${fid}-TC-nnn: title": ${line.trim()}`);
    }
  }

  // Requirements: the coverage table must agree with what the test cases declare.
  const reqSeen = new Set();
  for (const row of plan.requirements) {
    const r = requirement(row, fid);
    if (reqSeen.has(r.id)) errors.push(`${r.id}: duplicate requirement row`);
    reqSeen.add(r.id);
    if (!r.section) errors.push(`${r.id}: missing LLD section reference`);
    const declared = plan.testCases.filter((tc) => tc.requirements.includes(r.id)).map((tc) => tc.id).sort();
    const listed = r.testCases.filter((id) => !plan.retired.has(id)).sort();
    if (declared.join() !== listed.join()) {
      errors.push(`${r.id}: coverage table lists [${listed.join(", ")}] but test cases referencing it are [${declared.join(", ")}]`);
    }
    if (!r.coverage) errors.push(`${r.id}: coverage must be one of ${COVERAGE.join(", ")}`);
    else if (r.coverage === "NOT_COVERED") warnings.push(`${r.id}: marked NOT_COVERED — the reason must be documented`);
    else if (!declared.length) errors.push(`${r.id}: marked ${r.coverage} but no test case covers it`);
  }

  checkRows(plan.questions.map((q) => question(q, fid)), QUESTION_SEVERITIES, QUESTION_STATES, errors);
  checkRows(plan.findings.map(finding), FINDING_SEVERITIES, FINDING_STATES, errors);
  const tcIds = new Set(plan.testCases.map((t) => t.id));
  for (const q of plan.questions.map((r) => question(r, fid))) {
    for (const t of q.testCases) if (!tcIds.has(t) && !plan.retired.has(t)) errors.push(`${q.id}: lists unknown test case ${t}`);
  }

  // LLD freshness and approval integrity.
  const lld = lldPath(root, m, paths);
  let lldCurrent = null;
  if (!existsSync(lld)) errors.push(`LLD not found at ${m.lld_path}`);
  else {
    lldCurrent = fingerprintFile(lld);
    if (m.lld_fingerprint && lldCurrent !== m.lld_fingerprint) warnings.push("LLD_CHANGED: the LLD changed since this plan was analysed — run /qa-sync");
  }
  if (!existsSync(paths.baseline)) warnings.push(`no LLD baseline snapshot at ${rel(root, paths.baseline)}; /qa-sync can only compare whole-document fingerprints`);

  const content = contentFingerprint(text);
  if (["REVIEWED", "APPROVED"].includes(m.status) && !m.reviewed_fingerprint) errors.push(`status ${m.status} but no review is recorded`);
  if (m.status === "REVIEWED" && m.reviewed_fingerprint && m.reviewed_fingerprint !== content) {
    warnings.push("REVIEWED_CONTENT_CHANGED: test content changed after review; run /qa-review again");
  }
  if (m.status === "APPROVED") {
    if (!m.approved_by || !m.approved_at || !m.approved_fingerprint) errors.push("status APPROVED but approval record is incomplete");
    else if (m.approved_fingerprint !== content) errors.push("APPROVED_CONTENT_CHANGED: test content was modified after approval without re-approval");
  }

  const qs = plan.questions.map((r) => question(r, fid));
  return {
    errors,
    warnings,
    summary: {
      feature,
      status: m.status,
      testCases: plan.testCases.length,
      requirements: plan.requirements.length,
      retired: plan.retired.size,
      openBlockingQuestions: qs.filter((q) => q.severity === "BLOCKING" && q.state === "OPEN").map((q) => q.id),
      openQuestions: qs.filter((q) => q.state === "OPEN").map((q) => q.id),
      openFindings: plan.findings.map(finding).filter((f) => f.state === "OPEN").map((f) => `${f.id} (${f.severity})`),
      blockedTestCases: blockedTestCases(plan),
      lldChanged: Boolean(lldCurrent && m.lld_fingerprint && lldCurrent !== m.lld_fingerprint),
      contentFingerprint: content,
    },
  };
}

function checkRows(rows, severities, states, errors) {
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) errors.push(`${r.id}: duplicate row`);
    seen.add(r.id);
    if (!r.severity) errors.push(`${r.id}: severity must be one of ${severities.join(", ")}`);
    if (!r.state) errors.push(`${r.id}: state must be one of ${states.join(", ")}`);
  }
}

/** Next free ID: one past the highest ever used anywhere in the document, retired included. */
export function nextIds(root, config, feature, kind, count = 1) {
  if (!KINDS.includes(kind)) throw new UsageError(`kind must be one of ${KINDS.join(", ")}`);
  const { text, plan } = loadPlanFile(root, config, feature);
  const fid = plan.meta.feature_id;
  const max = Math.max(0, ...[...text.matchAll(idRegex(fid, kind))].map((m) => Number(m[1])));
  return Array.from({ length: count }, (_, i) => formatId(fid, kind, max + 1 + i));
}

export function newPlan(root, config, feature, { featureId, title, version }) {
  const paths = featurePaths(root, config, feature);
  if (existsSync(paths.plan)) throw new UsageError(`${rel(root, paths.plan)} already exists — never overwritten; use /qa-review or /qa-sync`);
  if (!existsSync(paths.lld)) throw new UsageError(`LLD not found at ${rel(root, paths.lld)}`);
  const fid = featureId ?? feature.replace(/-/g, "_").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(fid)) throw new UsageError(`feature id "${fid}" must be upper-case letters/digits`);
  const lang = config.language;
  const template = readFileSync(join(TEMPLATES, `test-plan.${lang}.md`), "utf8");
  const lldRel = rel(root, paths.lld);
  const meta = {
    feature, feature_id: fid, title: title ?? feature, language: lang, lld_path: lldRel,
    lld_fingerprint: fingerprintFile(paths.lld), status: "DRAFT", status_reason: "",
    reviewed_at: "", reviewed_fingerprint: "", approved_by: "", approved_at: "", approved_fingerprint: "",
    approval_scope: "", approval_excluded: "", plugin_version: version,
  };
  const body = parseFrontMatter(template).body
    .replace(/\{\{FEATURE_ID\}\}/g, fid)
    .replace(/\{\{TITLE\}\}/g, meta.title)
    .replace(/\{\{LLD_PATH\}\}/g, lldRel);
  const text = renderApproval(meta, body);
  writeFileSync(paths.plan, text);
  writeBaseline(paths);
  return { plan: rel(root, paths.plan), featureId: fid };
}

export function writeBaseline(paths) {
  writeFileSync(paths.baseline, readFileSync(paths.lld, "utf8"));
}

const TRANSITIONS = {
  DRAFT: ["DRAFT", "REVIEWED", "APPROVED", "CHANGES_REQUIRED"],
  CHANGES_REQUIRED: ["DRAFT", "REVIEWED", "APPROVED", "CHANGES_REQUIRED"],
  REVIEWED: ["DRAFT", "REVIEWED", "APPROVED", "CHANGES_REQUIRED"],
  APPROVED: ["DRAFT", "APPROVED", "CHANGES_REQUIRED"],
};

/**
 * The only writer of status fields. Every gate the state model promises is enforced here,
 * so neither a model nor a hand edit can skip one by calling the script.
 */
export function setStatus(root, config, feature, to, { by, reason, partial = false, now = new Date() } = {}) {
  if (!STATUSES.includes(to)) throw new UsageError(`status must be one of ${STATUSES.join(", ")}`);
  const { paths, text, plan } = loadPlanFile(root, config, feature);
  const m = { ...plan.meta };
  const from = m.status;
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new UsageError(`cannot move from ${from} to ${to}${from === "APPROVED" && to === "REVIEWED" ? " — an approved plan returns to DRAFT when it changes" : ""}`);
  }
  const content = contentFingerprint(text);
  const { errors } = validatePlan(root, config, feature);
  const lldNow = existsSync(lldPath(root, m, paths)) ? fingerprintFile(lldPath(root, m, paths)) : null;
  const ts = now.toISOString();
  const clearReview = () => Object.assign(m, { reviewed_at: "", reviewed_fingerprint: "" });
  const clearApproval = () => Object.assign(m, { approved_by: "", approved_at: "", approved_fingerprint: "", approval_scope: "", approval_excluded: "" });

  if (to === "DRAFT" || to === "CHANGES_REQUIRED") {
    if (!reason && (to === "CHANGES_REQUIRED" || ["REVIEWED", "APPROVED"].includes(from))) {
      throw new UsageError(`--reason is required to move ${from} to ${to}`);
    }
    clearReview();
    clearApproval();
  } else if (to === "REVIEWED") {
    if (errors.length) throw new UsageError(`plan has validation errors; fix them before recording a review:\n- ${errors.join("\n- ")}`);
    if (lldNow !== m.lld_fingerprint) throw new UsageError("the LLD changed since this plan was analysed — run /qa-sync before reviewing");
    const blocking = plan.findings.map(finding).filter((f) => f.severity === "BLOCKING" && f.state === "OPEN");
    if (blocking.length) throw new UsageError(`open BLOCKING review findings (${blocking.map((f) => f.id).join(", ")}); record CHANGES_REQUIRED instead`);
    if (!plan.findings.length && !/\bNO_FINDINGS\b/.test(stripComments(plan.section("review-findings")))) {
      throw new UsageError("no review is recorded: add the independent review's finding rows, or the token NO_FINDINGS with the review date, to the review-findings section");
    }
    clearApproval();
    Object.assign(m, { reviewed_at: ts, reviewed_fingerprint: content });
  } else if (to === "APPROVED") {
    if (!by || !by.trim()) throw new UsageError("--by <QA engineer name> is required to approve");
    if (from !== "REVIEWED") {
      throw new UsageError(`only a REVIEWED plan can be approved (current: ${from}); run /qa-review first`);
    }
    if (m.reviewed_fingerprint !== content) throw new UsageError("test content changed after the review; run /qa-review again before approving");
    if (errors.length) throw new UsageError(`plan has validation errors:\n- ${errors.join("\n- ")}`);
    if (lldNow !== m.lld_fingerprint) throw new UsageError("the LLD changed since this plan was analysed — run /qa-sync before approving");
    const blocked = blockedTestCases(plan);
    const blockingQs = openBlockingQuestions(plan).map((q) => q.id);
    if (blockingQs.length && !partial) {
      throw new UsageError(`full approval is blocked by open BLOCKING questions (${blockingQs.join(", ")}); resolve them, or approve partially with --partial (excludes ${blocked.join(", ") || "no test cases"})`);
    }
    Object.assign(m, {
      approved_by: by.trim(), approved_at: ts, approved_fingerprint: content,
      approval_scope: blockingQs.length ? "partial" : "full",
      approval_excluded: blockingQs.length ? blocked.join(", ") : "",
    });
  }
  m.status = to;
  m.status_reason = reason ?? "";
  const out = renderApproval(m, plan.body);
  writeFileSync(paths.plan, out);
  return { feature, from, to, approval_scope: m.approval_scope || undefined, approval_excluded: splitList(m.approval_excluded) };
}

function stripComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

const APPROVAL_TEXT = {
  he: {
    heading: "## 10. סטטוס אישור", note: "<!-- מקטע זה מנוהל על ידי scripts/mqa.mjs. אין לערוך ידנית. -->",
    field: "שדה", value: "ערך", status: "סטטוס", reason: "סיבה", reviewed: "נסקר בתאריך", by: "אושר על ידי",
    at: "אושר בתאריך", scope: "היקף אישור", excluded: "מוחרגים מהאישור", full: "מלא", partial: "חלקי",
  },
  en: {
    heading: "## 10. Approval Status", note: "<!-- This section is maintained by scripts/mqa.mjs. Do not edit by hand. -->",
    field: "Field", value: "Value", status: "Status", reason: "Reason", reviewed: "Reviewed at", by: "Approved by",
    at: "Approved at", scope: "Approval scope", excluded: "Excluded from approval", full: "full", partial: "partial",
  },
};

/** Front matter plus body, with the human-readable approval section re-rendered from `data` (excluded from the content hash). */
export function renderApproval(data, body) {
  const t = APPROVAL_TEXT[data.language] ?? APPROVAL_TEXT.en;
  const rows = [[t.status, `\`${data.status}\``]];
  if (data.status_reason) rows.push([t.reason, data.status_reason.replace(/\|/g, "\\|")]);
  if (data.reviewed_at) rows.push([t.reviewed, data.reviewed_at]);
  if (data.approved_by) {
    rows.push([t.by, data.approved_by], [t.at, data.approved_at], [t.scope, data.approval_scope === "partial" ? t.partial : t.full]);
    if (data.approval_excluded) rows.push([t.excluded, splitList(data.approval_excluded).map((i) => `\`${i}\``).join(", ")]);
  }
  const section = [
    "<!-- mqa:section approval -->", t.heading, "", t.note, "",
    `| ${t.field} | ${t.value} |`, "|---|---|", ...rows.map(([a, b]) => `| ${a} | ${b} |`), "",
  ].join("\n");
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^<!--\s*mqa:section\s+approval\s*-->/.test(l.trim()));
  let newBody;
  if (start === -1) newBody = body.trimEnd() + "\n\n" + section;
  else {
    const relEnd = lines.slice(start + 1).findIndex((l) => MARKER.test(l.trim()) || /^<\/div>\s*$/.test(l.trim()));
    const end = relEnd === -1 ? lines.length : start + 1 + relEnd;
    newBody = [...lines.slice(0, start), ...section.split("\n"), ...lines.slice(end)].join("\n");
  }
  return serializeFrontMatter(data, FRONT_MATTER_ORDER) + newBody.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

