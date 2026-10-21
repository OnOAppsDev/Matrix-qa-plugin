---
name: lld-change-impact
description: How to analyse an LLD change against an existing test plan and its automation — deterministic section diff, semantic classification of added/modified/removed requirements, the exact change proposal, ID preservation and re-approval rules. Used by /qa-sync with the requirements-analyzer and test-designer agents.
user-invocable: false
---

# LLD change impact analysis

## 1. Deterministic detection first

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs" lld diff <feature>
```

It compares the current LLD with the baseline snapshot recorded when the plan was generated or last synchronised (fingerprints, not timestamps). Output: added / modified / removed / renamed LLD sections with before/after text, the requirements mapped to those sections, the test cases referencing them, and the Playwright tests referencing those test cases.

- `lldChanged: false` → nothing to synchronise; stop.
- No baseline (older plan) → only the fingerprint is known; use read-only `git log -p -- <lld>` / `git diff` to see the change, or ask the QA engineer for the previous version.
- `unmappedRequirements` → a requirement whose LLD section no longer exists by that name: decide whether it was renamed, moved or removed.

## 2. Semantic classification

For each changed section, read before/after and classify each requirement-level change:

| Change | Meaning | Typical plan action |
|---|---|---|
| Added | new behaviour, no requirement yet | new `REQ` + new `TC`s (new IDs) |
| Modified — substantive | expected result, limit, message, rule or role changes | update affected `TC`s in place (same IDs); add cases for new conditions |
| Modified — editorial | wording, typo, formatting; behaviour identical | no test change; record in the change log |
| Removed | behaviour no longer required | retire the `TC`s (never delete IDs); flag their Playwright tests |
| Moved/renamed | same behaviour under another heading | update the requirement's LLD section cell only |

Also check unchanged sections the change implicitly affects (e.g. a new role changes existing permission cases).

## 3. The proposal — exact, before any write

Present, in the project language:

1. Summary of LLD changes (section, before → after).
2. Per requirement: added / modified / removed / unchanged, with the reason.
3. Per test case: `keep` / `update` (show old → new expected result and steps) / `retire` / `new` (full proposed block).
4. Automation impact: each Playwright test that references an updated or retired case — marked "needs review" or "needs regeneration". Do not change automation in `/qa-sync`; it is listed for a later `/qa-automate`.
5. Approval consequence: substantive changes → plan returns to `DRAFT` and needs `/qa-review` and `/qa-approve` again; editorial-only → the QA engineer may keep the approval (`lld baseline --keep-approval`, which asks for confirmation).

## 4. Applying an approved proposal

Only the items the QA engineer approved, in this order:

1. If the plan is `REVIEWED` or `APPROVED` and anything substantive changes: `mqa.mjs plan status <feature> DRAFT --reason "LLD sync: <summary>"`.
2. Edit the plan: update in place, retire, add (IDs from `plan next-id`). Update the coverage table and questions. Add one change-log row per sync.
3. `mqa.mjs lld baseline <feature>` (or `--keep-approval` for an editorial-only change the QA engineer accepted).
4. `mqa.mjs plan validate <feature>` and `mqa.mjs trace <feature>`; report the results.
