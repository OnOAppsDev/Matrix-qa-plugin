import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, gitIsReadOnly, parseGit, splitCommands, tokenize } from "../../hooks/guard.mjs";
import { CONFIG, PLUGIN } from "./helpers.mjs";

// workspace/qa-repo (Matrix QA, appSourcePath ../app) · workspace/app · workspace/other (unrelated git repo)
const ws = mkdtempSync(join(tmpdir(), "mqa-guard-"));
const qa = join(ws, "qa-repo");
const app = join(ws, "app");
const other = join(ws, "other");
for (const d of [join(qa, "qa", "test-cases", ".lld-baseline"), join(qa, "tests", "e2e"), join(qa, "tests", "pages"), join(app, "src"), other]) mkdirSync(d, { recursive: true });
writeFileSync(join(qa, "matrix-qa.config.json"), JSON.stringify({ ...CONFIG, paths: { appSourcePath: "../app" } }));
writeFileSync(join(qa, "qa", "test-cases", "approved.md"), "---\nfeature: approved\nstatus: APPROVED\n---\nbody\n");
writeFileSync(join(qa, "qa", "test-cases", "draft.md"), "---\nfeature: draft\nstatus: DRAFT\n---\nbody\n");
writeFileSync(join(qa, "tests", "e2e", "login.spec.ts"), "");
writeFileSync(join(qa, "tests", "pages", "LoginPage.ts"), "");
writeFileSync(join(qa, "playwright.config.ts"), "");

const bash = (command, cwd = qa) => evaluate({ tool_name: "Bash", cwd, tool_input: { command } });
const file = (tool_name, tool_input, cwd = qa) => evaluate({ tool_name, cwd, tool_input });
const decision = (out) => out?.hookSpecificOutput.permissionDecision ?? "allow";

test("shell parsing helpers", () => {
  assert.deepEqual(splitCommands(`cd a && git commit -m "x; y" | tee log; echo 'a|b'`), ["cd a", `git commit -m "x; y"`, "tee log", "echo 'a|b'"]);
  assert.deepEqual(tokenize(`git -C "my dir" commit -m 'msg here'`), ["git", "-C", "my dir", "commit", "-m", "msg here"]);
  assert.deepEqual(parseGit(["git", "-C", "../x", "-c", "a=b", "--no-pager", "log", "-1"]), { sub: "log", args: ["-1"], dir: "../x" });
  assert.equal(gitIsReadOnly("branch", []), true);
  assert.equal(gitIsReadOnly("branch", ["--contains", "abc"]), true);
  assert.equal(gitIsReadOnly("branch", ["new-branch"]), false);
  assert.equal(gitIsReadOnly("branch", ["-D", "x"]), false);
  assert.equal(gitIsReadOnly("stash", ["list"]), true);
  assert.equal(gitIsReadOnly("stash", []), false);
  assert.equal(gitIsReadOnly("config", ["--get", "user.name"]), true);
  assert.equal(gitIsReadOnly("config", ["user.name", "x"]), false);
});

test("git: read-only inspection allowed, every write denied, in and from the QA repo", () => {
  for (const c of ["git status", "git diff --stat", "git log -p -- qa/lld/login.md", "git --no-pager log -1 | cat", "git show HEAD:qa/lld/login.md", "git branch -a", "git -C ../app log -3"]) {
    assert.equal(decision(bash(c)), "allow", c);
  }
  for (const c of ["git commit -m x", "git push", "git merge main", "git rebase main", "git pull", "git add .", "git checkout -b x", "git reset --hard",
    "git stash", "git tag v1", "git cherry-pick abc", "echo ok && git commit -am wip", "cd qa && git push origin HEAD", "sudo git push", "GIT_DIR=x git commit", "git -c user.name=x commit"]) {
    assert.equal(decision(bash(c)), "deny", c);
  }
});

test("git: a write aimed at a QA or application repo from outside is denied; unrelated repos are untouched", () => {
  assert.equal(decision(bash(`git -C ${qa} commit -m x`, other)), "deny");
  assert.equal(decision(bash(`cd ${qa} && git push`, other)), "deny");
  assert.equal(decision(bash("git commit -m x", other)), "allow");
  assert.equal(decision(bash("git push", other)), "allow");
});

test("gh: pull request and repository writes denied, reads allowed", () => {
  assert.equal(decision(bash("gh pr create --fill")), "deny");
  assert.equal(decision(bash("gh pr merge 12")), "deny");
  assert.equal(decision(bash("gh repo create x")), "deny");
  assert.equal(decision(bash("gh pr view 12")), "allow");
  assert.equal(decision(bash("gh pr create", other)), "allow");
});

test("application source: reading allowed, writing denied", () => {
  for (const c of ["cat ../app/src/Login.tsx", "grep -rn aria-label ../app/src", "cp ../app/src/a.ts ./notes.txt", "ls ../app"]) assert.equal(decision(bash(c)), "allow", c);
  for (const c of ["echo x > ../app/src/a.ts", "rm -rf ../app/src", "mv ../app/src/a.ts .", "cp notes.txt ../app/src/", "sed -i '' s/a/b/ ../app/src/a.ts",
    "cd ../app && npm install", `touch ${app}/x`, "cat a >> ../app/b"]) {
    assert.equal(decision(bash(c)), "deny", c);
  }
  assert.equal(decision(file("Write", { file_path: join(app, "src", "a.ts"), content: "x" })), "deny");
  assert.equal(decision(file("Edit", { file_path: "../app/src/a.ts", new_string: "x" })), "deny");
  assert.equal(decision(file("Read", { file_path: join(app, "src", "a.ts") })), "allow");
});

test(".env: never read or written; .env.example is fine", () => {
  for (const c of ["cat .env", "head -5 .env.local", "grep PASS .env", "source .env"]) assert.equal(decision(bash(c)), "deny", c);
  assert.equal(decision(bash("cat .env.example")), "allow");
  assert.equal(decision(file("Read", { file_path: join(qa, ".env") })), "deny");
  assert.equal(decision(file("Grep", { pattern: "PASS", path: join(qa, ".env") })), "deny");
  assert.equal(decision(file("Write", { file_path: join(qa, ".env"), content: "A=1" })), "deny");
  assert.equal(decision(file("Read", { file_path: join(qa, ".env.example") })), "allow");
  assert.equal(decision(file("Write", { file_path: join(qa, ".env.example"), content: "MQA_X=" })), "allow");
  assert.equal(decision(file("Read", { file_path: join(app, ".env") })), "deny", "a QA session never reads secrets of other repositories either");
  assert.equal(decision(file("Read", { file_path: join(other, ".env") }, other)), "allow", "outside Matrix QA sessions and repositories the guard is inert");
});

test("approval gates: the guard forces a confirmation prompt", () => {
  const mqa = `node "${PLUGIN}/scripts/mqa.mjs"`;
  const ask = (c) => assert.equal(decision(bash(c)), "ask", c);
  ask(`${mqa} plan status login APPROVED --by "Dana Levi"`);
  ask(`${mqa} --root . plan status login APPROVED --by Dana --partial`);
  ask(`${mqa} lld baseline login --keep-approval`);
  ask(`${mqa} init apply all`);
  const reason = (c, cwd) => bash(c, cwd).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason(`${mqa} plan status login APPROVED --by "Dana Levi"`), /נדרש אישור מפורש.*מאשר\/ת: Dana Levi/, "Hebrew project: Hebrew prompt");
  const en = join(ws, "qa-en");
  mkdirSync(en);
  writeFileSync(join(en, "matrix-qa.config.json"), JSON.stringify({ ...CONFIG, language: "en" }));
  assert.match(reason(`${mqa} plan status login APPROVED --by "Dana Levi" --partial`, en), /confirmation required.*approver: Dana Levi, partial approval/, "English project: English prompt");
  for (const c of [`${mqa} plan status login REVIEWED`, `${mqa} plan status login DRAFT --reason "APPROVED earlier"`, `${mqa} lld baseline login`, `${mqa} plan validate login`]) {
    assert.equal(decision(bash(c)), "allow", c);
  }
});

test("plans: approved plans need confirmation; approval fields cannot be hand-written; baselines are script-owned", () => {
  const approved = join(qa, "qa", "test-cases", "approved.md");
  const draft = join(qa, "qa", "test-cases", "draft.md");
  assert.equal(decision(file("Edit", { file_path: approved, old_string: "body", new_string: "body2" })), "ask");
  assert.match(file("Edit", { file_path: approved, old_string: "body", new_string: "body2" }).hookSpecificOutput.permissionDecisionReason, /qa\/test-cases\/approved.md היא תוכנית בדיקות במצב APPROVED/);
  assert.equal(decision(file("Edit", { file_path: draft, old_string: "body", new_string: "body2" })), "allow");
  assert.equal(decision(file("Edit", { file_path: draft, old_string: "status: DRAFT", new_string: "status: APPROVED" })), "deny");
  assert.equal(decision(file("Write", { file_path: join(qa, "qa", "test-cases", "new.md"), content: "---\napproved_by: Dana\n---\n" })), "deny");
  assert.equal(decision(file("Write", { file_path: join(qa, "qa", "test-cases", "new.md"), content: "---\nstatus: DRAFT\napproved_by:\n---\n" })), "allow");
  assert.equal(decision(file("Write", { file_path: join(qa, "qa", "test-cases", ".lld-baseline", "login.md"), content: "x" })), "deny");
});

test("automation: existing files need confirmation, new files do not", () => {
  assert.equal(decision(file("Edit", { file_path: join(qa, "tests", "e2e", "login.spec.ts"), new_string: "x" })), "ask");
  assert.equal(decision(file("Write", { file_path: join(qa, "tests", "pages", "LoginPage.ts"), content: "x" })), "ask");
  assert.equal(decision(file("Edit", { file_path: join(qa, "playwright.config.ts"), new_string: "x" })), "ask");
  assert.equal(decision(file("Write", { file_path: join(qa, "tests", "e2e", "search.spec.ts"), content: "x" })), "allow");
  assert.equal(decision(file("Write", { file_path: join(qa, "README.md"), content: "x" })), "allow");
});

test("credentials in written content are denied", () => {
  const w = (content) => decision(file("Write", { file_path: join(qa, "tests", "e2e", "new.spec.ts"), content }));
  for (const c of ["const k = 'AKIAABCDEFGHIJKLMNOP';", "-----BEGIN RSA PRIVATE KEY-----", "await page.goto('https://admin:s3cret@qa.example.com')",
    "token = 'ghp_" + "a".repeat(36) + "'", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"]) {
    assert.equal(w(c), "deny", c);
  }
  assert.equal(w("await loginPage.login('user@example.com', 'Wrong-pass1');"), "allow");
});

test("figma: read-only tools allowed, every other Figma tool denied in QA sessions only", () => {
  const mcp = (name, cwd = qa) => decision(evaluate({ tool_name: name, cwd, tool_input: {} }));
  for (const t of ["get_design_context", "get_screenshot", "get_metadata", "create_session"]) {
    assert.equal(mcp(`mcp__plugin_matrix-qa-plugin_figma__${t}`), "allow", t);
    assert.equal(mcp(`mcp__plugin_ono-plugin-qa_figma__${t}`), "allow", `${t} via another plugin's Figma server`);
  }
  for (const t of ["use_figma", "generate_figma_design", "upload_assets", "add_code_connect_map", "some_future_write_tool"]) {
    assert.equal(mcp(`mcp__plugin_matrix-qa-plugin_figma__${t}`), "deny", t);
  }
  assert.equal(mcp("mcp__figma__use_figma"), "deny", "a user-level Figma server too");
  assert.equal(mcp("mcp__claude_ai_Figma__use_figma"), "deny", "and the claude.ai Figma connector");
  assert.equal(mcp("mcp__claude_ai_Figma__get_design_context"), "allow");
  assert.equal(mcp("mcp__plugin_matrix-qa-plugin_figma__use_figma", other), "allow", "outside QA sessions the guard is inert");
  assert.equal(mcp("mcp__claude_ai_Atlassian_MCP__authenticate"), "allow", "other MCP servers are not affected");
});

test("hook protocol: JSON on stdin, decision on stdout; garbage input is ignored", () => {
  const hook = join(PLUGIN, "hooks", "guard.mjs");
  const run = (input) => spawnSync(process.execPath, [hook], { input, encoding: "utf8" });
  const denied = run(JSON.stringify({ tool_name: "Bash", cwd: qa, tool_input: { command: "git push" } }));
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run(JSON.stringify({ tool_name: "Bash", cwd: qa, tool_input: { command: "git status" } })).stdout, "");
  assert.equal(run("not json").stdout, "");
});
