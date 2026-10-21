---
description: Synchronise a feature's test plan with its updated LLD — fingerprint-based change detection, impact analysis on requirements, test cases and Playwright tests, an exact change proposal, and approved changes only.
argument-hint: "<feature> [--figma]"
---

# /qa-sync

Synchronise the test plan for the feature in `$ARGUMENTS` with its current LLD — and, with `--figma`, with its current Figma design.

`MQA` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Method: the `lld-change-impact` skill. Format: `${CLAUDE_PLUGIN_ROOT}/docs/plan-format.md`. Approval rules: `${CLAUDE_PLUGIN_ROOT}/docs/approvals-and-safety.md`.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 1. Detect

`MQA lld diff <feature>`.

- `lldChanged: false` → report "the plan matches the LLD it was generated from" (fingerprint); stop unless `--figma` was given.
- `--figma`: the design has no fingerprint, so this is an explicit re-check. Take the links from the plan's `Figma` row (none → ask for them, as in `/qa-plan` step 1).
- No baseline → use read-only `git log -p -- <lld path>` to see the change, or ask the QA engineer for the previous LLD text; continue with that comparison.

## 2. Analyse

1. Launch the `matrix-qa-plugin:requirements-analyzer` agent in sync mode with the diff JSON, the current LLD and the plan: classify every change (added / substantive / editorial / removed / moved) and find implicit effects on unchanged requirements. With `--figma`, also pass the links: it compares the current design with the plan's test cases (texts, states, screens added or removed) and returns each difference as a change of the same kinds. Design changes go through the same proposal and approval below; nothing in Figma is changed.
2. Run `MQA trace <feature>` for the full automation picture.

## 3. Present the impact analysis

In the project language:

- LLD changes by section (before → after);
- added, modified and removed requirements;
- potentially affected test cases: `keep` / `update` / `retire` / `new`, with the exact proposed text for every update and every new case (IDs: existing ones kept; new ones shown as "new");
- potentially affected Playwright tests (`file:line`), each marked "needs review" or "needs regeneration";
- consequence for approval: substantive change → back to `DRAFT`, re-review and re-approval needed; editorial-only → approval can be kept.

## 4. Approval

Ask with `AskUserQuestion`: "Apply all proposed changes" / "Apply a subset" (then list the items to choose) / "Editorial only — keep the approval, no test changes" / "Cancel". Nothing is written before this answer.

## 5. Apply only what was approved

- **Editorial only:** `MQA lld baseline <feature> --keep-approval` (the guard asks for confirmation). Add a change-log row. Done.
- **Changes approved:**
  1. If the plan is `REVIEWED` or `APPROVED`: `MQA plan status <feature> DRAFT --reason "LLD sync: <summary>"`.
  2. Launch the `matrix-qa-plugin:test-designer` agent (task `sync`) with exactly the approved items. It keeps IDs for updated cases, allocates new IDs with `plan next-id`, retires removed cases (never deletes or reuses IDs), updates the coverage table and adds one change-log row.
  3. `MQA lld baseline <feature>`.
  4. `MQA plan validate <feature>` and `MQA trace <feature>`.

Never modify Playwright tests in this command. Never regenerate the plan from scratch.

## 6. Report

Changes applied, IDs added/updated/retired, validation and trace output, the new status (`DRAFT` → run `/qa-review` then `/qa-approve`), and the automation that now needs review or regeneration with `/qa-automate`. Remind the QA engineer to review and commit the diff themselves.
