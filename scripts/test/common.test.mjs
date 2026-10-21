import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, normalizeText, parseFrontMatter, serializeFrontMatter, validateConfig } from "../lib/common.mjs";
import { CONFIG } from "./helpers.mjs";

test("fingerprint ignores line endings, trailing whitespace and BOM, but not content", () => {
  const a = "# T\n\nline one\nline two\n";
  assert.equal(fingerprint(a), fingerprint("﻿# T\r\n\r\nline one   \r\nline two\r\n\r\n"));
  assert.notEqual(fingerprint(a), fingerprint("# T\n\nline one\nline 2\n"));
  assert.match(fingerprint(a), /^sha256:[0-9a-f]{64}$/);
  assert.equal(normalizeText("a \t\r\nb"), "a\nb");
});

test("front matter round-trips flat values, quoting what YAML could misread", () => {
  const data = { feature: "login", lld_fingerprint: "sha256:abc", status_reason: "LLD sync: lockout # 3", empty: "" };
  const text = serializeFrontMatter(data, ["feature"]) + "body\n";
  assert.match(text, /^lld_fingerprint: "sha256:abc"$/m);
  assert.match(text, /^empty:$/m);
  const parsed = parseFrontMatter(text);
  assert.deepEqual(parsed.data, data);
  assert.equal(parsed.body, "body\n");
  assert.equal(parseFrontMatter("no front matter").data, null);
});

test("config: the documented shape is valid", () => {
  assert.deepEqual(validateConfig(CONFIG).errors, []);
});

test("config: each invalid value is reported", () => {
  const cases = [
    [{ ...CONFIG, projectId: "Acme Portal" }, /projectId/],
    [{ ...CONFIG, language: "fr" }, /language/],
    [{ ...CONFIG, environments: {} }, /at least one environment/],
    [{ ...CONFIG, environments: { qa: { baseUrl: "qa.example.com" } } }, /absolute http/],
    [{ ...CONFIG, environments: { qa: { baseUrl: "https://u:p@qa.example.com" } } }, /must not contain credentials/],
    [{ ...CONFIG, defaultEnvironment: "uat" }, /not defined/],
    [{ ...CONFIG, defaultEnvironment: "production" }, /protected/],
    [{ ...CONFIG, browsers: ["chrome"] }, /browser "chrome"/],
    [{ ...CONFIG, devices: { chromium: "Pixel 7" } }, /collides/],
    [{ ...CONFIG, defaultProjects: ["tablet"] }, /defaultProjects entry "tablet"/],
    [{ ...CONFIG, paths: { testDir: "../elsewhere" } }, /paths.testDir/],
    [{ ...CONFIG, environments: { qa: { baseUrl: "https://qa.example.com", password: "x" } } }, /looks like a credential/],
  ];
  for (const [cfg, re] of cases) {
    const { errors } = validateConfig(cfg);
    assert.ok(errors.some((e) => re.test(e)), `${re} not reported; got ${JSON.stringify(errors)}`);
  }
});

test("config: the application source path must be outside the QA repository", () => {
  const root = mkdtempSync(join(tmpdir(), "mqa-cfg-"));
  mkdirSync(join(root, "app"));
  const inside = validateConfig({ ...CONFIG, paths: { appSourcePath: "app" } }, root);
  assert.ok(inside.errors.some((e) => /outside the QA repository/.test(e)));
  const parent = validateConfig({ ...CONFIG, paths: { appSourcePath: ".." } }, join(root, "app"));
  assert.ok(parent.errors.some((e) => /must not be inside the application repository/.test(e)));
  const missing = validateConfig({ ...CONFIG, paths: { appSourcePath: "../does-not-exist-xyz" } }, root);
  assert.deepEqual(missing.errors, []);
  assert.ok(missing.warnings.some((w) => /does not exist/.test(w)));
});

test("config: unknown keys are warnings, not errors", () => {
  const r = validateConfig({ ...CONFIG, reporting: {} });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /reporting/.test(w)));
});
