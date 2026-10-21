#!/usr/bin/env node
// Structural validation of the plugin itself. No network, no dependencies.
//
//   node scripts/validate-plugin.mjs [plugin-root] [--no-cli]
//
// Checks: manifest and version consistency; frontmatter of every command, agent and skill;
// every agent/skill/command/file/script-command reference in the markdown resolves; the hook
// configuration points at existing scripts; templates carry every section marker and field
// label the parser requires; the config example and the example plan validate.
// Also runs `claude plugin validate --strict` when the claude CLI is available (else SKIP).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ROOT = positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const notes = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));
const list = (d, f = () => true) => (exists(d) ? readdirSync(join(ROOT, d)).filter(f).sort() : []);

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return null;
  const data = {};
  let listKey = null;
  for (const line of m[1].split("\n")) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(item[1].trim());
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = kv[2] === "" ? kv[1] : null;
    data[kv[1]] = kv[2] === "" ? [] : kv[2].replace(/^"(.*)"$/, "$1");
  }
  return data;
}

// ---------------------------------------------------------------- manifest
let manifest = {};
try {
  manifest = JSON.parse(read(".claude-plugin/plugin.json"));
} catch (e) {
  err(".claude-plugin/plugin.json", `invalid JSON: ${e.message}`);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name ?? "")) err("plugin.json", "name must be kebab-case");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) err("plugin.json", "version must be semantic (x.y.z)");
const changelogTop = /^## \[(\d+\.\d+\.\d+)\]/m.exec(exists("CHANGELOG.md") ? read("CHANGELOG.md") : "")?.[1];
if (changelogTop !== manifest.version) err("CHANGELOG.md", `latest entry ${changelogTop ?? "(none)"} does not match plugin.json version ${manifest.version}`);
if (exists("package.json") && JSON.parse(read("package.json")).version !== manifest.version) err("package.json", "version does not match plugin.json");
for (const k of ["commands", "agents", "hooks"]) if (manifest[k]) notes.push(`plugin.json declares "${k}"; default folders are expected instead`);

// ---------------------------------------------------------------- components
const COMMAND_KEYS = new Set(["description", "argument-hint", "allowed-tools", "model", "disable-model-invocation", "arguments", "when_to_use"]);
const AGENT_KEYS = new Set(["name", "description", "tools", "disallowedTools", "model", "skills", "color", "effort", "maxTurns"]);
const SKILL_KEYS = new Set(["name", "description", "user-invocable", "allowed-tools", "disable-model-invocation", "when_to_use"]);
const TOOLS = new Set(["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit", "Bash", "WebFetch", "WebSearch", "NotebookEdit", "Agent", "AskUserQuestion"]);

const commands = list("commands", (f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
const agents = list("agents", (f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
const skills = list("skills", (f) => exists(`skills/${f}/SKILL.md`));

function checkKeys(where, fm, allowed) {
  for (const k of Object.keys(fm)) if (!allowed.has(k)) err(where, `unsupported frontmatter key "${k}"`);
  if (!fm.description || fm.description.length < 20) err(where, "description is missing or too short");
}

for (const c of commands) {
  const fm = frontMatter(read(`commands/${c}.md`));
  if (!fm) err(`commands/${c}.md`, "missing frontmatter");
  else checkKeys(`commands/${c}.md`, fm, COMMAND_KEYS);
}
for (const a of agents) {
  const where = `agents/${a}.md`;
  const fm = frontMatter(read(where));
  if (!fm) {
    err(where, "missing frontmatter");
    continue;
  }
  checkKeys(where, fm, AGENT_KEYS);
  if (fm.name !== a) err(where, `name "${fm.name}" must equal the file name`);
  if (typeof fm.tools === "string") for (const t of fm.tools.split(/,\s*/)) if (!TOOLS.has(t)) err(where, `unknown tool "${t}"`);
  for (const s of Array.isArray(fm.skills) ? fm.skills : []) if (!skills.includes(s)) err(where, `preloads missing skill "${s}"`);
}
for (const s of skills) {
  const where = `skills/${s}/SKILL.md`;
  const fm = frontMatter(read(where));
  if (!fm) {
    err(where, "missing frontmatter");
    continue;
  }
  checkKeys(where, fm, SKILL_KEYS);
  if (fm.name !== s) err(where, `name "${fm.name}" must equal the directory name`);
}
for (const required of ["qa-init", "qa-plan", "qa-review", "qa-approve", "qa-sync", "qa-automate", "qa-run"]) {
  if (!commands.includes(required)) err("commands", `missing /${required}`);
}
for (const required of ["requirements-analyzer", "code-analyzer", "test-designer", "qa-reviewer", "playwright-engineer"]) {
  if (!agents.includes(required)) err("agents", `missing ${required}`);
}
if (frontMatter(read("commands/qa-approve.md"))?.["disable-model-invocation"] !== "true") {
  err("commands/qa-approve.md", "must set disable-model-invocation: true (only the QA engineer may invoke approval)");
}

// ---------------------------------------------------------------- references in markdown
const MQA_COMMANDS = new Set(["config validate", "init inspect", "init apply", "plan new", "plan validate", "plan state", "plan status", "plan next-id", "lld diff", "lld baseline", "trace", "results", "fingerprint"]);
const mdFiles = [
  "README.md",
  ...list("docs", (f) => f.endsWith(".md")).map((f) => `docs/${f}`),
  ...commands.map((c) => `commands/${c}.md`),
  ...agents.map((a) => `agents/${a}.md`),
  ...skills.map((s) => `skills/${s}/SKILL.md`),
].filter(exists);

for (const f of mdFiles) {
  const text = read(f);
  for (const m of text.matchAll(/matrix-qa-plugin:([a-z0-9-]+)/g)) {
    if (!agents.includes(m[1]) && !commands.includes(m[1])) err(f, `references unknown agent/command "${m[0]}"`);
  }
  for (const m of text.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)` skill/g)) if (!skills.includes(m[1])) err(f, `references unknown skill "${m[1]}"`);
  for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+[A-Za-z0-9_])/g)) if (!exists(m[1])) err(f, `references missing file ${m[1]}`);
  for (const m of text.matchAll(/(?<![\w-])\/(qa-[a-z]+)\b/g)) if (!commands.includes(m[1])) err(f, `references unknown command /${m[1]}`);
  for (const m of text.matchAll(/(?:\bMQA|mqa\.mjs"?)\s+([a-z-]+)(?:\s+([a-z-]+))?/g)) {
    const two = `${m[1]} ${m[2] ?? ""}`.trim();
    if (!MQA_COMMANDS.has(two) && !MQA_COMMANDS.has(m[1]) && !["command", "below"].includes(m[1])) err(f, `references unknown script command "mqa.mjs ${two}"`);
  }
  for (const m of text.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) if (!existsSync(join(ROOT, dirname(f), m[1]))) err(f, `broken link ${m[1]}`);
}

// ---------------------------------------------------------------- hooks
try {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  for (const groups of Object.values(hooks.hooks ?? {})) {
    for (const g of groups) {
      for (const h of g.hooks ?? []) {
        for (const part of [h.command, ...(h.args ?? [])]) {
          const p = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(part ?? "")?.[1];
          if (p && !exists(p)) err("hooks/hooks.json", `hook script ${p} does not exist`);
        }
      }
    }
  }
} catch (e) {
  err("hooks/hooks.json", `invalid: ${e.message}`);
}

// ---------------------------------------------------------------- templates and examples (uses the real parser)
const { SECTIONS, TC_LABELS, validatePlan } = await import(join(ROOT, "scripts", "lib", "plan.mjs"));
const { validateConfig, withDefaults } = await import(join(ROOT, "scripts", "lib", "common.mjs"));
for (const lang of Object.keys(TC_LABELS)) {
  const f = `templates/test-plan.${lang}.md`;
  if (!exists(f)) {
    err(f, "missing");
    continue;
  }
  const t = read(f);
  const order = [...t.matchAll(/<!--\s*mqa:section\s+([a-z-]+)\s*-->/g)].map((m) => m[1]);
  if (order.join() !== SECTIONS.join()) err(f, `section markers must be exactly, in order: ${SECTIONS.join(", ")}`);
  for (const l of TC_LABELS[lang]) if (!t.includes(l)) err(f, `does not show the required field label "${l}"`);
}
const example = JSON.parse(read("templates/matrix-qa.config.example.json"));
const ce = validateConfig(example).errors;
if (ce.length) err("templates/matrix-qa.config.example.json", ce.join("; "));

const exampleDir = "examples/login";
if (exists(exampleDir)) {
  const tmp = mkdtempSync(join(tmpdir(), "mqa-validate-"));
  try {
    cpSync(join(ROOT, exampleDir), tmp, { recursive: true });
    writeFileSync(join(tmp, "matrix-qa.config.json"), JSON.stringify({ projectId: "example", environments: { local: { baseUrl: "http://127.0.0.1" } }, defaultEnvironment: "local" }));
    const r = validatePlan(tmp, withDefaults({ projectId: "example" }), "login");
    for (const e of r.errors) err(`${exampleDir}/qa/test-cases/login.md`, e);
    for (const w of r.warnings.filter((w) => w.startsWith("LLD_CHANGED"))) err(`${exampleDir}/qa/test-cases/login.md`, w);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- Claude Code's own validator
const cli = process.argv.includes("--no-cli") ? { error: true, skipped: true } : spawnSync("claude", ["plugin", "validate", "--strict", ROOT], { encoding: "utf8", shell: process.platform === "win32" });
let cliStatus;
if (cli.skipped) cliStatus = "SKIP claude plugin validate (--no-cli)";
else if (cli.error) cliStatus = "SKIP claude plugin validate (claude CLI not found)";
else if (cli.status === 0) cliStatus = "PASS claude plugin validate --strict";
else {
  cliStatus = "FAIL claude plugin validate --strict";
  err("claude plugin validate", (cli.stdout + cli.stderr).trim());
}

console.log(`${basename(ROOT)}: ${commands.length} commands, ${agents.length} agents, ${skills.length} skills, ${mdFiles.length} markdown files checked`);
console.log(cliStatus);
for (const n of notes) console.log(`NOTE ${n}`);
if (errors.length) {
  for (const e of errors) console.log(`FAIL ${e}`);
  console.log(`\n${errors.length} problem(s)`);
  process.exitCode = 1;
} else console.log("PASS structure and references");
