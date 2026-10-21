---
description: Generate the manual test plan for a feature from its LLD and optional Figma design — requirements analysis, design comparison, optional source analysis, test design, independent review — and present it for approval.
argument-hint: "<qa/lld/feature.md> [--with-source] [--figma <url>]..."
---

# /qa-plan

Generate a manual test plan from the LLD in `$ARGUMENTS`.

`MQA` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Format: `${CLAUDE_PLUGIN_ROOT}/docs/plan-format.md`. Approval rules: `${CLAUDE_PLUGIN_ROOT}/docs/approvals-and-safety.md`.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 0. Preconditions

1. `MQA config validate` must pass (otherwise: run `/qa-init`). Read `matrix-qa.config.json` for `language`, `paths.lldDir`, `paths.testCasesDir`, `paths.appSourcePath`.
2. Resolve the LLD path; it must be a Markdown file inside `paths.lldDir`. The feature slug is its file name without `.md`.
3. If `qa/test-cases/<feature>.md` already exists: do **not** regenerate. Report its status (`MQA plan state <feature>`) and stop with the right next step — `/qa-review` for DRAFT/CHANGES_REQUIRED, `/qa-sync` if the LLD changed, `/qa-approve` for REVIEWED. Only if the plan is `DRAFT` and the QA engineer explicitly asks to regenerate it, continue in `revise` mode, keeping existing IDs by meaning.

## 1. Analyse the LLD and the design

1. **Figma links:** take every `--figma <url>` argument and every `figma.com` link in the LLD. If there are none, ask once with `AskUserQuestion`: "Is there a Figma design for this feature?" — "Paste Figma links" (the QA engineer types them as the free-text answer) / "No design for this feature" (Hebrew wordings in `docs/conversation-language.md`). Accept only `figma.com/design|file|proto/…` links; ask for frame or section links (with `node-id`) rather than a whole file.
2. Launch the `matrix-qa-plugin:requirements-analyzer` agent with the LLD path, language, a proposed feature ID (upper-case slug, e.g. `LOGIN`; confirm it with the QA engineer if the slug is long or ambiguous) and the Figma links.
3. If the analyzer returns candidate frames for a file-level link, confirm the list with the QA engineer and re-run the analyzer's design part on the confirmed frames only.
4. If it reports that Figma is unavailable: tell the QA engineer to run `/mcp`, select the Figma server (it may appear as this plugin's `figma`, as `claude.ai Figma` or under another plugin — Claude Code keeps only one) and authenticate with an account that can open the file; then ask whether to retry or continue without the design. Without it, the plan's `Figma` row says "not analysed" (Hebrew: "לא נבדק") with the links, so the reviewer and `/qa-sync --figma` can pick it up later.

## 2. Source code (optional)

If `paths.appSourcePath` is configured and exists, and either `--with-source` was given or the LLD leaves UI flows, routes or limits unclear, launch the `matrix-qa-plugin:code-analyzer` agent (mode `plan`) in parallel with step 1. Its discrepancies become open questions; source code never changes an expected result.

## 3. Create and design

1. `MQA plan new <feature> --feature-id <ID> --title "<feature title in the project language>"` — creates the skeleton from the language template, records the LLD fingerprint and the baseline snapshot.
2. Launch the `matrix-qa-plugin:test-designer` agent (task `create`) with the plan path, LLD path, language and both analyses (including the Figma screen inventory). It fills the plan and runs `MQA plan validate`.

## 4. Independent review

1. Run `MQA plan validate <feature>` yourself and allocate review IDs: `MQA plan next-id <feature> RF --count 20` (unused ones are simply not used).
2. Launch the `matrix-qa-plugin:qa-reviewer` agent with the LLD path, plan path, language, the validation JSON and the RF IDs. Do not pass the designer's reasoning.
3. Write the returned finding rows into the `review-findings` section (or `NO_FINDINGS` with today's date).

## 5. Incorporate review findings into the draft

1. For `BLOCKING` and `MAJOR` findings with a clear fix inside the LLD's scope, launch the `matrix-qa-plugin:test-designer` agent (task `revise`) to apply them and set those findings to `RESOLVED`. Findings that need a decision from the QA engineer or an LLD author stay `OPEN`. Re-run `MQA plan validate <feature>`.
2. If anything was revised, launch the `matrix-qa-plugin:qa-reviewer` agent again to verify only the revised test cases and the findings marked `RESOLVED` (reopen any that are not fixed; add new rows for new problems).
3. Record the review state:
   - no open `BLOCKING` finding → `MQA plan status <feature> REVIEWED`;
   - otherwise → `MQA plan status <feature> CHANGES_REQUIRED --reason "<open blocking findings>"`.

## 6. Present the plan for the QA engineer's review

Summarise in the project language:

- requirements found, test cases per requirement and per type, priorities;
- open questions (`BLOCKING` first) and the test cases they block; assumptions;
- review findings: resolved, rejected, still open (with severity);
- source/LLD discrepancies, if source was analysed;
- LLD/Figma differences and design elements without a requirement, if a design was analysed (each is an open question);
- the plan path and its status.

## 7. Request explicit approval

Ask with `AskUserQuestion`: "Approve the test plan" / "Request changes" / "Not now". Approval is never inferred — see the approval rules.

- **Approve** (only offered when the status is `REVIEWED`): follow steps 2–6 of `${CLAUDE_PLUGIN_ROOT}/commands/qa-approve.md` exactly — pre-approval checks, partial-approval decision, approver name, `plan status … APPROVED` (the guard asks for confirmation).
- **Request changes**: collect them, apply via `test-designer` (task `revise`), move the plan to `DRAFT` with `--reason` if it was `REVIEWED`, and continue from step 5.
- **Not now**: leave the status as it is and tell the QA engineer the next command (`/qa-review` or `/qa-approve`).

Never mark the plan approved without the explicit answer in this step. Remind the QA engineer to review the diff and commit it with git themselves.
