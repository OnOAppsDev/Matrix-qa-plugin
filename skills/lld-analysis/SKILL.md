---
name: lld-analysis
description: How to read a feature LLD (and its optional Figma design) and extract testable requirements, acceptance criteria, dependencies, ambiguities, LLD/design differences and missing requirements, with stable requirement references. Used by the requirements-analyzer agent for /qa-plan and /qa-sync.
user-invocable: false
---

# LLD analysis

The LLD is the authoritative statement of expected behaviour. Application source code, existing tests and conversation are supporting evidence only and never create a requirement.

## Procedure

1. **Read the whole LLD** before extracting anything. Note its heading structure — every requirement is tied to the heading it appears under.
2. **Extract atomic requirements.** One requirement = one verifiable behaviour or rule. Split "the field is required and must be a valid email" into the rule and its message only if they can fail independently; keep a rule and its exact message together.
3. For each requirement record:
   - a stable reference (`<FEATURE>-REQ-nnn`; on a re-analysis keep the IDs already in the plan, see `requirement-traceability`),
   - the LLD heading **exactly as written** (title, or `Parent > Child` when the title repeats),
   - a one-line restatement in the project language,
   - acceptance criteria: the observable outcome, exact UI texts quoted verbatim, limits and units,
   - the requirement type: functional, validation, permission/role, state transition, error handling, integration, non-functional.
4. **Acceptance criteria are what a tester can observe** — screen, URL, message text, enabled/disabled state, data shown. If the LLD only states an intention ("the user is informed"), the criterion is incomplete: raise a question.
5. **Dependencies:** other features, services, roles, feature flags, data that must pre-exist, external systems. List them for the test strategy.
6. **Ambiguities** — raise an open question whenever any of these is undefined:
   - limits without inclusive/exclusive semantics, units or ranges;
   - error behaviour (which message, where, does input persist);
   - state rules (counters, resets, durations, concurrency);
   - role/permission behaviour for anyone other than the main actor;
   - conflicts between two LLD statements.
   Classify each question:
   - `BLOCKING` — the expected result of at least one test case cannot be stated without the answer;
   - `NON_BLOCKING` — tests can be written with a documented assumption.
7. **Missing requirements** — things a web feature of this type normally needs that the LLD does not mention (empty state, server error, session expiry, double submit, browser back, accessibility labels). Report them as questions or as "not specified" notes. **Never turn them into requirements**; a test for them is written only if the QA engineer confirms the expected behaviour.

## Figma design

The design is the second source, used when the command passes Figma links. The LLD still decides behaviour; the design shows what the user sees.

1. **Read it through the connected Figma MCP server's read tools only** — Claude Code keeps one Figma server, so it may be this plugin's, the claude.ai Figma connector or another plugin's; the tool names end in `__create_session`, `__get_metadata`, `__get_design_context`, `__get_screenshot`, `__get_variable_defs`. Never call any other Figma tool (the guard denies them): parse the file key and node from each link (`figma.com/design/<fileKey>/…?node-id=12-345` → node `12:345`), `create_session` for the file, `get_metadata` to list the frames under the link, then `get_design_context` and `get_screenshot` for every frame that belongs to the feature — all states, not just the first. A file-level link without `node-id`: list the pages and frames whose names match the feature and return them as candidates for the QA engineer to confirm; do not analyse a whole file.
2. **Screen inventory**, per frame: screen name, state (default, empty, filled, error, disabled, loading, success, mobile/tablet variant), the node link, and every visible text quoted exactly (labels, buttons, messages, placeholders, headings).
3. **Compare with the LLD** and raise a question for each difference — never pick one silently:
   - a text, field, button or message that differs between the LLD and the design (`BLOCKING` if a test's expected result depends on it);
   - a state or flow in the design that the LLD does not describe, or the reverse;
   - a design element no requirement covers (report under missing requirements — the design alone does not create a requirement).
4. Where the LLD names a message without its exact text and the design shows it, note the design text as a proposed assumption with its screen.
5. Not available (MCP not connected, not authenticated, no access to the file): say so in the output — the QA engineer decides whether to continue without the design. Never describe a design you could not open.

## Output

A structured list the test designer can use directly:

```
REQ: LOGIN-REQ-004 | section: אימות שדות | type: validation
  statement: ...
  acceptance: message "הסיסמה חייבת להכיל 8 עד 64 תווים" when length < 8 or > 64
  dependencies: —
QUESTION: BLOCKING | affects: LOGIN-REQ-007 | ...
MISSING: ...
SCREEN: התחברות — מצב שגיאה | https://www.figma.com/design/<key>/<file>?node-id=12-345
  texts: "דוא״ל", "סיסמה", "התחברות", "דוא״ל או סיסמה שגויים"
```

Write statements, criteria and questions in the project language; keep IDs, tokens and quoted UI text exactly as in the LLD.
