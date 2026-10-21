---
description: Approve a feature's reviewed manual test plan (feature-level). Only the QA engineer can run this command; it checks review state, LLD freshness and blocking ambiguities, then records the approval.
argument-hint: "<feature>"
disable-model-invocation: true
---

# /qa-approve

Approve the test plan for the feature in `$ARGUMENTS`.

`MQA` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Approval rules: `${CLAUDE_PLUGIN_ROOT}/docs/approvals-and-safety.md` — read the "What counts as explicit approval" section and apply it literally.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 1. Load

`MQA plan validate <feature>` and `MQA plan state <feature>`. If the plan does not exist, stop.

## 2. Pre-approval checks — stop at the first failure and say what to run

| Check | If it fails |
|---|---|
| status is `REVIEWED` | `DRAFT` / `CHANGES_REQUIRED` → run `/qa-review`; already `APPROVED` and effective → report approver and date, and ask whether there is any reason to re-approve (normally not) |
| no `REVIEWED_CONTENT_CHANGED` warning | content changed after the review → run `/qa-review` again |
| no `LLD_CHANGED` warning | run `/qa-sync` |
| no validation errors | fix via `/qa-review` |

## 3. Blocking ambiguities

List open `BLOCKING` questions and the test cases they block (`summary.openBlockingQuestions`, `summary.blockedTestCases`). Also list open `MAJOR`/`MINOR` findings and `NON_BLOCKING` questions for information.

- None open → full approval is possible.
- Some open → **full approval is not possible.** Offer: resolve them first (record the answer in the question's decision column, set it `RESOLVED`, update the affected cases — this changes content, so the plan returns to `DRAFT` and needs `/qa-review`), or **partial approval**, which approves the plan except the blocked test cases; those are recorded in `approval_excluded` and are not eligible for automation.

## 4. Explicit confirmation

Show the exact approval about to be recorded: feature, plan path, number of test cases, scope (full / partial with the excluded IDs), content fingerprint. Ask with `AskUserQuestion`: "Approve" / "Do not approve" (Hebrew: "אישור" / "לא לאשר"). Then ask for the approver's name if it is not already known in this conversation (never infer it from git config or the OS user without asking).

Do not treat anything except an explicit "Approve" ("אישור") to this exact question as approval.

## 5. Record

`MQA plan status <feature> APPROVED --by "<name>"` (add `--partial` only if partial approval was chosen). The guard shows a permission prompt — the QA engineer confirms it. The script re-checks every gate and refuses if anything changed.

## 6. Report

Show the recorded approval (status, scope, excluded cases), that the plan is now eligible for `/qa-automate`, and remind the QA engineer to review the diff and commit it with git themselves.
