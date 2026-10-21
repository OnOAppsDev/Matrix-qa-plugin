import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffSections, lldImpact, recordBaseline, splitSections } from "../lib/lld.mjs";
import { setStatus } from "../lib/plan.mjs";
import { edit, exampleRepo } from "./helpers.mjs";

test("sections: own text only, heading paths, fenced code ignored, duplicates disambiguated", () => {
  const s = splitSections("intro\n# A\na\n## B\nb\n```\n# not a heading\n```\n## B\nb2\n# C\n");
  assert.deepEqual(s.map((x) => x.key), ["(preamble)", "A", "A > B", "A > B [2]", "C"]);
  assert.equal(s[1].content, "a");
  assert.match(s[2].content, /# not a heading/);
});

test("diff: added, modified, removed, renamed; whitespace-only changes are not changes", () => {
  const before = "# F\n## Rules\nmax 5\n## Old\ngone\n## Same\nsame text\n## Name\nx\n";
  const after = "# F\n## Rules\nmax 3\n## New\nadded\n## Same   \r\nsame text  \n## Renamed\nx\n";
  const d = diffSections(before, after);
  assert.deepEqual(d.modified.map((m) => [m.key, m.before, m.after]), [["F > Rules", "max 5", "max 3"]]);
  assert.deepEqual(d.added.map((a) => a.key), ["F > New"]);
  assert.deepEqual(d.removed.map((a) => a.key), ["F > Old"]);
  assert.deepEqual(d.renamed, [{ from: "F > Name", to: "F > Renamed" }]);
  assert.equal(diffSections(before, before.replace(/\n/g, "\r\n")).changed, false);
});

test("impact: LLD change → requirement → test case → Playwright test", () => {
  const r = exampleRepo({ withTests: true });
  mkdirSync(join(r.root, "tests", "e2e"), { recursive: true });
  writeFileSync(join(r.root, "tests", "e2e", "lockout.spec.ts"), "import { test } from '../fixtures';\ntest.fixme('LOGIN-TC-009: lockout', async () => {});\n");
  edit(r.lld, "לאחר 5 ניסיונות", "לאחר 3 ניסיונות");
  edit(r.lld, "## זכור אותי", "## שחזור סיסמה\n\n- קישור \"שכחתי סיסמה\".\n\n## זכור אותי");
  edit(r.lld, "## פרטים שגויים", "## הודעות שגיאה");
  const out = lldImpact(r.root, r.config, "login");
  assert.equal(out.lldChanged, true);
  assert.deepEqual(out.impact.affectedRequirements.map((a) => [a.id, a.change]), [["LOGIN-REQ-007", "modified"], ["LOGIN-REQ-006", "renamed"]].sort());
  assert.deepEqual(out.impact.affectedTestCases.map((t) => t.id).sort(), ["LOGIN-TC-007", "LOGIN-TC-008", "LOGIN-TC-009"]);
  assert.deepEqual(out.impact.affectedTests.map((t) => `${t.file}:${t.line}`).sort(), [
    "tests/e2e/lockout.spec.ts:2", "tests/e2e/login.spec.ts:55", "tests/e2e/login.spec.ts:62",
  ]);
  assert.ok(out.impact.newSectionsWithoutRequirements.some((k) => k.endsWith("שחזור סיסמה")));
});

test("impact: unchanged LLD reports no change; missing baseline falls back to the fingerprint", () => {
  const r = exampleRepo();
  assert.equal(lldImpact(r.root, r.config, "login").sections.changed, false);
  rmSync(join(r.root, "qa", "test-cases", ".lld-baseline", "login.md"));
  edit(r.lld, "15 דקות", "30 דקות");
  const out = lldImpact(r.root, r.config, "login");
  assert.equal(out.lldChanged, true);
  assert.equal(out.sections, null);
  assert.match(out.note, /git log -p/);
});

test("baseline: refused on REVIEWED/APPROVED plans unless the approval is explicitly kept", () => {
  const r = exampleRepo();
  edit(r.plan, "| `LOGIN-Q-001` | BLOCKING | OPEN |", "| `LOGIN-Q-001` | BLOCKING | RESOLVED |");
  setStatus(r.root, r.config, "login", "REVIEWED");
  edit(r.lld, "## מטרה", "## מטרת המסך");
  assert.throws(() => recordBaseline(r.root, r.config, "login"), /REVIEWED against the previous LLD/);
  edit(r.lld, "## מטרת המסך", "## מטרה");
  setStatus(r.root, r.config, "login", "APPROVED", { by: "Dana" });
  edit(r.lld, "## מטרה", "## מטרת המסך");
  assert.throws(() => recordBaseline(r.root, r.config, "login"), /plan is APPROVED/);
  const kept = recordBaseline(r.root, r.config, "login", { keepApproval: true });
  assert.notEqual(kept.previous, kept.current);
  assert.match(readFileSync(r.plan, "utf8"), /^status: APPROVED$/m);
  assert.equal(readFileSync(join(r.root, "qa", "test-cases", ".lld-baseline", "login.md"), "utf8"), readFileSync(r.lld, "utf8"));
});
