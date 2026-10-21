import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN } from "./helpers.mjs";

const SCRIPT = join(PLUGIN, "scripts", "validate-plugin.mjs");

function copy() {
  const dir = mkdtempSync(join(tmpdir(), "mqa-plugin-"));
  cpSync(PLUGIN, dir, { recursive: true, filter: (src) => !/node_modules|\.git(\/|$)/.test(src) });
  return dir;
}
const validate = (dir) => spawnSync(process.execPath, [SCRIPT, dir, "--no-cli"], { encoding: "utf8" });
function mutate(dir, file, from, to) {
  const p = join(dir, file);
  const text = readFileSync(p, "utf8");
  assert.ok(text.includes(from), `test setup: ${from} not in ${file}`);
  writeFileSync(p, text.replace(from, to));
}

test("the plugin as shipped passes", () => {
  const r = validate(PLUGIN);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS structure and references/);
});

test("each kind of defect is detected", () => {
  const cases = [
    ["commands/qa-plan.md", "matrix-qa-plugin:test-designer", "matrix-qa-plugin:test-writer", /unknown agent\/command "matrix-qa-plugin:test-writer"/],
    ["agents/test-designer.md", "  - test-case-design", "  - test-case-desing", /preloads missing skill "test-case-desing"/],
    ["commands/qa-sync.md", "${CLAUDE_PLUGIN_ROOT}/docs/plan-format.md", "${CLAUDE_PLUGIN_ROOT}/docs/plan-formats.md", /missing file docs\/plan-formats.md/],
    ["skills/lld-change-impact/SKILL.md", "mqa.mjs\" lld diff", "mqa.mjs\" lld compare", /unknown script command "mqa.mjs lld compare"/],
    ["commands/qa-review.md", "run `/qa-plan`", "run `/qa-generate`", /unknown command \/qa-generate/],
    ["commands/qa-approve.md", "disable-model-invocation: true\n", "", /must set disable-model-invocation/],
    ["agents/qa-reviewer.md", "name: qa-reviewer", "name: reviewer", /must equal the file name/],
    ["agents/code-analyzer.md", "tools: Read, Grep, Glob", "tools: Read, Grep, Glob, Teleport", /unknown tool "Teleport"/],
    ["templates/test-plan.en.md", "<!-- mqa:section assumptions -->", "", /section markers must be exactly/],
    ["templates/test-plan.he.md", "**תוצאה צפויה**", "**תוצאה**", /required field label "תוצאה צפויה"/],
    [".claude-plugin/plugin.json", '"version": "0.1.0"', '"version": "0.2.0"', /does not match plugin.json version 0.2.0/],
    ["examples/login/qa/test-cases/login.md", "### LOGIN-TC-003:", "### LOGIN-TC-002:", /duplicate test case ID/],
    ["examples/login/qa/lld/login.md", "15 דקות", "30 דקות", /LLD_CHANGED/],
    ["hooks/hooks.json", "hooks/guard.mjs", "hooks/missing.mjs", /hook script hooks\/missing.mjs does not exist/],
    ["templates/matrix-qa.config.example.json", '"defaultEnvironment": "qa"', '"defaultEnvironment": "uat"', /defaultEnvironment "uat" is not defined/],
  ];
  const dir = copy();
  try {
    for (const [file, from, to, re] of cases) {
      const original = readFileSync(join(dir, file), "utf8");
      mutate(dir, file, from, to);
      const r = validate(dir);
      assert.equal(r.status, 1, `${file}: expected failure\n${r.stdout}`);
      assert.match(r.stdout, re, `${file}: ${re} not reported\n${r.stdout}`);
      writeFileSync(join(dir, file), original);
    }
    assert.equal(validate(dir).status, 0, "restored copy passes again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
