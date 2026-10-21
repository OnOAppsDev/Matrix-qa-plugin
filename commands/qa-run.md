---
description: Run Playwright tests with the standard CLI — environment, browser/device project, feature or file, or all — then summarise results and analyse failures (application, automation, environment or test data) without changing code.
argument-hint: "[feature|spec-file|all] [--env name] [--project name|all] [--grep text]"
---

# /qa-run

Run Playwright tests. Arguments: `$ARGUMENTS`.

`MQA` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Analysis method: the `failure-analysis` skill.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 1. Resolve the run

From the arguments and `matrix-qa.config.json` (ask only for what is unclear):

| Choice | Maps to |
|---|---|
| environment | `MQA_ENV=<name>` (default `defaultEnvironment`) |
| browser / device | `--project=<name>` for one configured project (`chromium`, `firefox`, `webkit`, or a device project such as `mobile-chrome`, `tablet`); `MQA_PROJECTS=all` or a comma list for several; nothing = `defaultProjects` |
| desktop / tablet / mobile | the configured browser projects / the tablet device projects / the mobile device projects |
| feature | `tests/e2e/<feature>.spec.ts`, or `--grep "<FEATURE_ID>-TC-"` |
| file / test case | the spec path, or `--grep "LOGIN-TC-007"` |
| all | no filter |

**Protected environments** (`"protected": true`, e.g. production): explain the risk, ask for explicit confirmation with `AskUserQuestion`, and only then add `MQA_CONFIRM_PROTECTED=<name>`. Without it, the Playwright config itself refuses to start.

Check before running: `node_modules/@playwright/test` exists (otherwise give `npm install && npx playwright install` and stop); `.env.example` lists variables — tell the QA engineer which ones the selected tests need, by name only. Never read or print `.env`.

## 2. Run

Standard Playwright CLI only, from the QA repository root, for example:

```bash
MQA_ENV=staging npx playwright test tests/e2e/login.spec.ts --project=chromium
MQA_PROJECTS=chromium,mobile-chrome,tablet npx playwright test --grep "LOGIN-TC-"
```

(On Windows PowerShell: `$env:MQA_ENV="staging"; npx playwright test …`.) Use a timeout suitable for the suite. Do not pass `--reporter` (it replaces the configured reporters, so no HTML report or `results.json` is written). Do not change `playwright.config.ts` or any test to make a run pass.

## 3. Summarise

`MQA results` (reads `test-results/results.json` from the JSON reporter; secret values are redacted). Report passed / failed / flaky / skipped per project and the failed scenarios with their manual test case IDs.

## 4. Analyse failures

For each failure follow `failure-analysis`: error output, failing line, screenshot (read the image), trace when needed, the manual test case and the LLD. Classify as **application defect**, **automation defect**, **environment problem** or **test data problem** (or undetermined, with what would decide it), with confidence and a recommended fix.

## 5. Report

The summary table, per-failure analysis, flaky tests, and next steps (e.g. "report LOGIN-TC-007 to development", "update the locator in `LoginPage` via `/qa-automate`"). Name this run's HTML report folder — the last line of `npm run report -- --list` (`playwright-report/<feature>/<date>_<time>-<environment>-<projects>`; every run keeps its own folder, grouped by the feature its spec file or `--grep` names, `all` otherwise). **Never modify test code, page objects, fixtures or application code** in this command, and do not create bug tickets.

## 6. Open the report

Ask with `AskUserQuestion`: "Open the report" / "Not now". On "Open the report", run `npm run report` in the background (it serves the latest run's report and opens it in the browser at `http://localhost:9323`) and say it keeps running until stopped. Either way, tell the QA engineer: `npm run report` opens the latest run, `npm run report -- <feature>` the latest run of a feature, `npm run report -- --list` lists the kept runs, `npm run report -- <feature>/<run>` opens an earlier one.
