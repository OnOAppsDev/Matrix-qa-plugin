---
name: failure-analysis
description: How to interpret Playwright results after /qa-run — reading the JSON summary, errors, screenshots and traces, classifying each failure as application defect, automation defect, environment problem or test data problem, and recommending fixes without changing code. Used by /qa-run.
user-invocable: false
---

# Failure analysis

Analysis only. Never edit tests, page objects, fixtures or application code as part of a run; recommend the change and let the QA engineer decide (a later `/qa-automate` applies approved automation changes).

## Evidence, in order

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs" results` — totals per project, each failure with its manual test case ID, redacted error message, failing line and attachments. Use it instead of pasting raw output.
2. The error message and the failing assertion line in the spec.
3. Screenshots (`test-results/**/test-failed-*.png`) — read the image to see the actual page state.
4. Traces (`test-results/**/trace.zip`): `npx playwright show-trace <path>` is interactive; for analysis, read the action log and network from the error context and screenshot first, and tell the QA engineer which trace to open when the network or timing matters.
5. The manual test case (`qa/test-cases/<feature>.md`) for the expected result, and the LLD for the requirement.

## Classification

| Category | Typical evidence |
|---|---|
| **Application defect** | the page loaded correctly and the observed behaviour contradicts the LLD (wrong message, wrong redirect, missing validation). Cite the LLD section and the observed value. |
| **Automation defect** | locator not found while the screenshot shows the element with another name/role; strict-mode violation (locator matches several elements); missing wait; wrong assertion vs the manual case; test order dependence; same failure on every browser at a line that changed recently |
| **Environment problem** | navigation timeout, `net::ERR_*`, HTTP 5xx/502/503, certificate errors, wrong `baseURL`, service down; often many unrelated tests fail at the first navigation |
| **Test data problem** | missing environment variable (error names it), user locked/disabled/missing, expected seeded record absent, data changed by another run |

When evidence is insufficient, say "undetermined" and name the evidence that would decide it (e.g. "open the trace and check the response of POST /api/login"). A flaky test (passed on retry) is reported separately with its likely cause.

## Report

For each failed test:

```
LOGIN-TC-007 (chromium) — Application defect (high confidence)
  Expected (LOGIN-TC-007 / LLD "פרטים שגויים"): message "הדוא"ל או הסיסמה שגויים"
  Observed: "הסיסמה שגויה" (screenshot test-results/.../test-failed-1.png)
  Recommendation: report to development — the message reveals that the account exists.
```

Then a summary table: total / passed / failed / flaky / skipped per project, failures per category, and next steps. Write explanations in the project language.

Never print secret values: the `results` summary redacts known secret variables; do not copy values typed into password fields from traces or screenshots.
