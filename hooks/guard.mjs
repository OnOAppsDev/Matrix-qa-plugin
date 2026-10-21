#!/usr/bin/env node
// PreToolUse guard for Matrix QA repositories. Active only when the session runs inside, or a
// tool targets, a repository containing matrix-qa.config.json; elsewhere it allows everything.
//
//   deny  — git writes and PR creation, any write into the read-only application source repo,
//           writing or reading local .env secret files, editing the script-owned LLD baselines,
//           content containing high-confidence credential patterns, and any Figma MCP tool that is
//           not a known read-only one (QA never changes the design).
//   ask   — recording APPROVED, keeping an approval across an LLD change, applying /qa-init
//           template changes, editing an APPROVED test plan, and changing existing automation
//           or project configuration. "ask" forces a human permission prompt.
//
// Bash inspection is a best-effort parser of common shell forms, not a sandbox: see README
// "What is and is not technically enforced". Protocol: JSON on stdin, decision JSON on stdout.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_FILE = "matrix-qa.config.json";

function findQaRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadRepo(root) {
  if (!root) return null;
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8"));
  } catch {
    // An unreadable config still marks a QA repo; defaults below apply.
  }
  const p = { lldDir: "qa/lld", testCasesDir: "qa/test-cases", testDir: "tests/e2e", pagesDir: "tests/pages", fixturesDir: "tests/fixtures", ...(cfg.paths ?? {}) };
  return { root, paths: p, language: cfg.language === "en" ? "en" : "he", appRoot: typeof p.appSourcePath === "string" && p.appSourcePath ? resolve(root, p.appSourcePath) : null };
}

// Confirmation prompts are shown to the QA engineer, so they follow the project language; refusals stay English (read by the model).
const ASK = {
  en: {
    approve: (f, by, partial) => `record APPROVED for test plan "${f}" (approver: ${by}${partial ? ", partial approval" : ""})`,
    keepApproval: (f) => `accept the changed LLD for "${f}" while keeping its approval (QA confirmed no test impact)`,
    initApply: (f) => `apply /qa-init template changes: ${f}`,
    confirm: (items) => `explicit QA engineer confirmation required to ${items.join("; ")}.`,
    approvedPlan: (p) => `${p} is an APPROVED test plan. Changing it requires the QA engineer's explicit approval, and the plan must then be re-reviewed and re-approved.`,
    existing: (p) => `${p} already exists. Changes to existing automation or project configuration require the QA engineer's explicit approval.`,
  },
  he: {
    approve: (f, by, partial) => `רישום APPROVED לתוכנית הבדיקות "${f}" (מאשר/ת: ${by}${partial ? ", אישור חלקי" : ""})`,
    keepApproval: (f) => `קבלת ה-LLD המעודכן של "${f}" תוך שמירת האישור (ה-QA אישר/ה שאין השפעה על הבדיקות)`,
    initApply: (f) => `החלת שינויי התבנית של /qa-init: ${f}`,
    confirm: (items) => `נדרש אישור מפורש של מהנדס/ת ה-QA עבור: ${items.join("; ")}.`,
    approvedPlan: (p) => `${p} היא תוכנית בדיקות במצב APPROVED. שינוי שלה דורש אישור מפורש של מהנדס/ת ה-QA, ולאחר מכן סקירה ואישור מחדש.`,
    existing: (p) => `${p} כבר קיים. שינוי באוטומציה או בהגדרות פרויקט קיימות דורש אישור מפורש של מהנדס/ת ה-QA.`,
  },
};

export function inside(child, parent) {
  if (!child || !parent) return false;
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

const decide = (permissionDecision, reason) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: `matrix-qa: ${reason}` },
});

// ------------------------------------------------------------------ shell parsing

/** Split into simple commands on ; && || | & and newlines, honouring quotes. */
export function splitCommands(cmd) {
  const out = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < cmd.length) cur += cmd[++i];
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += c + cmd[++i];
    } else if (c === ";" || c === "\n" || c === "|" || c === "&" || c === "(" || c === ")" || c === "`") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function tokenize(segment) {
  const tokens = [];
  let cur = "";
  let q = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) tokens.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

const WRAPPERS = new Set(["sudo", "command", "exec", "time", "nohup", "env", "xargs", "builtin"]);

function commandWords(tokens) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(tokens[i]) || (tokens[i].startsWith("-") && i > 0 && WRAPPERS.has(tokens[i - 1])))) i++;
  return tokens.slice(i);
}

const GIT_READ_ONLY = new Set([
  "status", "diff", "log", "show", "blame", "annotate", "ls-files", "ls-tree", "ls-remote", "rev-parse", "rev-list",
  "describe", "grep", "shortlog", "cat-file", "show-ref", "show-branch", "merge-base", "name-rev", "whatchanged",
  "check-ignore", "count-objects", "help", "version", "var",
]);
/** Sub-commands that are read-only only in their listing forms. */
const GIT_LISTING = {
  // Listing flags only, or positional patterns/commits next to a filtering flag.
  branch: (a) => listing(a, /^(-a|-r|-v|-vv|--all|--remotes|--verbose|--show-current|--no-color|--color.*|--sort=.*|--format=.*)$/, /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at)$/),
  tag: (a) => listing(a, /^(-n\d*|--sort=.*|--format=.*)$/, /^(-l|--list|--contains|--no-contains|--points-at|--merged|--no-merged)$/),
  remote: (a) => a.length === 0 || ["-v", "--verbose", "show", "get-url"].includes(a[0]),
  config: (a) => a.some((x) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(x)),
  stash: (a) => ["list", "show"].includes(a[0]),
  worktree: (a) => a[0] === "list",
  reflog: (a) => a.length === 0 || a[0] === "show",
};

function listing(args, plainFlags, filterFlags) {
  const filtered = args.some((x) => filterFlags.test(x));
  return args.every((x) => plainFlags.test(x) || filterFlags.test(x) || (filtered && !x.startsWith("-")));
}

/** Returns { sub, dir } for a git invocation; dir is the -C directory when given. */
export function parseGit(words) {
  let i = 1;
  let dir = null;
  while (i < words.length && words[i].startsWith("-")) {
    const w = words[i];
    if (w === "-C" || w === "-c" || w === "--git-dir" || w === "--work-tree" || w === "--namespace") {
      if (w === "-C") dir = words[i + 1] ?? null;
      i += 2;
    } else i++;
  }
  return { sub: words[i] ?? null, args: words.slice(i + 1), dir };
}

export function gitIsReadOnly(sub, args) {
  if (sub === null || sub === "--version" || sub === "--help") return true;
  if (GIT_READ_ONLY.has(sub)) return true;
  return GIT_LISTING[sub]?.(args) ?? false;
}

const GH_WRITE = /^(create|merge|close|reopen|edit|delete|comment|review|ready|fork|rename|archive|transfer|lock|unlock|upload|sync)$/;
const READERS = new Set(["cat", "less", "more", "head", "tail", "bat", "nl", "strings", "xxd", "od", "hexdump", "grep", "egrep", "rg", "awk", "sed", "source", ".", "type", "get-content", "gc", "cut", "sort", "diff", "base64"]);
const WRITERS = new Set(["rm", "rmdir", "mv", "touch", "mkdir", "chmod", "chown", "ln", "tee", "truncate", "dd", "install", "unlink", "rsync", "npm", "npx", "yarn", "pnpm", "bun", "patch", "git"]);

export const isSecretEnvFile = (p) => /^\.env(\..+)?$/.test(basename(p)) && basename(p) !== ".env.example";

function checkBash(command, cwd, session) {
  let vcwd = cwd;
  const asks = [];
  let ask = ASK[session?.language ?? "he"];
  for (const segment of splitCommands(command)) {
    const words = commandWords(tokenize(segment));
    if (!words.length) continue;
    const prog = basename(words[0]).toLowerCase().replace(/\.exe$/, "");

    if (prog === "cd" && words[1]) {
      vcwd = resolve(vcwd, words[1].replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
      continue;
    }
    const here = loadRepo(findQaRoot(vcwd));
    const repos = [session, here].filter(Boolean);
    const appRoots = repos.map((r) => r.appRoot).filter(Boolean);
    const inApp = (p) => appRoots.some((a) => inside(resolve(vcwd, p), a));

    if (prog === "git") {
      const { sub, args, dir } = parseGit(words);
      const target = loadRepo(findQaRoot(dir ? resolve(vcwd, dir) : vcwd));
      if (!gitIsReadOnly(sub, args) && (session || target || (dir ? inApp(dir) : inApp(".")))) {
        return decide("deny", `"git ${sub}" is not allowed. The QA engineer performs every git write (commit, push, merge, rebase, checkout, reset, …) — only read-only inspection such as status, diff and log is permitted.`);
      }
    }
    if (prog === "gh" && (session || here) && ["pr", "repo", "release", "issue"].includes(words[1]) && GH_WRITE.test(words[2] ?? "")) {
      return decide("deny", `"gh ${words[1]} ${words[2]}" is not allowed: pull requests and repository changes are made by the QA engineer.`);
    }
    if ((session || here) && READERS.has(prog) && words.slice(1).some((w) => isSecretEnvFile(w))) {
      return decide("deny", "local .env files hold credentials and must not be printed. Use .env.example to see which variables exist.");
    }
    if (appRoots.length) {
      const args = words.slice(1).filter((w) => !w.startsWith("-"));
      const writesApp =
        (WRITERS.has(prog) && prog !== "git" && (inApp(".") || args.some(inApp))) ||
        (prog === "cp" && args.length > 1 && inApp(args.at(-1))) ||
        ((prog === "sed" || prog === "perl") && words.some((w) => /^-i/.test(w) || w === "--in-place") && args.some(inApp));
      const redirects = [...segment.matchAll(/(?:^|[^0-9&])>{1,2}\s*([^\s;&|]+)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, ""));
      if (writesApp || redirects.some((r) => r !== "/dev/null" && inApp(r))) {
        return decide("deny", "the application source repository is read-only for QA work; it may be read but never modified.");
      }
    }
    const script = words.findIndex((w) => /mqa\.mjs$/.test(w));
    if (script !== -1) {
      ask = ASK[(here ?? session)?.language ?? "he"];
      const [g, a, f, s] = positionals(words.slice(script + 1));
      if (g === "plan" && a === "status" && s === "APPROVED") asks.push(ask.approve(f, flag(words, "--by") ?? "?", words.includes("--partial")));
      if (g === "lld" && a === "baseline" && words.includes("--keep-approval")) asks.push(ask.keepApproval(f));
      if (g === "init" && a === "apply") asks.push(ask.initApply(f ?? "?"));
    }
  }
  if (asks.length) return decide("ask", ask.confirm(asks));
  return null;
}

const VALUE_FLAGS = new Set(["--root", "--by", "--reason", "--feature-id", "--title", "--count"]);

function positionals(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].startsWith("--")) {
      if (VALUE_FLAGS.has(words[i])) i++;
    } else out.push(words[i]);
  }
  return out;
}

function flag(words, name) {
  const i = words.findIndex((w) => w === name || w.startsWith(name + "="));
  if (i === -1) return null;
  return words[i].includes("=") ? words[i].split("=").slice(1).join("=") : words[i + 1];
}

const SECRET_PATTERNS = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Stripe live key", /\bsk_live_[A-Za-z0-9]{16,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["credentials in a URL", /\bhttps?:\/\/[^\s/:@'"`]+:[^\s/@'"`]+@/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
];

export function findSecret(text) {
  return SECRET_PATTERNS.find(([, re]) => re.test(text ?? ""))?.[0] ?? null;
}

function contentOf(tool, input) {
  if (tool === "Write") return input.content;
  if (tool === "Edit") return input.new_string;
  if (tool === "MultiEdit") return (input.edits ?? []).map((e) => e.new_string).join("\n");
  if (tool === "NotebookEdit") return input.new_source;
  return "";
}

function readStatus(file) {
  try {
    return /^---\r?\n[\s\S]*?^status:\s*"?([A-Z_]+)"?\s*$/m.exec(readFileSync(file, "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

function checkFile(tool, input, cwd, session) {
  const raw = input.file_path ?? input.notebook_path ?? input.path;
  if (!raw) return null;
  const abs = resolve(cwd, raw);
  const own = loadRepo(findQaRoot(dirname(abs)));
  const repos = [session, own].filter(Boolean);
  if (!repos.length) return null;

  if (tool === "Read" || tool === "Grep") {
    return isSecretEnvFile(abs) ? decide("deny", "local .env files hold credentials and must not be read into the conversation. Use .env.example to see which variables exist.") : null;
  }
  if (repos.some((r) => r.appRoot && inside(abs, r.appRoot))) {
    return decide("deny", `${raw} is in the application source repository, which is read-only for QA work.`);
  }
  if (!own) return null;
  const relPath = relative(own.root, abs).split(sep).join("/");
  if (isSecretEnvFile(abs)) return decide("deny", "local .env files are maintained by the QA engineer by hand; only .env.example may be written.");
  if (inside(abs, join(own.root, own.paths.testCasesDir, ".lld-baseline"))) {
    return decide("deny", "LLD baseline snapshots are written only by `mqa.mjs lld baseline` / `plan new`.");
  }
  const content = contentOf(tool, input);
  const isPlan = inside(abs, join(own.root, own.paths.testCasesDir)) && abs.endsWith(".md");
  if (isPlan && /^\s*(status:\s*"?APPROVED\b|approved_(by|at|fingerprint):[ \t]*\S)/m.test(content ?? "")) {
    return decide("deny", "approval is recorded only by `mqa.mjs plan status <feature> APPROVED` through /qa-approve; never write approval fields by hand. To change an approved plan, first move it to DRAFT with a reason.");
  }
  const secret = findSecret(content);
  if (secret) return decide("deny", `the content contains what looks like a ${secret}. Credentials belong in environment variables (.env / CI secrets), never in the repository.`);
  if (!existsSync(abs)) return null;
  if (isPlan && readStatus(abs) === "APPROVED") {
    return decide("ask", ASK[own.language].approvedPlan(relPath));
  }
  const automation = [own.paths.testDir, own.paths.pagesDir, own.paths.fixturesDir].some((d) => inside(abs, join(own.root, d)));
  const projectConfig = ["playwright.config.ts", "playwright.config.js", CONFIG_FILE, "package.json", "tsconfig.json"].includes(relPath);
  if (automation || projectConfig) {
    return decide("ask", ASK[own.language].existing(relPath));
  }
  return null;
}

// Allowlist, so write tools Figma adds later are denied by default.
export const FIGMA_READ_TOOLS = new Set(["create_session", "whoami", "get_metadata", "get_design_context", "get_screenshot", "get_variable_defs", "get_figjam"]);

export function evaluate(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input ?? {};
  const cwd = payload.cwd || process.cwd();
  const session = loadRepo(findQaRoot(cwd));
  const figma = /^mcp__.*figma.*__(\w+)$/i.exec(tool ?? "");
  if (figma) {
    return session && !FIGMA_READ_TOOLS.has(figma[1]) ? decide("deny", `Figma is read-only for QA work; "${figma[1]}" is not a read-only Figma tool.`) : null;
  }
  if (tool === "Bash" || tool === "PowerShell") return checkBash(String(input.command ?? ""), cwd, session);
  if (["Write", "Edit", "MultiEdit", "NotebookEdit", "Read", "Grep"].includes(tool)) return checkFile(tool, input, cwd, session);
  return null;
}

function main() {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return; // not a hook payload; allow
    }
    try {
      const out = evaluate(payload);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (e) {
      // Fail towards a human: a guard error never silently allows a write.
      if (!["Read", "Grep"].includes(payload.tool_name)) process.stdout.write(JSON.stringify(decide("ask", `guard error (${e.message}); please confirm this action manually.`)));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
