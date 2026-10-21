// /qa-init support: inspect a repository read-only, and apply only approved, non-destructive changes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, UsageError, loadConfig, normalizeText, rel, validateConfig } from "./common.mjs";

export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "project");

/** Template file → target path. Dotfiles are stored without the dot so git and tooling ignore them in the plugin. */
const RENAMES = { gitignore: ".gitignore", "env.example": ".env.example" };
/** Existing files that are merged additively instead of skipped. */
const MERGEABLE = new Set(["package.json", ".gitignore"]);
const PLAYWRIGHT_CONFIGS = ["ts", "js", "mjs", "cjs", "mts", "cts"].map((e) => `playwright.config.${e}`);

export function templateFiles(dir = TEMPLATE_DIR, prefix = "") {
  const out = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...templateFiles(dir, p));
    else out.push({ template: p, target: RENAMES[p] ?? p });
  }
  return out.sort((a, b) => a.target.localeCompare(b.target));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function findSpecs(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "playwright-report", "test-results"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findSpecs(root, p, out);
    else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(e.name)) out.push(rel(root, p));
  }
  return out;
}

/** Read-only report of the repository and what initialisation would change. */
export function inspect(root) {
  const pkgPath = join(root, "package.json");
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) : null;
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const pwConfigs = PLAYWRIGHT_CONFIGS.filter((f) => existsSync(join(root, f)));
  const pwConfigText = pwConfigs[0] ? readFileSync(join(root, pwConfigs[0]), "utf8") : "";
  const specs = findSpecs(root);
  const pageDirs = findDirs(root).filter((p) => /(^|\/)(pages|page-objects|pom)$/i.test(p));
  const cfgPath = join(root, CONFIG_FILE);
  let matrixConfig = { exists: existsSync(cfgPath) };
  if (matrixConfig.exists) {
    const raw = readJson(cfgPath);
    matrixConfig = raw === undefined ? { exists: true, errors: ["not valid JSON"], warnings: [] } : { exists: true, ...validateConfig(raw, root) };
  }

  const files = templateFiles().map(({ template, target }) => {
    const abs = join(root, target);
    if (!existsSync(abs)) return { target, action: "create" };
    if (MERGEABLE.has(target)) return { target, action: "merge", details: mergePreview(target, abs, template) };
    const same = normalizeText(readFileSync(abs, "utf8")) === normalizeText(readFileSync(join(TEMPLATE_DIR, template), "utf8"));
    return { target, action: same ? "identical" : "conflict" };
  });
  const conflicts = files.filter((f) => f.action === "conflict").map((f) => f.target);
  if (pwConfigs.some((f) => f !== "playwright.config.ts")) conflicts.push(...pwConfigs.filter((f) => f !== "playwright.config.ts"));

  return {
    root,
    packageJson: pkg === null ? null : pkg === undefined ? "invalid JSON" : { name: pkg.name, type: pkg.type ?? "commonjs", scripts: Object.keys(pkg.scripts ?? {}) },
    playwright: {
      installedVersion: deps["@playwright/test"] ?? null,
      configFiles: pwConfigs,
      configuredTestDir: /testDir\s*:\s*['"`]([^'"`]+)/.exec(pwConfigText)?.[1] ?? null,
      readsMatrixConfig: pwConfigText.includes(CONFIG_FILE) || pwConfigText.includes("fixtures/environment"),
    },
    existingSpecs: { count: specs.length, sample: specs.slice(0, 15) },
    pageObjectDirs: pageDirs,
    matrixConfig,
    files,
    conflicts,
    migrationProposalNeeded: conflicts.length > 0 || (pwConfigs.length > 0 && !files.find((f) => f.target === "playwright.config.ts" && f.action === "identical")),
  };
}

function findDirs(root, dir = root, out = [], depth = 0) {
  if (depth > 4) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || ["node_modules", ".git"].includes(e.name)) continue;
    const p = join(dir, e.name);
    out.push(rel(root, p));
    findDirs(root, p, out, depth + 1);
  }
  return out;
}

function mergePreview(target, abs, template) {
  const tpl = readFileSync(join(TEMPLATE_DIR, template), "utf8");
  if (target === ".gitignore") {
    const have = new Set(readFileSync(abs, "utf8").split(/\r?\n/).map((l) => l.trim()));
    return { add: tpl.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !have.has(l)) };
  }
  const cur = readJson(abs);
  if (!cur) return { error: "package.json is not valid JSON; it will not be touched" };
  return mergePackage(cur, JSON.parse(tpl)).report;
}

/** Additive only: missing scripts and devDependencies are added; existing values are never changed. */
export function mergePackage(cur, tpl) {
  const next = structuredClone(cur);
  const report = { addScripts: [], addDevDependencies: [], keptDifferent: [] };
  for (const key of ["scripts", "devDependencies"]) {
    for (const [k, v] of Object.entries(tpl[key] ?? {})) {
      const existing = cur[key]?.[k] ?? (key === "devDependencies" ? cur.dependencies?.[k] : undefined);
      if (existing === undefined) {
        next[key] = { ...(next[key] ?? {}), [k]: v };
        report[key === "scripts" ? "addScripts" : "addDevDependencies"].push(`${k}: ${v}`);
      } else if (existing !== v) report.keptDifferent.push(`${key}.${k}: keeps "${existing}" (template: "${v}")`);
    }
  }
  if (!cur.engines?.node && tpl.engines?.node) next.engines = { ...(cur.engines ?? {}), node: tpl.engines.node };
  return { next, report };
}

/**
 * Create the approved files. Never overwrites: an existing non-mergeable file is reported as skipped.
 * Requires matrix-qa.config.json, so directories follow the project's configured paths.
 */
export function apply(root, targets) {
  if (!existsSync(join(root, CONFIG_FILE))) throw new UsageError(`write and validate ${CONFIG_FILE} before applying template files`);
  const config = loadConfig(root);
  const all = templateFiles();
  const wanted = targets.includes("all") ? all : targets.map((t) => all.find((f) => f.target === t) ?? t);
  const unknown = wanted.filter((w) => typeof w === "string");
  if (unknown.length) throw new UsageError(`not template files: ${unknown.join(", ")}. Available: ${all.map((f) => f.target).join(", ")}`);
  const result = { created: [], merged: [], skipped: [], directories: [] };

  for (const { template, target } of wanted) {
    const abs = join(root, target);
    const tpl = readFileSync(join(TEMPLATE_DIR, template), "utf8");
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true });
      const content = target === "package.json" ? tpl.replace('"qa-project"', JSON.stringify(config.projectId + "-qa")) : tpl;
      writeFileSync(abs, content);
      result.created.push(target);
    } else if (target === ".gitignore") {
      const cur = readFileSync(abs, "utf8");
      const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
      const add = tpl.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !have.has(l.trim()));
      if (add.length) {
        writeFileSync(abs, cur.replace(/\n*$/, "\n") + "\n# Matrix QA\n" + add.join("\n") + "\n");
        result.merged.push({ target, added: add });
      } else result.skipped.push({ target, reason: "already contains every entry" });
    } else if (target === "package.json") {
      const cur = readJson(abs);
      if (!cur) {
        result.skipped.push({ target, reason: "existing package.json is not valid JSON" });
        continue;
      }
      const { next, report } = mergePackage(cur, JSON.parse(tpl));
      if (JSON.stringify(next) !== JSON.stringify(cur)) {
        writeFileSync(abs, JSON.stringify(next, null, 2) + "\n");
        result.merged.push({ target, ...report });
      } else result.skipped.push({ target, reason: "nothing to add", ...report });
    } else {
      const same = normalizeText(readFileSync(abs, "utf8")) === normalizeText(tpl);
      result.skipped.push({ target, reason: same ? "identical" : "exists and differs — never overwritten; see the migration proposal" });
    }
  }

  const p = config.paths;
  for (const d of [p.lldDir, p.testCasesDir, `${p.testCasesDir}/.lld-baseline`, p.testDir, p.pagesDir, p.fixturesDir]) {
    const abs = join(root, d);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
      result.directories.push(d);
    }
    if (!readdirSync(abs).length) writeFileSync(join(abs, ".gitkeep"), "");
  }
  return result;
}

