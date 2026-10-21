---
name: requirement-traceability
description: Rules for stable IDs and traceability between LLD sections, requirements, manual test cases and Playwright tests — allocation, preservation, retirement and the coverage table. Used by every agent that writes or checks a test plan.
user-invocable: false
---

# Requirement traceability

The document format is defined in `${CLAUDE_PLUGIN_ROOT}/docs/plan-format.md`. This skill is about keeping the links correct over time.

## The chain

```
LLD heading ──► LOGIN-REQ-nnn ──► LOGIN-TC-nnn ──► test('LOGIN-TC-nnn: …') in tests/e2e/*.spec.ts
```

Every link is checkable: `mqa.mjs plan validate` checks LLD heading ↔ requirement ↔ test case, `mqa.mjs trace` checks test case ↔ Playwright test.

## Allocation

- Get new IDs only from `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs" plan next-id <feature> <TC|REQ|Q|RF> --count <n>`. Never compute them by hand and never fill gaps.
- Order of new test cases in the document follows the requirement order; their numbers simply continue. A new TC for `REQ-002` added later may be `TC-014` and sit next to `TC-003` — that is correct.

## Preservation

- An existing ID keeps its meaning forever. If a scenario changes so much that it tests a different behaviour, retire the old ID and allocate a new one; otherwise edit in place and keep the ID.
- Never renumber to "tidy up". Never reuse a retired ID.
- When regenerating a DRAFT plan, map each regenerated scenario to its existing ID by meaning (same requirement and same condition), not by position.

## Retirement

Remove the `### ID` block from `test-cases` and add a row to `retired`: `| \`LOGIN-TC-004\` | reason (e.g. requirement removed in LLD) | YYYY-MM-DD |`. Also remove the ID from the coverage table and from question rows. Report every Playwright test that still references it (`trace` lists them) — the QA engineer decides what happens to that test.

## Coverage table

- Exactly one row per requirement; the LLD section cell must match the LLD heading text exactly.
- The test case list equals the active test cases that reference the requirement (validator-enforced).
- `COVERED` — every acceptance criterion has a test; `PARTIAL` — some criteria are untested or blocked by a question (say which); `NOT_COVERED` — explain why (e.g. not testable through the UI) so a reviewer can challenge it.

## Automation

- A Playwright test title starts with exactly one manual test case ID: `test('LOGIN-TC-001: <title>', …)`. Data-driven variants may share one ID; one test must never claim two IDs.
- Automate only test cases of an effectively approved plan that are not in `approval_excluded`.
