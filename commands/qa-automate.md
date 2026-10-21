---
description: Generate standard Playwright TypeScript automation (Page Object Model) for QA-selected test cases of an approved plan — suitability analysis, explicit selection, generation, technical validation.
argument-hint: "<feature>"
---

# /qa-automate

Generate Playwright automation for the feature in `$ARGUMENTS`.

`MQA` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Approval rules: `${CLAUDE_PLUGIN_ROOT}/docs/approvals-and-safety.md`.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 1. Only approved plans

`MQA plan state <feature>`. Continue only when `effectiveApproval` is `true`. Otherwise stop and explain the reason (`status`, `APPROVED_CONTENT_CHANGED` → `/qa-review` + `/qa-approve`, `LLD_CHANGED` → `/qa-sync`). Test cases in `excluded` are never automated.

## 2. Analyse

1. `MQA trace <feature>` — which cases are already automated, and any test pointing at a retired, unknown or excluded case.
2. Inspect the project: `tests/` layout (config `paths`), existing page objects, fixtures, `playwright.config.ts`, installed `@playwright/test` version.
3. Optionally launch `matrix-qa-plugin:code-analyzer` (mode `automation`) when `paths.appSourcePath` exists, for accessible names, test ids and routes.
4. Launch `matrix-qa-plugin:playwright-engineer` in mode `analyse`.

## 3. Recommend and select

Present a table: test case, title, priority, already automated?, recommendation (`recommend` / `possible` / `not recommended`) and reason. Explain every case that is not a good candidate. Then list the files that would be **created** and the existing files that would be **modified** (with the reason for each modification).

Ask the QA engineer to choose, with `AskUserQuestion` (multi-select, at most 4 options per question — split into several questions or ask for a typed list of IDs when there are more): which test cases to automate, then confirm the file list. Do not preselect everything; the default is the `recommend` set, and the QA engineer must confirm it explicitly. Already-automated cases are regenerated only if explicitly selected for regeneration.

## 4. Generate

Launch `matrix-qa-plugin:playwright-engineer` in mode `generate` with exactly the approved test case IDs and the approved file list. The guard asks before every edit of an existing file; decline anything not in the approved list.

## 5. Validate

Run and show the actual output (summarised):

- `npx tsc --noEmit`
- `npx playwright test --list` (titles carry the TC IDs; projects resolve)
- `MQA trace <feature>`

If dependencies are missing, report which command could not run and the install command. Running the tests against an environment is `/qa-run`, unless the QA engineer asks to run them now.

## 6. Report

Generated and modified files, the test ↔ test case mapping, validation results, cases not automated and why, locator limitations with recommendations for developers, and a reminder that the QA engineer reviews and commits the changes with git.
