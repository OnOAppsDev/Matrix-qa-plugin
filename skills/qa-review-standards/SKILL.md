---
name: qa-review-standards
description: The independent review checklist for a manual test plan — coverage, scenario quality, traceability, ambiguity handling — with severity rules and the finding format. Used by the qa-reviewer agent for /qa-plan and /qa-review.
user-invocable: false
---

# QA review standards

You are reviewing someone else's work. Start from the LLD, not from the plan: build your own expectation of what must be tested, then compare. Agreeing with the designer is not a goal.

## Procedure

1. Read the LLD in full and list, for yourself, every requirement and acceptance criterion. If the plan lists Figma links, open those frames yourself (read-only Figma tools) and list their screens and states.
2. Read the plan. Map your list onto its requirement table and test cases.
3. Go through the checklist. Each problem is one finding.
4. Re-read your findings: delete any that are preferences rather than defects, merge duplicates.

## Checklist

| Area | What is a defect |
|---|---|
| Requirement coverage | an LLD statement with no requirement row; a requirement with no test case; a criterion (message, limit, redirect) no case verifies |
| Positive scenarios | a requirement whose main success path is not tested |
| Negative scenarios | a rule that refuses something, without a case proving the refusal |
| Boundaries | a limit without min−1/min/max/max+1 cases (or a documented reason) |
| Validation rules | a format or required-field rule without a failing-input case; the defined message not asserted |
| Permissions | role-dependent behaviour tested for only one role |
| Edge cases | an edge case the LLD defines that is untested; or a case asserting behaviour the LLD does **not** define (invented requirement) |
| Duplicates | two cases with the same condition and outcome |
| Preconditions | missing state (login, role, data), or actions written as preconditions |
| Steps | not numbered, more than one action per step, UI names that differ from the LLD, not reproducible |
| Expected results | vague ("works", "error shown"), not observable, or more than the LLD supports |
| Traceability | wrong or missing requirement IDs; coverage table inconsistent; LLD section names that do not match the LLD |
| Assumptions & questions | an assumption hiding a blocking ambiguity; a question marked NON_BLOCKING whose answer changes an expected result; a blocked case not marked |
| Design (Figma) | when the plan lists Figma links: a screen or state in the design no case reaches; a design text used as an expected result without an assumption; an LLD/design difference resolved silently instead of raised as a question |
| Language | plan not in the configured language; Hebrew unreadable (bidi broken, mixed fragments) |

Mechanical checks (IDs, labels, table consistency) are already done by `mqa.mjs plan validate`; its output is given to you. Do not repeat those as findings unless you see a consequence the script cannot (e.g. a correct ID that points at the wrong requirement).

## Severity

- `BLOCKING` — the plan would give false confidence: an untested requirement or acceptance criterion, an expected result that contradicts the LLD, an invented requirement, an unmarked blocking ambiguity.
- `MAJOR` — a meaningful gap or defect that should be fixed before approval: missing boundary/negative case, vague expected result, duplicate cases, wrong traceability.
- `MINOR` — clarity and wording.

A plan with any open `BLOCKING` finding cannot be recorded as `REVIEWED`.

## Finding format

One row each, in the project language, IDs in English:

```
| `LOGIN-RF-003` | MAJOR | OPEN | <what is wrong, citing the LLD section> | <the concrete fix: the case to add or the text to change> | `LOGIN-TC-004` |
```

Use IDs from `mqa.mjs plan next-id <feature> RF --count <n>` (the calling command allocates them). If nothing is wrong, say so explicitly — the command records `NO_FINDINGS`.

Return also a short verdict: `CHANGES_REQUIRED` (any open BLOCKING finding) or `REVIEWED`, with the counts per severity.
