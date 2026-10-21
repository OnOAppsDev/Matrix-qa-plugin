# Test plan document format and state model

The single source of truth for the per-feature test plan document. Commands, agents and skills refer here instead of restating it. `scripts/mqa.mjs` parses and enforces it; `templates/test-plan.he.md` and `templates/test-plan.en.md` are its two language renderings.

## Location and identity

| Item | Path (defaults from `matrix-qa.config.json` → `paths`) |
|---|---|
| LLD | `qa/lld/<feature>.md` |
| Test plan (one per feature) | `qa/test-cases/<feature>.md` |
| LLD baseline snapshot | `qa/test-cases/.lld-baseline/<feature>.md` — written only by the script |

`<feature>` is a kebab-case slug (the LLD file name). The **feature ID** (`LOGIN`) is upper-case letters, digits and `_`, and prefixes every ID in the document.

## Front matter

Flat `key: value` lines. The status fields are written **only** by `mqa.mjs plan status`; the fingerprint only by `plan new` / `lld baseline`. The guard hook denies hand-written approval fields.

| Key | Meaning |
|---|---|
| `feature`, `feature_id`, `title`, `language` | identity; `language` is `he` or `en` |
| `lld_path` | the LLD this plan was generated from, relative to the QA repo |
| `lld_fingerprint` | `sha256:` of the LLD as last analysed (line endings, trailing whitespace and BOM normalised) |
| `status`, `status_reason` | see the state model |
| `reviewed_at`, `reviewed_fingerprint` | when the independent review was recorded, and the content fingerprint it covered |
| `approved_by`, `approved_at`, `approved_fingerprint` | the explicit approval and the content fingerprint it covered |
| `approval_scope`, `approval_excluded` | `full` or `partial`; test cases excluded by open blocking questions |
| `plugin_version` | plugin version that created the plan |

The **content fingerprint** covers the whole body except the `change-log` and `approval` sections, so history entries never invalidate an approval, but any change to a test case, requirement, assumption, question or finding does.

## Sections

Each section starts with an invisible marker. Markers are language-independent; headings are translated. All ten are required, in this order:

`feature` · `strategy` · `requirements` · `test-cases` · `assumptions` · `open-questions` · `review-findings` · `retired` · `change-log` · `approval`

```markdown
<!-- mqa:section requirements -->
## 3. כיסוי דרישות
```

The `approval` section is re-rendered by the script from the front matter; never edit it.

The `feature` section's information table has a `Figma` row: one link per screen analysed (with `node-id`), or `none`/`אין`. It is part of the content fingerprint, so changing the design links needs a new review and approval. The design is not fingerprinted — Figma changes are found by `/qa-sync <feature> --figma`, not automatically.

## IDs

| Kind | Form | Where defined |
|---|---|---|
| Requirement | `LOGIN-REQ-001` | first cell of a `requirements` row |
| Test case | `LOGIN-TC-001` | `### LOGIN-TC-001: title` heading in `test-cases` |
| Open question | `LOGIN-Q-001` | first cell of an `open-questions` row |
| Review finding | `LOGIN-RF-001` | first cell of a `review-findings` row |

Rules, all checked by `plan validate`:

- IDs are **never renumbered and never reused**. New IDs come from `mqa.mjs plan next-id <feature> <TC|REQ|Q|RF>`, which returns one past the highest number ever used in the document, retired ones included.
- A removed test case moves to the `retired` table (`| LOGIN-TC-004 | reason | date |`); its heading is deleted from `test-cases`.
- Three or more digits; more digits are fine after 999.

## Requirement rows

```markdown
| `LOGIN-REQ-004` | `אימות שדות` | description | `LOGIN-TC-004`, `LOGIN-TC-005` | COVERED |
```

- Column 2 is the LLD heading the requirement comes from, **exactly** as written in the LLD (the title alone, or the full path `Parent > Child` when titles repeat). `/qa-sync` maps changed LLD sections to requirements through it.
- The test case list must equal the set of active test cases whose block references the requirement.
- Coverage token: `COVERED`, `PARTIAL` or `NOT_COVERED` (state the reason in the description).

## Test case blocks

````markdown
### LOGIN-TC-004: Password of 7 characters is rejected

| Field | Value |
|---|---|
| Requirement | `LOGIN-REQ-004` |
| Priority | P2 |
| Type | boundary |
| Status | ACTIVE |
| Assumptions | — |

**Preconditions**
- ...

**Test data**
- ...

**Steps**
1. ...

**Expected result**
- ...
````

- Required field labels per language (checked): he — `דרישה`, `עדיפות`, `תנאים מקדימים`, `נתוני בדיקה`, `צעדי ביצוע`, `תוצאה צפויה`; en — `Requirement`, `Priority`, `Preconditions`, `Test data`, `Steps`, `Expected result`.
- Priority token `P1` (critical path), `P2` (important), `P3` (minor). At least one requirement ID and a numbered step list.
- Status `ACTIVE`, or `BLOCKED (LOGIN-Q-001)` when an open question makes the expected result uncertain. Any test case that mentions an open `BLOCKING` question, or is listed by one, is excluded from approval.

## Questions and findings

```markdown
| `LOGIN-Q-001`  | BLOCKING | OPEN     | question | `LOGIN-TC-009` | decision |
| `LOGIN-RF-001` | MAJOR    | RESOLVED | finding  | recommendation | `LOGIN-TC-005` |
```

Column 2 is the severity and column 3 the state, as bare tokens:

| Table | Severity | State |
|---|---|---|
| open-questions | `BLOCKING`, `NON_BLOCKING` | `OPEN`, `RESOLVED` |
| review-findings | `BLOCKING`, `MAJOR`, `MINOR` | `OPEN`, `RESOLVED`, `REJECTED` (QA engineer disagrees; reason in the row) |

A review with nothing to report records the token `NO_FINDINGS` with the review date in the `review-findings` section.

## State model

```
              /qa-plan                 /qa-review (no open BLOCKING finding)        /qa-approve (QA engineer)
   (none) ───────────► DRAFT ─────────────────────────────────► REVIEWED ─────────────────────────► APPROVED
                         ▲  │ /qa-review (open BLOCKING finding)    │                                   │
                         │  └──────────────► CHANGES_REQUIRED ◄──────┘                                   │
                         │                         │ fixes applied                                       │
                         └─────────────────────────┴──── any content change, LLD sync ◄──────────────────┘
```

| To | Allowed from | Gate enforced by `plan status` |
|---|---|---|
| `DRAFT` | any | `--reason` required when leaving `REVIEWED` or `APPROVED`; clears review and approval |
| `CHANGES_REQUIRED` | any | `--reason` required; clears review and approval |
| `REVIEWED` | `DRAFT`, `CHANGES_REQUIRED`, `REVIEWED` | no validation errors; LLD unchanged; no open `BLOCKING` finding; findings or `NO_FINDINGS` recorded |
| `APPROVED` | `REVIEWED` | `--by <name>`; content unchanged since review; no validation errors; LLD unchanged; no open `BLOCKING` question unless `--partial` |

`APPROVED` → `REVIEWED` is not a transition: a changed approved plan returns to `DRAFT`.

**Effective approval** (`mqa.mjs plan state`) — what `/qa-automate` requires: status `APPROVED`, content fingerprint equal to `approved_fingerprint`, and LLD fingerprint equal to `lld_fingerprint`. A hand edit after approval (`APPROVED_CONTENT_CHANGED`) or an LLD change (`LLD_CHANGED`) makes the approval ineffective without anyone having to remember to reset it.

## Automation link

Each Playwright test title starts with the manual test case ID: `test('LOGIN-TC-001: ...', ...)`. `mqa.mjs trace <feature>` reports automated and not-automated cases and any test pointing at a retired, unknown or excluded test case.

## Script reference

`node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs" <command>` — JSON on stdout; exit 0 ok, 1 checks failed, 2 usage error or refused gate (reason in `error`).

| Command | Purpose |
|---|---|
| `config validate` | validate `matrix-qa.config.json` |
| `init inspect` / `init apply <files\|all>` | read-only repo report / additive template install (never overwrites) |
| `plan new <feature> [--feature-id ID] [--title T]` | create the skeleton and LLD baseline; refuses if the plan exists |
| `plan validate <feature>` | structure, IDs, traceability, freshness, approval integrity |
| `plan state <feature>` | effective approval |
| `plan status <feature> <STATUS> [--by] [--reason] [--partial]` | the only writer of status |
| `plan next-id <feature> <TC\|REQ\|Q\|RF> [--count n]` | next stable IDs |
| `lld diff <feature>` | section diff against the baseline, with affected requirements, test cases and Playwright tests |
| `lld baseline <feature> [--keep-approval]` | record the current LLD as analysed |
| `trace <feature>` | manual ↔ automation traceability |
| `results [report.json]` | summary of the Playwright JSON report, secrets redacted |
| `fingerprint <file>` | normalised sha256 of a file |
