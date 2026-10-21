import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withDefaults } from "../lib/common.mjs";
import { approvalState, contentFingerprint, newPlan, nextIds, parsePlan, setStatus, validatePlan } from "../lib/plan.mjs";
import { CONFIG, edit, exampleRepo } from "./helpers.mjs";

const errorsOf = (r) => validatePlan(r.root, r.config, "login").errors;
const fails = (fn, re) => assert.throws(fn, (e) => re.test(e.message), `expected refusal matching ${re}`);

test("the example plan is valid and its structure is parsed", () => {
  const r = exampleRepo();
  const v = validatePlan(r.root, r.config, "login");
  assert.deepEqual(v.errors, []);
  assert.equal(v.summary.testCases, 11);
  assert.equal(v.summary.requirements, 8);
  assert.deepEqual(v.summary.openBlockingQuestions, ["LOGIN-Q-001"]);
  assert.deepEqual(v.summary.blockedTestCases, ["LOGIN-TC-009"]);
  const plan = parsePlan(readFileSync(r.plan, "utf8"));
  assert.deepEqual(plan.testCases.find((t) => t.id === "LOGIN-TC-001").requirements, ["LOGIN-REQ-001", "LOGIN-REQ-005"]);
});

test("validation catches ID, traceability and completeness defects", () => {
  const cases = [
    ["### LOGIN-TC-003:", "### LOGIN-TC-002:", /duplicate test case ID/],
    ["| `LOGIN-REQ-003` | `אימות שדות`", "| `LOGIN-REQ-099` | `אימות שדות`", /not in the requirement coverage table|coverage table lists/],
    ["| עדיפות | P3 |\n| סוג | חיובי |", "| עדיפות | — |\n| סוג | חיובי |", /missing priority/],
    ["**תוצאה צפויה**\n- מוצגת ההודעה \"יש להזין כתובת דוא\"ל תקינה\".\n- המשתמש נשאר", "**תוצאה**\n- מוצגת ההודעה \"יש להזין כתובת דוא\"ל תקינה\".\n- המשתמש נשאר", /missing field "תוצאה צפויה"/],
    ["`LOGIN-TC-004`, `LOGIN-TC-005`, `LOGIN-TC-006`", "`LOGIN-TC-004`, `LOGIN-TC-005`", /coverage table lists/],
    ["| `LOGIN-Q-002` | NON_BLOCKING |", "| `LOGIN-Q-002` | MAYBE |", /severity must be one of/],
    ["| `LOGIN-RF-001` | MINOR | RESOLVED |", "| `LOGIN-RF-001` | MINOR | DONE |", /state must be one of/],
    ["<!-- mqa:section retired -->", "", /mqa:section retired -->.* missing/],
  ];
  for (const [from, to, re] of cases) {
    const r = exampleRepo();
    edit(r.plan, from, to);
    const errors = errorsOf(r);
    assert.ok(errors.some((e) => re.test(e)), `${re} not reported; got ${JSON.stringify(errors)}`);
  }
});

test("a retired ID can never be reused, and next-id never fills gaps", () => {
  const r = exampleRepo();
  edit(r.plan, "| מזהה | סיבה | תאריך |\n|---|---|---|", "| מזהה | סיבה | תאריך |\n|---|---|---|\n| `LOGIN-TC-015` | requirement removed | 2026-10-18 |");
  assert.deepEqual(nextIds(r.root, r.config, "login", "TC", 2), ["LOGIN-TC-016", "LOGIN-TC-017"]);
  assert.deepEqual(nextIds(r.root, r.config, "login", "Q"), ["LOGIN-Q-003"]);
  edit(r.plan, "### LOGIN-TC-011:", "### LOGIN-TC-015:");
  assert.ok(errorsOf(r).some((e) => /LOGIN-TC-015: ID is retired/.test(e)));
});

test("state machine: every approval gate is enforced", () => {
  const r = exampleRepo();
  const go = (to, opts) => setStatus(r.root, r.config, "login", to, opts);

  fails(() => go("APPROVED", { by: "Dana" }), /only a REVIEWED plan/);
  fails(() => go("CHANGES_REQUIRED"), /--reason is required/);

  edit(r.plan, "| `LOGIN-RF-002` | MAJOR | REJECTED |", "| `LOGIN-RF-002` | BLOCKING | OPEN |");
  fails(() => go("REVIEWED"), /open BLOCKING review findings/);
  edit(r.plan, "| `LOGIN-RF-002` | BLOCKING | OPEN |", "| `LOGIN-RF-002` | MAJOR | REJECTED |");

  go("REVIEWED");
  fails(() => go("APPROVED"), /--by/);
  fails(() => go("APPROVED", { by: "Dana" }), /full approval is blocked by open BLOCKING questions \(LOGIN-Q-001\)/);

  // Content changed after the review → approval refused.
  edit(r.plan, "2. ללחוץ על \"הצג סיסמה\".", "2. ללחוץ פעם אחת על \"הצג סיסמה\".");
  fails(() => go("APPROVED", { by: "Dana", partial: true }), /changed after the review/);
  go("REVIEWED");

  const res = go("APPROVED", { by: "Dana", partial: true });
  assert.equal(res.approval_scope, "partial");
  assert.deepEqual(res.approval_excluded, ["LOGIN-TC-009"]);
  const state = approvalState(r.root, r.config, "login");
  assert.equal(state.effective, true);
  assert.deepEqual(state.excluded, ["LOGIN-TC-009"]);
  fails(() => go("REVIEWED"), /cannot move from APPROVED to REVIEWED/);
  fails(() => go("DRAFT"), /--reason is required/);
});

test("state machine: REVIEWED needs recorded findings or NO_FINDINGS", () => {
  const r = exampleRepo();
  const text = readFileSync(r.plan, "utf8").replace(/^\| `LOGIN-RF-00\d`.*\n/gm, "");
  writeFileSync(r.plan, text);
  fails(() => setStatus(r.root, r.config, "login", "REVIEWED"), /no review is recorded/);
  edit(r.plan, "<!-- mqa:section retired -->", "NO_FINDINGS — 2026-10-18\n\n<!-- mqa:section retired -->");
  assert.equal(setStatus(r.root, r.config, "login", "REVIEWED").to, "REVIEWED");
});

test("full approval once the blocking question is resolved; change log edits keep it effective", () => {
  const r = exampleRepo();
  edit(r.plan, "| `LOGIN-Q-001` | BLOCKING | OPEN |", "| `LOGIN-Q-001` | BLOCKING | RESOLVED |");
  setStatus(r.root, r.config, "login", "REVIEWED");
  assert.equal(setStatus(r.root, r.config, "login", "APPROVED", { by: "Dana" }).approval_scope, "full");
  const fm = readFileSync(r.plan, "utf8");
  assert.match(fm, /^approved_by: Dana$/m);
  assert.match(fm, /\| אושר על ידי \| Dana \|/);

  edit(r.plan, "| 2026-10-18 | יצירת תוכנית הבדיקות |", "| 2026-10-19 | הערה ביומן |\n| 2026-10-18 | יצירת תוכנית הבדיקות |");
  assert.equal(approvalState(r.root, r.config, "login").effective, true, "change-log rows are history, not test content");
});

test("approval becomes ineffective after a content change or an LLD change", () => {
  for (const change of ["content", "lld"]) {
    const r = exampleRepo();
    edit(r.plan, "| `LOGIN-Q-001` | BLOCKING | OPEN |", "| `LOGIN-Q-001` | BLOCKING | RESOLVED |");
    setStatus(r.root, r.config, "login", "REVIEWED");
    setStatus(r.root, r.config, "login", "APPROVED", { by: "Dana" });
    if (change === "content") edit(r.plan, "1. לגלוש לנתיב `/login`.", "1. לפתוח את האתר.");
    else edit(r.lld, "15 דקות", "30 דקות");
    const s = approvalState(r.root, r.config, "login");
    assert.equal(s.effective, false);
    assert.match(s.reason, change === "content" ? /APPROVED_CONTENT_CHANGED/ : /LLD_CHANGED/);
    if (change === "content") assert.ok(errorsOf(r).some((e) => /APPROVED_CONTENT_CHANGED/.test(e)));
  }
});

test("line-ending-only edits do not invalidate an approval", () => {
  const r = exampleRepo();
  const before = contentFingerprint(readFileSync(r.plan, "utf8"));
  writeFileSync(r.plan, readFileSync(r.plan, "utf8").replace(/\n/g, "\r\n"));
  assert.equal(contentFingerprint(readFileSync(r.plan, "utf8")), before);
});

test("plan new creates a valid skeleton in English, records the baseline and never overwrites", () => {
  const r = exampleRepo({ config: { ...CONFIG, language: "en" } });
  const lld = join(r.root, "qa", "lld", "search.md");
  writeFileSync(lld, "# Search\n\n## Results\n- Shows 20 results per page.\n");
  const res = newPlan(r.root, withDefaults({ ...CONFIG, language: "en" }), "search", { version: "0.1.0" });
  assert.equal(res.featureId, "SEARCH");
  const text = readFileSync(join(r.root, "qa", "test-cases", "search.md"), "utf8");
  assert.match(text, /^status: DRAFT$/m);
  assert.match(text, /# Test Plan: search/);
  assert.match(text, /\| Status \| `DRAFT` \|/);
  assert.ok(existsSync(join(r.root, "qa", "test-cases", ".lld-baseline", "search.md")));
  assert.deepEqual(validatePlan(r.root, withDefaults({ ...CONFIG, language: "en" }), "search").errors, []);
  fails(() => newPlan(r.root, r.config, "search", { version: "0.1.0" }), /already exists — never overwritten/);
  fails(() => newPlan(r.root, r.config, "missing", { version: "0.1.0" }), /LLD not found/);
});
