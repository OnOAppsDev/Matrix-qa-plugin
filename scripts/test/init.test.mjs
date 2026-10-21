import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, inspect, templateFiles } from "../lib/init.mjs";
import { CONFIG } from "./helpers.mjs";

const repo = () => mkdtempSync(join(tmpdir(), "mqa-init-"));

test("template file list maps stored dotfile names to their targets", () => {
  const targets = templateFiles().map((f) => f.target);
  for (const t of [".gitignore", ".env.example", "package.json", "playwright.config.ts", "tsconfig.json", "tests/fixtures/index.ts", "tests/pages/BasePage.ts"]) {
    assert.ok(targets.includes(t), t);
  }
});

test("inspect on an empty repository proposes creating everything, no migration", () => {
  const r = inspect(repo());
  assert.equal(r.packageJson, null);
  assert.ok(r.files.every((f) => f.action === "create"));
  assert.equal(r.migrationProposalNeeded, false);
  assert.equal(r.matrixConfig.exists, false);
});

test("inspect on an existing Playwright project detects conflicts and requires a migration proposal", () => {
  const root = repo();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "legacy", scripts: { test: "playwright test --project=chromium" }, devDependencies: { "@playwright/test": "^1.40.0" } }));
  writeFileSync(join(root, "playwright.config.js"), "module.exports = { testDir: './e2e' };");
  writeFileSync(join(root, "tsconfig.json"), "{}");
  mkdirSync(join(root, "e2e", "pages"), { recursive: true });
  writeFileSync(join(root, "e2e", "home.spec.js"), "test('x', () => {});");
  const r = inspect(root);
  assert.equal(r.playwright.installedVersion, "^1.40.0");
  assert.deepEqual(r.playwright.configFiles, ["playwright.config.js"]);
  assert.equal(r.playwright.configuredTestDir, "./e2e");
  assert.equal(r.existingSpecs.count, 1);
  assert.deepEqual(r.pageObjectDirs, ["e2e/pages"]);
  assert.ok(r.conflicts.includes("tsconfig.json") && r.conflicts.includes("playwright.config.js"));
  assert.equal(r.migrationProposalNeeded, true);
  const pkg = r.files.find((f) => f.target === "package.json");
  assert.equal(pkg.action, "merge");
  assert.ok(pkg.details.keptDifferent.some((k) => k.startsWith("scripts.test")));
  assert.ok(pkg.details.addDevDependencies.some((k) => k.startsWith("typescript")));
});

test("apply requires a config, merges additively and never overwrites", () => {
  const root = repo();
  assert.throws(() => apply(root, ["all"]), /write and validate matrix-qa.config.json/);
  writeFileSync(join(root, "matrix-qa.config.json"), JSON.stringify(CONFIG));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "legacy", scripts: { test: "custom" }, devDependencies: { "@playwright/test": "1.40.0" } }));
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.env\n");
  writeFileSync(join(root, "tsconfig.json"), '{ "compilerOptions": {} }');

  const res = apply(root, ["all"]);
  assert.ok(res.created.includes("playwright.config.ts"));
  assert.deepEqual(res.skipped.map((s) => s.target), ["tsconfig.json"]);
  assert.equal(readFileSync(join(root, "tsconfig.json"), "utf8"), '{ "compilerOptions": {} }');

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "custom", "existing script kept");
  assert.equal(pkg.devDependencies["@playwright/test"], "1.40.0", "existing version kept");
  assert.ok(pkg.devDependencies.typescript && pkg.scripts.typecheck, "missing entries added");

  const gi = readFileSync(join(root, ".gitignore"), "utf8");
  assert.equal(gi.match(/^node_modules\/$/gm).length, 1);
  assert.match(gi, /^!\.env\.example$/m);
  for (const d of ["qa/lld", "qa/test-cases/.lld-baseline", "tests/e2e"]) assert.ok(existsSync(join(root, d, ".gitkeep")), d);

  const again = apply(root, ["all"]);
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.merged, []);
});

test("apply on a new repository names package.json after the project and rejects unknown targets", () => {
  const root = repo();
  writeFileSync(join(root, "matrix-qa.config.json"), JSON.stringify(CONFIG));
  apply(root, ["package.json"]);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name, "demo-qa");
  assert.throws(() => apply(root, ["src/app.ts"]), /not template files/);
});
