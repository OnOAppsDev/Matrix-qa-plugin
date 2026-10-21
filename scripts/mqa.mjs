#!/usr/bin/env node
// Matrix QA helper — the deterministic part of the plugin. Zero dependencies, Node >= 20.
// Every command prints JSON on stdout. Exit codes: 0 ok, 1 checks failed, 2 usage error or a refused gate (reason in "error").
//
//   node mqa.mjs config validate
//   node mqa.mjs init inspect
//   node mqa.mjs init apply <file,...|all>
//   node mqa.mjs plan new <feature> [--feature-id LOGIN] [--title "..."]
//   node mqa.mjs plan validate <feature>
//   node mqa.mjs plan state <feature>
//   node mqa.mjs plan status <feature> <DRAFT|REVIEWED|APPROVED|CHANGES_REQUIRED> [--by name] [--reason text] [--partial]
//   node mqa.mjs plan next-id <feature> <TC|REQ|Q|RF> [--count n]
//   node mqa.mjs lld diff <feature>
//   node mqa.mjs lld baseline <feature> [--keep-approval]
//   node mqa.mjs trace <feature>
//   node mqa.mjs results [report.json]
//   node mqa.mjs fingerprint <file>
//
// --root <dir> selects the QA repository (default: nearest parent of cwd holding matrix-qa.config.json).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, UsageError, fingerprintFile, loadConfig, requireQaRoot, validateConfig } from "./lib/common.mjs";
import { approvalState, newPlan, nextIds, setStatus, validatePlan } from "./lib/plan.mjs";
import { lldImpact, recordBaseline } from "./lib/lld.mjs";
import { secretValues, summarizeReport, traceAutomation } from "./lib/automation.mjs";
import { apply, inspect } from "./lib/init.mjs";

const PLUGIN_VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8")).version;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (inline !== undefined) opts[k] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

function need(v, what) {
  if (!v || v === true) throw new UsageError(`missing ${what}`);
  return v;
}

function run(argv) {
  const { pos, opts } = parseArgs(argv);
  const [group, action, ...rest] = pos;
  const start = typeof opts.root === "string" ? resolve(opts.root) : process.cwd();
  const ctx = () => {
    const root = requireQaRoot(start);
    return { root, config: loadConfig(root) };
  };

  // Single-word commands take their argument in the second position.
  const key = ["results", "fingerprint", "trace"].includes(group) ? group : `${group} ${action ?? ""}`.trim();
  switch (key) {
    case "config validate": {
      const root = requireQaRoot(start);
      let raw;
      try {
        raw = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8"));
      } catch (e) {
        return [1, { ok: false, errors: [`${CONFIG_FILE} is not valid JSON: ${e.message}`], warnings: [] }];
      }
      const r = validateConfig(raw, root);
      return [r.errors.length ? 1 : 0, { ok: !r.errors.length, root, ...r }];
    }
    case "init inspect":
      return [0, inspect(start)];
    case "init apply": {
      const files = need(rest[0], "file list (comma-separated template targets, or 'all')").split(",").map((s) => s.trim()).filter(Boolean);
      return [0, apply(start, files)];
    }
    case "plan new": {
      const { root, config } = ctx();
      return [0, newPlan(root, config, need(rest[0], "feature"), { featureId: opts["feature-id"], title: opts.title, version: PLUGIN_VERSION })];
    }
    case "plan validate": {
      const { root, config } = ctx();
      const r = validatePlan(root, config, need(rest[0], "feature"));
      return [r.errors.length ? 1 : 0, { ok: !r.errors.length, ...r }];
    }
    case "plan state": {
      const { root, config } = ctx();
      const s = approvalState(root, config, need(rest[0], "feature"));
      return [0, { feature: rest[0], status: s.plan.meta.status, effectiveApproval: s.effective, reason: s.reason, excluded: s.excluded ?? [] }];
    }
    case "plan status": {
      const { root, config } = ctx();
      const by = typeof opts.by === "string" ? opts.by : undefined;
      const reason = typeof opts.reason === "string" ? opts.reason : undefined;
      return [0, setStatus(root, config, need(rest[0], "feature"), need(rest[1], "status"), { by, reason, partial: opts.partial === true })];
    }
    case "plan next-id": {
      const { root, config } = ctx();
      const count = opts.count ? Number(opts.count) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 200) throw new UsageError("--count must be 1..200");
      return [0, { ids: nextIds(root, config, need(rest[0], "feature"), need(rest[1], "kind"), count) }];
    }
    case "lld diff": {
      const { root, config } = ctx();
      return [0, lldImpact(root, config, need(rest[0], "feature"))];
    }
    case "lld baseline": {
      const { root, config } = ctx();
      return [0, recordBaseline(root, config, need(rest[0], "feature"), { keepApproval: opts["keep-approval"] === true })];
    }
    case "results": {
      const root = requireQaRoot(start);
      const path = resolve(start, action ?? join(root, "test-results", "results.json"));
      if (!existsSync(path)) throw new UsageError(`no Playwright JSON report at ${path}; run the tests first (the JSON reporter is configured in playwright.config.ts)`);
      const report = JSON.parse(readFileSync(path, "utf8"));
      const s = summarizeReport(report, root, { secrets: secretValues(root) });
      return [s.totals.failed || s.globalErrors.length ? 1 : 0, s];
    }
    case "fingerprint":
      return [0, { file: action, fingerprint: fingerprintFile(resolve(start, need(action, "file"))) }];
    case "trace": {
      const { root, config } = ctx();
      const t = traceAutomation(root, config, need(action, "feature"));
      return [t.issues.length ? 1 : 0, t];
    }
    default:
      throw new UsageError(`unknown command "${pos.join(" ")}". See the header of scripts/mqa.mjs.`);
  }
}

try {
  const [code, out] = run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exitCode = code;
} catch (e) {
  const usage = e instanceof UsageError;
  process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + "\n");
  if (!usage) process.stderr.write(e.stack + "\n");
  process.exitCode = usage ? 2 : 1;
}
