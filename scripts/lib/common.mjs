// Shared primitives: hashing, front matter, QA-repo discovery and config validation.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

export const CONFIG_FILE = "matrix-qa.config.json";
export const STATUSES = ["DRAFT", "REVIEWED", "APPROVED", "CHANGES_REQUIRED"];
export const BROWSERS = ["chromium", "firefox", "webkit"];
export const LANGUAGES = ["he", "en"];

export const DEFAULT_PATHS = {
  lldDir: "qa/lld",
  testCasesDir: "qa/test-cases",
  testDir: "tests/e2e",
  pagesDir: "tests/pages",
  fixturesDir: "tests/fixtures",
};

export class UsageError extends Error {}

/** Line endings, trailing whitespace and a BOM never count as a change. */
export function normalizeText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

export function fingerprint(text) {
  return "sha256:" + createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
}

export function fingerprintFile(path) {
  return fingerprint(readFileSync(path, "utf8"));
}

/** Flat `key: value` front matter only — values are plain strings. */
export function parseFrontMatter(text) {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { data: null, body: src, order: [] };
  const data = {};
  const order = [];
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (!kv) continue;
    data[kv[1]] = unquote(kv[2].trim());
    order.push(kv[1]);
  }
  return { data, body: src.slice(m[0].length), order };
}

function unquote(v) {
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function serializeFrontMatter(data, order = []) {
  const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))];
  const lines = keys.map((k) => {
    const v = data[k] ?? "";
    // Quote anything YAML could misread (":" "#" leading specials), so editors and linters agree.
    const needsQuote = v !== "" && /[:#]|^[\s'"\[\]{}>|*&!%@`]/.test(v);
    return v === "" ? `${k}:` : `${k}: ${needsQuote ? JSON.stringify(v) : v}`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Walk up from `start` to the directory holding matrix-qa.config.json. */
export function findQaRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireQaRoot(start) {
  const root = findQaRoot(start);
  if (!root) throw new UsageError(`No ${CONFIG_FILE} found in ${resolve(start ?? ".")} or any parent. Run /qa-init first.`);
  return root;
}

export function loadConfig(root) {
  const path = join(root, CONFIG_FILE);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
  }
  const { errors } = validateConfig(raw, root);
  if (errors.length) throw new UsageError(`${CONFIG_FILE} is invalid:\n- ${errors.join("\n- ")}`);
  return withDefaults(raw);
}

export function withDefaults(raw) {
  return { language: "he", ...raw, paths: { ...DEFAULT_PATHS, ...(raw.paths ?? {}) } };
}

const KNOWN_KEYS = ["$schema", "projectId", "language", "paths", "environments", "defaultEnvironment", "browsers", "devices", "defaultProjects"];
const KNOWN_PATH_KEYS = [...Object.keys(DEFAULT_PATHS), "appSourcePath"];
const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|credential/i;

/** Returns { errors, warnings }. `root` enables filesystem checks. */
export function validateConfig(raw, root) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["config must be a JSON object"], warnings };

  for (const k of Object.keys(raw)) if (!KNOWN_KEYS.includes(k)) warnings.push(`unknown key "${k}" is ignored`);
  scanSecretKeys(raw, "", errors);

  if (typeof raw.projectId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(raw.projectId)) {
    errors.push(`projectId must be lower-case kebab-case (e.g. "acme-portal")`);
  }
  if (raw.language !== undefined && !LANGUAGES.includes(raw.language)) {
    errors.push(`language must be one of ${LANGUAGES.join(", ")} (default "he")`);
  }

  const paths = { ...DEFAULT_PATHS, ...(raw.paths ?? {}) };
  if (raw.paths !== undefined && (typeof raw.paths !== "object" || Array.isArray(raw.paths))) errors.push("paths must be an object");
  for (const k of Object.keys(raw.paths ?? {})) if (!KNOWN_PATH_KEYS.includes(k)) warnings.push(`unknown key "paths.${k}" is ignored`);
  for (const k of Object.keys(DEFAULT_PATHS)) {
    const v = paths[k];
    if (typeof v !== "string" || !v || isAbsolute(v) || v.split(/[\\/]/).includes("..")) {
      errors.push(`paths.${k} must be a relative path inside the QA repository`);
    }
  }
  if (paths.appSourcePath !== undefined && paths.appSourcePath !== null) {
    if (typeof paths.appSourcePath !== "string" || !paths.appSourcePath) {
      errors.push("paths.appSourcePath must be a non-empty string when set");
    } else if (root) {
      const app = resolve(root, paths.appSourcePath);
      const within = (child, parent) => {
        const r = relative(parent, child);
        return r === "" || (!r.startsWith("..") && !isAbsolute(r));
      };
      if (within(app, root)) {
        errors.push("paths.appSourcePath must point outside the QA repository (it is the read-only application repository)");
      } else if (within(root, app)) {
        errors.push("the QA repository must not be inside the application repository (paths.appSourcePath); keep them side by side");
      } else if (!existsSync(app) || !statSync(app).isDirectory()) {
        warnings.push(`paths.appSourcePath "${paths.appSourcePath}" does not exist on this machine; source analysis will be skipped`);
      }
    }
  }

  const envs = raw.environments;
  if (!envs || typeof envs !== "object" || Array.isArray(envs) || !Object.keys(envs).length) {
    errors.push("environments must define at least one environment");
  } else {
    for (const [name, env] of Object.entries(envs)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`environment name "${name}" must be lower-case kebab-case`);
      if (!env || typeof env !== "object") {
        errors.push(`environments.${name} must be an object`);
        continue;
      }
      let url;
      try {
        url = new URL(env.baseUrl);
      } catch {
        errors.push(`environments.${name}.baseUrl must be an absolute http(s) URL`);
        continue;
      }
      if (!/^https?:$/.test(url.protocol)) errors.push(`environments.${name}.baseUrl must use http or https`);
      if (url.username || url.password) errors.push(`environments.${name}.baseUrl must not contain credentials`);
      if (env.protected !== undefined && typeof env.protected !== "boolean") errors.push(`environments.${name}.protected must be true or false`);
      for (const k of Object.keys(env)) if (!["baseUrl", "protected", "description"].includes(k)) warnings.push(`unknown key "environments.${name}.${k}" is ignored`);
    }
    if (raw.defaultEnvironment === undefined) errors.push("defaultEnvironment is required");
    else if (!(raw.defaultEnvironment in envs)) errors.push(`defaultEnvironment "${raw.defaultEnvironment}" is not defined in environments`);
    else if (envs[raw.defaultEnvironment]?.protected) errors.push(`defaultEnvironment "${raw.defaultEnvironment}" is protected; choose a non-protected default`);
  }

  const browsers = raw.browsers ?? ["chromium"];
  if (!Array.isArray(browsers) || !browsers.length) errors.push("browsers must be a non-empty array");
  else for (const b of browsers) if (!BROWSERS.includes(b)) errors.push(`browser "${b}" is not one of ${BROWSERS.join(", ")}`);

  const devices = raw.devices ?? {};
  if (typeof devices !== "object" || Array.isArray(devices)) errors.push("devices must be an object of { projectName: playwrightDeviceName }");
  else {
    const known = root ? playwrightDeviceNames(root) : null;
    for (const [name, d] of Object.entries(devices)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`device project name "${name}" must be lower-case kebab-case`);
      if (BROWSERS.includes(name)) errors.push(`device project name "${name}" collides with a browser project`);
      if (typeof d !== "string" || !d) errors.push(`devices.${name} must be a Playwright device name such as "Pixel 7"`);
      else if (known && !known.has(d)) errors.push(`devices.${name}: "${d}" is not a Playwright device name (see playwright devices list)`);
    }
    if (!known && Object.keys(devices).length) warnings.push("device names were not checked: @playwright/test is not installed yet");
  }

  const projects = new Set([...(Array.isArray(browsers) ? browsers : []), ...Object.keys(typeof devices === "object" && devices ? devices : {})]);
  const def = raw.defaultProjects ?? ["chromium"];
  if (!Array.isArray(def) || !def.length) errors.push("defaultProjects must be a non-empty array");
  else for (const p of def) if (!projects.has(p)) errors.push(`defaultProjects entry "${p}" is neither a configured browser nor a device project`);

  return { errors, warnings };
}

function scanSecretKeys(obj, prefix, errors) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (SECRET_KEY.test(k)) errors.push(`"${path}" looks like a credential; credentials belong in environment variables (.env), never in ${CONFIG_FILE}`);
    if (v && typeof v === "object") scanSecretKeys(v, path, errors);
  }
}

function playwrightDeviceNames(root) {
  try {
    const req = createRequire(join(root, "package.json"));
    return new Set(Object.keys(req("@playwright/test").devices));
  } catch {
    return null;
  }
}

/** All per-feature paths, absolute. */
export function featurePaths(root, config, feature) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(feature)) throw new UsageError(`feature "${feature}" must be a kebab-case slug (the LLD file name without .md)`);
  const p = config.paths;
  return {
    plan: join(root, p.testCasesDir, `${feature}.md`),
    lld: join(root, p.lldDir, `${feature}.md`),
    baseline: join(root, p.testCasesDir, ".lld-baseline", `${feature}.md`),
  };
}

export function rel(root, abs) {
  return relative(root, abs).split("\\").join("/");
}
