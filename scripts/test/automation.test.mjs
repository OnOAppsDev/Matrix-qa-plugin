import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact, scanTests, secretValues, summarizeReport, traceAutomation } from "../lib/automation.mjs";
import { setStatus } from "../lib/plan.mjs";
import { PLUGIN, edit, exampleRepo } from "./helpers.mjs";

const REPORT = JSON.parse(readFileSync(join(PLUGIN, "scripts", "test", "fixtures", "playwright-report-failed.json"), "utf8"));

test("scan finds test titles that start with a TC ID, including skip/fixme", () => {
  const r = exampleRepo({ withTests: true });
  writeFileSync(join(r.root, "tests", "e2e", "extra.spec.ts"), "test.fixme(\"LOGIN-TC-011: remember me\", () => {});\ntest('no id here', () => {});\n");
  const tests = scanTests(r.root, r.config);
  assert.equal(tests.length, 10);
  assert.deepEqual(tests.find((t) => t.id === "LOGIN-TC-011"), { id: "LOGIN-TC-011", title: "LOGIN-TC-011: remember me", file: "tests/e2e/extra.spec.ts", line: 1, skipped: true });
});

test("trace flags tests for retired, unknown and excluded cases, and unapproved plans", () => {
  const r = exampleRepo({ withTests: true });
  writeFileSync(join(r.root, "tests", "e2e", "extra.spec.ts"), "test('LOGIN-TC-009: lockout', () => {});\ntest('LOGIN-TC-050: ghost', () => {});\n");
  let t = traceAutomation(r.root, r.config, "login");
  assert.ok(t.issues.some((i) => /not effectively approved/.test(i)));

  setStatus(r.root, r.config, "login", "REVIEWED");
  setStatus(r.root, r.config, "login", "APPROVED", { by: "Dana", partial: true });
  t = traceAutomation(r.root, r.config, "login");
  assert.ok(t.issues.some((i) => /extra.spec.ts:1 LOGIN-TC-009 is excluded from approval/.test(i)));
  assert.ok(t.issues.some((i) => /LOGIN-TC-050 does not exist in the plan/.test(i)));
  assert.deepEqual(t.notAutomated, ["LOGIN-TC-011"]);

  setStatus(r.root, r.config, "login", "DRAFT", { reason: "retire" });
  edit(r.plan, "|---|---|---|\n\n<!-- mqa:section change-log -->", "|---|---|---|\n| `LOGIN-TC-050` | removed | 2026-10-18 |\n\n<!-- mqa:section change-log -->");
  t = traceAutomation(r.root, r.config, "login");
  assert.ok(t.issues.some((i) => /LOGIN-TC-050 is RETIRED/.test(i)));
});

test("results summary from a real failing Playwright run", () => {
  const s = summarizeReport(REPORT, "/qa-repo");
  assert.deepEqual(s.totals, { passed: 8, failed: 1, flaky: 0, skipped: 0, total: 9 });
  assert.deepEqual(s.byProject.chromium, { passed: 8, failed: 1, flaky: 0, skipped: 0 });
  const f = s.failed[0];
  assert.equal(f.tcId, "LOGIN-TC-007");
  assert.equal(f.location, "tests/e2e/login.spec.ts:58");
  assert.match(f.error, /toHaveText/);
  assert.match(f.error, /הסיסמה שגויה/);
  assert.doesNotMatch(f.error, /\u001b\[/, "ANSI colour codes are stripped");
  assert.deepEqual(f.attachments.map((a) => a.contentType).sort(), ["application/zip", "image/png", "text/markdown"]);
  assert.ok(f.attachments.every((a) => a.path.startsWith("test-results/")));
  assert.deepEqual(s.untraced, []);
});

test("secrets from the environment and .env are redacted, longest first", () => {
  const root = mkdtempSync(join(tmpdir(), "mqa-redact-"));
  writeFileSync(join(root, ".env"), "MQA_USER_STANDARD_PASSWORD='Hunter-22-pass'\nMQA_ENV=qa\n# c\nexport API_TOKEN=tok-abc\n");
  const secrets = secretValues(root, { DB_SECRET: "Hunter-22", HOME: "/home/x" });
  assert.deepEqual([...secrets.values()].sort(), ["API_TOKEN", "DB_SECRET", "MQA_USER_STANDARD_PASSWORD"]);
  assert.equal(redact("typed Hunter-22-pass then tok-abc", secrets), "typed [REDACTED:MQA_USER_STANDARD_PASSWORD] then [REDACTED:API_TOKEN]");
  const report = structuredClone(REPORT);
  const specs = (suite) => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
  specs({ suites: report.suites }).find((s) => s.title.startsWith("LOGIN-TC-007")).tests[0].results[0].error.message += " Hunter-22-pass";
  const out = JSON.stringify(summarizeReport(report, "/qa-repo", { secrets }));
  assert.ok(!out.includes("Hunter-22"));
  assert.ok(out.includes("[REDACTED:MQA_USER_STANDARD_PASSWORD]"));
});
