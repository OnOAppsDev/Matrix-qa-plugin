---
name: test-case-design
description: How to design comprehensive manual web test cases from extracted LLD requirements — scenario techniques, the required fields, writing verifiable steps and expected results, handling ambiguity, and Hebrew/English language rules. Used by the test-designer agent.
user-invocable: false
---

# Manual test case design

The block format and IDs are in `${CLAUDE_PLUGIN_ROOT}/docs/plan-format.md`; ID rules in the `requirement-traceability` skill. This skill is about *what* to write.

## Coverage techniques — apply each to every requirement where it fits

| Technique | Write a test case when the requirement has… |
|---|---|
| Happy path | any user-facing behaviour (at least one per requirement) |
| Negative | input, credentials, permissions or states that must be refused |
| Input validation | required fields, formats, allowed characters, trimming |
| Boundary values | a limit: test min−1, min, max, max+1 (and min+1/max−1 only if the LLD treats them specially) |
| Equivalence classes | many inputs with the same expected outcome: one representative per class |
| Permissions / roles | behaviour that differs per role, or an action only some users may perform |
| State transitions | counters, locks, statuses, multi-step flows: each transition and each invalid transition |
| Error handling | defined server or validation errors, with the exact defined message |
| Relevant edge cases | double submit, browser back/refresh mid-flow, very long text, RTL/LTR mixed input, empty lists — **only when the LLD defines the expected behaviour**; otherwise raise a question |

Do not pad: one scenario per distinct condition and outcome. Two cases with the same condition and outcome are duplicates.

## Writing each field

- **Title** — the condition and the outcome: "Password of 7 characters is rejected", not "Password test 3".
- **Requirement** — every `REQ` ID the case verifies.
- **Priority** — `P1` core flow, security or data loss; `P2` important validation and alternate flows; `P3` cosmetic or rare.
- **Type** — one of: positive, negative, input validation, boundary, permissions, edge case, error handling, state transition.
- **Status** — `ACTIVE`, or `BLOCKED (<Q-ID>)` when the expected result depends on an open blocking question.
- **Preconditions** — the state before step 1: logged in or not, role, data that must exist, feature flags. Not actions.
- **Test data** — concrete values (`user.example.com`, a 65-character string). Credentials are referenced by role (`the standard user's password`), never written.
- **Steps** — numbered, one user action each, using the UI texts exactly as the LLD names them. Start from a URL or a named screen.
- **Expected result** — observable and verifiable: the exact message text, the URL, what is visible/enabled, what did **not** happen. Banned: "works correctly", "an error is shown", "as expected", "the system behaves normally".
- **Assumptions** — any assumption the case relies on, with the question ID it comes from.

## Ambiguity policy

- Keep generating for every clear requirement; never stop the whole plan for one gap.
- Where an expected result is not defined: write the certain part, add an assumption and an open question, and mark the case `BLOCKED (<Q-ID>)` if the question is `BLOCKING`.
- Never invent behaviour, messages, limits or roles. Never copy behaviour from source code into an expected result; if the code shows something the LLD does not, it is a discrepancy for the plan's open questions.

## Language

The plan language is `language` in `matrix-qa.config.json` (default `he`).

- Titles, preconditions, steps, expected results, assumptions, questions and findings are written in that language, in natural professional phrasing — not word-for-word translation.
- Always in English: test case and requirement IDs, status/severity/priority tokens, file names, URLs and paths, code, configuration keys, Page Object names.
- UI texts are quoted exactly as written in the LLD, in their original language.
- **Hebrew Markdown readability:** keep the `<div dir="rtl">` wrapper from the template; start every line and table cell with a Hebrew word where possible; put IDs, paths, URLs and values in backticks so the bidi algorithm keeps them intact; avoid ending a line with an English token followed by punctuation; use Hebrew labels for table headers and bold field titles exactly as the template defines them.

## Self-check before handing over

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs" plan validate <feature>` and fix every error. Then check: every requirement has at least a positive and, where applicable, a negative case; every limit has its boundary cases; every expected result is observable.
