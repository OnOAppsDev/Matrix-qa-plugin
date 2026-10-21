import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withDefaults } from "../lib/common.mjs";

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXAMPLE = join(PLUGIN, "examples", "login");

export const CONFIG = {
  projectId: "demo",
  language: "he",
  environments: { qa: { baseUrl: "https://qa.example.com" }, production: { baseUrl: "https://example.com", protected: true } },
  defaultEnvironment: "qa",
};

/** A fresh QA repository holding the example login feature. */
export function exampleRepo({ config = CONFIG, withTests = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mqa-test-"));
  writeFileSync(join(root, "matrix-qa.config.json"), JSON.stringify(config));
  cpSync(join(EXAMPLE, "qa"), join(root, "qa"), { recursive: true });
  if (withTests) cpSync(join(EXAMPLE, "tests"), join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "qa", "test-cases", ".lld-baseline"), { recursive: true });
  cpSync(join(root, "qa", "lld", "login.md"), join(root, "qa", "test-cases", ".lld-baseline", "login.md"));
  return { root, config: withDefaults(config), plan: join(root, "qa", "test-cases", "login.md"), lld: join(root, "qa", "lld", "login.md") };
}

export function edit(file, from, to) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`test setup: "${from}" not found in ${file}`);
  writeFileSync(file, text.replace(from, to));
}
