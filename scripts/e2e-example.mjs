#!/usr/bin/env node
// End-to-end check of the plugin's deterministic layer and project templates, without Claude:
// init a fresh QA repo from the templates, run the example login feature through the plan
// lifecycle gates, type-check, and run real Playwright tests against the demo app.
//
//   node scripts/e2e-example.mjs [--dir <empty dir>] [--node-modules <dir with @playwright/test, typescript>] [--keep]
//
// Needs network for `npm install` unless --node-modules points at an installed node_modules
// directory (it must be named node_modules), and
// Playwright browsers (`npx playwright install`). Prints PASS/FAIL lines; exits 1 on any FAIL.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const MQA = join(PLUGIN, "scripts", "mqa.mjs");
const EXAMPLE = join(PLUGIN, "examples", "login");
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dir = opt("--dir") ?? mkdtempSync(join(tmpdir(), "mqa-e2e-"));
const PORT = 4300 + Math.floor(Math.random() * 500);
const shell = process.platform === "win32";
const USER = { MQA_USER_STANDARD_USERNAME: "dana@matrix.test", MQA_USER_STANDARD_PASSWORD: "Demo-pass-123" };
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `\n     ${String(detail).split("\n").slice(0, 12).join("\n     ")}` : ""}`);
  if (!ok) failures++;
}

function run(cmd, cmdArgs, env = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: dir, env: { ...process.env, ...env }, encoding: "utf8", shell, timeout: 300_000 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function mqa(...a) {
  const r = run(process.execPath, [MQA, ...a]);
  let json = null;
  try {
    json = JSON.parse(r.out.slice(r.out.indexOf("{")));
  } catch {}
  return { ...r, json };
}

// 1. Initialise from templates
writeFileSync(join(dir, "matrix-qa.config.json"), JSON.stringify({
  projectId: "e2e-demo",
  language: "he",
  environments: {
    local: { baseUrl: `http://127.0.0.1:${PORT}` },
    production: { baseUrl: "https://example.invalid", protected: true },
  },
  defaultEnvironment: "local",
  browsers: ["chromium", "firefox", "webkit"],
  devices: { "mobile-chrome": "Pixel 7", tablet: "iPad (gen 7)" },
  defaultProjects: ["chromium"],
}, null, 2));
check("config validate", mqa("config", "validate").code === 0);
const applied = mqa("init", "apply", "all");
check("init apply creates the template files", applied.code === 0 && applied.json?.created?.includes("playwright.config.ts"), applied.out);
const again = mqa("init", "apply", "all");
check("init apply twice never overwrites", again.code === 0 && again.json.created.length === 0, again.out);

// 2. Example feature through the plan lifecycle
cpSync(join(EXAMPLE, "qa"), join(dir, "qa"), { recursive: true });
cpSync(join(EXAMPLE, "tests"), join(dir, "tests"), { recursive: true }); // demo fixtures/index.ts adds page objects
check("lld baseline", mqa("lld", "baseline", "login").code === 0);
check("plan validate", mqa("plan", "validate", "login").code === 0);
check("approve from DRAFT is refused", mqa("plan", "status", "login", "APPROVED", "--by", "E2E").code === 2);
check("record REVIEWED", mqa("plan", "status", "login", "REVIEWED").code === 0);
check("full approval refused with a blocking question", mqa("plan", "status", "login", "APPROVED", "--by", "E2E").code === 2);
const approved = mqa("plan", "status", "login", "APPROVED", "--by", "E2E", "--partial");
check("partial approval excludes LOGIN-TC-009", approved.code === 0 && approved.json.approval_excluded.join() === "LOGIN-TC-009", approved.out);
const trace = mqa("trace", "login");
check("trace: no issues, only LOGIN-TC-011 not automated", trace.code === 0 && trace.json.notAutomated.join() === "LOGIN-TC-011", trace.out);

// 3. Dependencies, types, listing
const nm = opt("--node-modules");
if (nm) symlinkSync(nm, join(dir, "node_modules"), "dir");
else check("npm install", run("npm", ["install", "--no-audit", "--no-fund"]).code === 0);
const tsc = run("npx", ["tsc", "--noEmit"]);
check("tsc --noEmit", tsc.code === 0, tsc.out);
const list = run("npx", ["playwright", "test", "--list"]);
check("default projects: 9 tests on chromium only", list.code === 0 && /Total: 9 tests in 1 file/.test(list.out), list.out);
const listAll = run("npx", ["playwright", "test", "--list"], { MQA_PROJECTS: "all" });
check("MQA_PROJECTS=all: 45 tests on 5 projects", /Total: 45 tests in 1 file/.test(listAll.out), listAll.out);
const prod = run("npx", ["playwright", "test", "--list"], { MQA_ENV: "production" });
check("protected environment refused without confirmation", prod.code !== 0 && /is protected/.test(prod.out), prod.out);
const unknown = run("npx", ["playwright", "test", "--list"], { MQA_ENV: "nope" });
check("unknown environment refused", unknown.code !== 0 && /Unknown environment "nope"/.test(unknown.out), unknown.out);

// 4. Real runs against the demo app
async function withServer(extra, fn) {
  const server = spawn(process.execPath, [join(EXAMPLE, "app", "server.mjs"), String(PORT), ...extra], {
    env: { ...process.env, DEMO_USER_EMAIL: USER.MQA_USER_STANDARD_USERNAME, DEMO_USER_PASSWORD: USER.MQA_USER_STANDARD_PASSWORD },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((r) => server.stdout.once("data", r));
  try {
    return fn();
  } finally {
    server.kill();
  }
}

await withServer([], () => {
  const r = run("npx", ["playwright", "test"], USER);
  check("chromium run passes (9 tests)", r.code === 0 && /9 passed/.test(r.out), r.out.slice(-1500));
  const s = mqa("results");
  check("results summary: 9 passed, 0 failed", s.code === 0 && s.json.totals.passed === 9 && s.json.totals.failed === 0, s.out);
  const mobile = run("npx", ["playwright", "test", "--project=mobile-chrome", "--project=tablet"], USER);
  check("--project selects device projects in workers too (18 tests)", mobile.code === 0 && /18 passed/.test(mobile.out), mobile.out.slice(-1500));
  const browsers = run("npx", ["playwright", "test", "--project=firefox", "--project=webkit"], USER);
  check("firefox and webkit run passes (18 tests)", browsers.code === 0 && /18 passed/.test(browsers.out), browsers.out.slice(-1500));
});

await withServer(["--bug"], () => {
  const r = run("npx", ["playwright", "test"], USER);
  check("injected application defect fails LOGIN-TC-007 only", r.code !== 0 && /1 failed/.test(r.out) && /LOGIN-TC-007/.test(r.out), r.out.slice(-1500));
  const s = mqa("results");
  const f = s.json?.failed?.[0];
  check("results summary identifies the failure, its evidence, and redacts the password",
    s.code === 1 && s.json.totals.failed === 1 && f?.tcId === "LOGIN-TC-007" && /הסיסמה שגויה/.test(f.error) &&
      f.attachments.some((a) => a.contentType === "image/png") && f.attachments.some((a) => a.name === "trace") &&
      !s.out.includes(USER.MQA_USER_STANDARD_PASSWORD),
    s.out);
  if (args.includes("--save-report") && existsSync(join(dir, "test-results", "results.json"))) writeFileSync(opt("--save-report"), readFileSync(join(dir, "test-results", "results.json")));
});

// 5. Approval integrity after a hand edit
const planPath = join(dir, "qa", "test-cases", "login.md");
writeFileSync(planPath, readFileSync(planPath, "utf8").replace("לגלוש לנתיב `/login`.", "לפתוח את מסך ההתחברות."));
const state = mqa("plan", "state", "login");
check("hand edit after approval makes the approval ineffective", state.json?.effectiveApproval === false && /APPROVED_CONTENT_CHANGED/.test(state.json.reason), state.out);

console.log(`\n${failures ? `${failures} FAILED` : "ALL PASSED"} — QA repo at ${dir}`);
if (!args.includes("--keep") && !failures && !opt("--dir")) rmSync(dir, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
