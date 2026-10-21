// Traceability between manual test cases and Playwright tests, and Playwright JSON report summaries.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { featurePaths, rel } from "./common.mjs";
import { approvalState, parsePlan } from "./plan.mjs";

const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
// test('LOGIN-TC-001: ...'), test.skip("…"), test.fixme(`…`)
const TEST_CALL = /\btest(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*(['"`])([A-Z][A-Z0-9_]*-TC-\d{3,})\b([^'"`]*)/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SPEC_FILE.test(e.name)) out.push(p);
  }
  return out;
}

export function scanTests(root, config) {
  const tests = [];
  for (const file of walk(join(root, config.paths.testDir))) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(TEST_CALL)) {
        tests.push({ id: m[2], title: (m[2] + m[3]).trim(), file: rel(root, file), line: i + 1, skipped: /test\.(skip|fixme)/.test(m[0]) });
      }
    });
  }
  return tests;
}

/** Which approved test cases are automated, and which tests point at something they should not. */
export function traceAutomation(root, config, feature) {
  const paths = featurePaths(root, config, feature);
  const all = scanTests(root, config);
  if (!existsSync(paths.plan)) return { feature, tests: [], issues: [`no test plan for ${feature}`] };
  const plan = parsePlan(readFileSync(paths.plan, "utf8"));
  const fid = plan.meta.feature_id;
  const tests = all.filter((t) => t.id.startsWith(`${fid}-TC-`));
  const active = new Set(plan.testCases.map((t) => t.id));
  const approval = approvalState(root, config, feature);
  const excluded = new Set(approval.excluded ?? []);
  const issues = [];
  for (const t of tests) {
    if (plan.retired.has(t.id)) issues.push(`${t.file}:${t.line} ${t.id} is RETIRED in the plan — the test needs review or removal`);
    else if (!active.has(t.id)) issues.push(`${t.file}:${t.line} ${t.id} does not exist in the plan`);
    else if (excluded.has(t.id)) issues.push(`${t.file}:${t.line} ${t.id} is excluded from approval (open blocking question)`);
  }
  if (tests.length && !approval.effective) issues.push(`automation exists but the plan is not effectively approved: ${approval.reason}`);
  const automated = new Set(tests.map((t) => t.id));
  return {
    feature,
    approval: { effective: approval.effective, reason: approval.reason, excluded: [...excluded] },
    tests,
    automated: [...automated].filter((id) => active.has(id)).sort(),
    notAutomated: plan.testCases.map((t) => t.id).filter((id) => !automated.has(id) && !excluded.has(id)),
    issues,
  };
}

// ---------------------------------------------------------------- results

const SECRET_NAME = /PASS(WORD)?|SECRET|TOKEN|API[_-]?KEY|CREDENTIAL|PRIVATE/i;

/** Values of secret-looking variables, from the environment and the repo's .env, for redaction only. */
export function secretValues(root, env = process.env) {
  const values = new Map();
  const add = (k, v) => {
    if (SECRET_NAME.test(k) && typeof v === "string" && v.length >= 4) values.set(v, k);
  };
  for (const [k, v] of Object.entries(env)) add(k, v);
  const envFile = join(root, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m) add(m[1], m[2].replace(/^(['"])(.*)\1$/, "$2"));
    }
  }
  return values;
}

export function redact(text, secrets) {
  let out = text ?? "";
  // Longest first, so a secret containing another secret is fully replaced.
  for (const [v, k] of [...secrets].sort((a, b) => b[0].length - a[0].length)) out = out.split(v).join(`[REDACTED:${k}]`);
  return out;
}

const ANSI = /\u001b\[[0-9;]*m/g;

export function summarizeReport(report, root, { secrets = new Map(), maxError = 1500 } = {}) {
  const tests = [];
  const visit = (suite, titles) => {
    const t = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1) ?? {};
        const error = last.error?.message ?? last.errors?.[0]?.message ?? null;
        tests.push({
          title: spec.title,
          tcId: /[A-Z][A-Z0-9_]*-TC-\d{3,}/.exec(spec.title)?.[0] ?? null,
          file: spec.file,
          line: spec.line,
          project: test.projectName,
          outcome: test.status, // expected | unexpected | flaky | skipped
          lastStatus: last.status ?? null,
          retries: Math.max(0, (test.results?.length ?? 1) - 1),
          durationMs: last.duration ?? null,
          error: error ? redact(error.replace(ANSI, ""), secrets).slice(0, maxError) : null,
          location: last.error?.location ? `${rel(root, last.error.location.file)}:${last.error.location.line}` : null,
          attachments: (last.attachments ?? [])
            .filter((a) => a.path)
            .map((a) => ({ name: a.name, contentType: a.contentType, path: rel(root, a.path) })),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, t);
  };
  for (const s of report.suites ?? []) visit(s, []);
  const count = (o) => tests.filter((t) => t.outcome === o).length;
  const byProject = {};
  for (const t of tests) {
    byProject[t.project] ??= { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    const key = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[t.outcome] ?? "failed";
    byProject[t.project][key]++;
  }
  return {
    totals: { passed: count("expected"), failed: count("unexpected"), flaky: count("flaky"), skipped: count("skipped"), total: tests.length },
    durationMs: report.stats?.duration ?? null,
    byProject,
    failed: tests.filter((t) => t.outcome === "unexpected"),
    flaky: tests.filter((t) => t.outcome === "flaky").map(({ title, project, file, line }) => ({ title, project, file, line })),
    globalErrors: (report.errors ?? []).map((e) => redact((e.message ?? "").replace(ANSI, ""), secrets).slice(0, maxError)),
    untraced: [...new Set(tests.filter((t) => !t.tcId).map((t) => `${t.file}: ${t.title}`))],
  };
}

