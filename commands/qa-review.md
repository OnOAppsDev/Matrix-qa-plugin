---
description: Independently review a feature's manual test plan against its LLD and record actionable findings and the review state (REVIEWED or CHANGES_REQUIRED).
argument-hint: "<feature>"
---

# /qa-review

Review the test plan for the feature in `$ARGUMENTS` (slug, or path of its LLD or plan).

`MQA` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Format: `${CLAUDE_PLUGIN_ROOT}/docs/plan-format.md`. Approval rules: `${CLAUDE_PLUGIN_ROOT}/docs/approvals-and-safety.md`.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 1. Preconditions

1. `MQA plan validate <feature>`. If the plan does not exist, stop: run `/qa-plan`.
2. If the summary says `lldChanged: true`, stop: run `/qa-sync <feature>` first — a review against an outdated LLD is meaningless.
3. If the plan is `APPROVED`: a review does not change the approved content, but recording new findings does. Ask with `AskUserQuestion` whether to review read-only (report only) or to review and record findings (the plan then returns to `DRAFT` and needs re-approval). Default to read-only.

## 2. Review

1. Allocate finding IDs: `MQA plan next-id <feature> RF --count 20`.
2. Launch the `matrix-qa-plugin:qa-reviewer` agent with the LLD path, plan path, language, the validation JSON and the IDs. The reviewer checks requirement coverage, positive/negative scenarios, boundaries, validation rules, permissions, relevant edge cases, duplicates, preconditions, steps, expected results, traceability and unresolved assumptions (`qa-review-standards`) — and, when the plan's `Figma` row has links, the design's screens and states.
3. Also report the validator's errors and warnings yourself — the reviewer does not repeat them.

## 3. Record

Present the findings grouped by severity, each with its concrete recommendation, in the project language. Then:

1. Write the finding rows into the `review-findings` section (append; never delete earlier rows — set superseded ones to `RESOLVED` or `REJECTED` with a note). When there is nothing to report, write `NO_FINDINGS — <date>`.
2. Record the state:
   - validation errors or an open `BLOCKING` finding → `MQA plan status <feature> CHANGES_REQUIRED --reason "<summary>"`;
   - otherwise → `MQA plan status <feature> REVIEWED`.
   (For an `APPROVED` plan reviewed in record mode, first `MQA plan status <feature> DRAFT --reason "re-review"`.)

## 4. Next steps

- `CHANGES_REQUIRED`: offer to apply the recommended fixes. If the QA engineer approves a set of fixes, launch `matrix-qa-plugin:test-designer` (task `revise`) with exactly those findings; afterwards the plan is `DRAFT` (`MQA plan status <feature> DRAFT --reason "fixes applied"`) and needs `/qa-review` again. Findings the QA engineer disagrees with are set to `REJECTED` with their reason.
- `REVIEWED`: the plan can be approved with `/qa-approve <feature>`, which the QA engineer runs.

Never approve in this command.
