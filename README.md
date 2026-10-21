# matrix-qa-plugin

A Claude Code plugin for Matrix IT QA teams that turns a feature's LLD into a reviewed, explicitly approved manual test plan, keeps that plan synchronised when the LLD changes, and generates standard Playwright TypeScript automation (Page Object Model) that runs without Claude Code.

```
LLD (qa/lld/login.md) + optional Figma frames
  └─ /qa-plan ──► manual test plan qa/test-cases/login.md (DRAFT) ──► independent review (REVIEWED)
       └─ /qa-approve ──► APPROVED (by a named QA engineer, fingerprinted)
            └─ /qa-automate ──► tests/e2e/login.spec.ts + tests/pages/LoginPage.ts
                 └─ /qa-run ──► npx playwright test … ──► results and failure analysis
  LLD changed? ─► /qa-sync ──► impact analysis ──► approved changes only ──► re-review and re-approval
```

Principles: **LLD-first** (Figma shows what the user sees, source code is evidence; neither creates a requirement — differences become open questions) · **two repositories** (the QA repo is written, the application repo is read-only) · **explicit approval** at every gate · **no git writes** by the plugin · **standard Playwright**.

## Requirements

- Claude Code with plugin support (validated with 2.1.292).
- Node.js **20.12 or newer** (scripts and hooks are plain Node, no dependencies; `process.loadEnvFile` is used for `.env`).
- In each QA repository: `@playwright/test`, `typescript`, `@types/node` (added to `package.json` by `/qa-init`) and browsers (`npx playwright install`).
- Optional: the application source repository checked out next to the QA repository; Figma access for designs (see [Figma](#figma)); a Playwright MCP server for interactive exploration (never required).

## Installation

**From GitHub** (persistent; the repository is its own marketplace, `.claude-plugin/marketplace.json`). It is private, so the git account on your machine needs read access:

```bash
claude plugin marketplace add OnOAppsDev/Matrix-qa-plugin
claude plugin install matrix-qa-plugin@matrix-qa
```

Updates: `claude plugin marketplace update matrix-qa`, then restart Claude Code. Inside a session, `/plugin` does the same interactively.

**From a local clone** (one session, for trying it out or developing):

```bash
claude --plugin-dir /path/to/Matrix-qa-plugin
```

Commands are available as `/qa-plan` or, fully qualified, `/matrix-qa-plugin:qa-plan`. The plugin is independent of the ONO plugins.

## Quick start

```bash
cd my-project-qa            # the QA repository (git-managed by you)
claude
> /qa-init                   # answer the questions, approve the proposal
! npm install && npx playwright install
! cp .env.example .env       # then fill in the test users by hand
# put the feature LLD into qa/lld/login.md
> /mcp                      # once, if you use Figma: select figma → authenticate
> /qa-plan qa/lld/login.md --figma "https://www.figma.com/design/<key>/<file>?node-id=12-345"
> /qa-approve login          # only you can run this command
> /qa-automate login
> /qa-run login --env qa
```

## Commands

| Command | What it does | Writes |
|---|---|---|
| `/qa-init [project-id]` | Inspects the repo (existing Playwright config, tests, Matrix config), asks for missing settings, proposes the structure, explains conflicts, writes a migration proposal for existing Playwright projects, applies only approved files, validates | `matrix-qa.config.json`, template files that do not exist yet, additive merges of `package.json` / `.gitignore` |
| `/qa-plan <lld.md> [--with-source] [--figma <url>]…` | Requirements analysis with LLD/Figma comparison (asks for Figma links when none are given) → optional source analysis → test design → independent review → incorporate findings → present → request explicit approval | the feature test plan (DRAFT), its LLD baseline |
| `/qa-review <feature>` | Independent review: coverage, positive/negative, boundaries, validation, permissions, edge cases, duplicates, preconditions, steps, expected results, traceability, assumptions; records `REVIEWED` or `CHANGES_REQUIRED` | review findings, status |
| `/qa-approve <feature>` | Feature-level approval: checks review state, LLD freshness, blocking ambiguities (full or partial approval), explicit confirmation, records approver | status and approval record |
| `/qa-sync <feature> [--figma]` | Fingerprint-based LLD change detection (and, with `--figma`, a re-check of the design), impact on requirements, test cases and Playwright tests, exact proposal, applies approved changes only, preserves IDs, requires re-approval for substantive changes | the plan (after approval), the baseline |
| `/qa-automate <feature>` | Approved plans only: suitability analysis, QA selection of cases and files, POM-based generation reusing page objects and fixtures, TypeScript and Playwright validation | approved spec, page object and fixture files |
| `/qa-run [feature\|file\|all] [--env] [--project]` | Standard `npx playwright test` with environment, browser/device and filter selection; summary; failure analysis as application / automation / environment / test-data problem | nothing (reports only) |

## Agents and skills

| Agent | Role | Tools |
|---|---|---|
| `requirements-analyzer` | requirements, acceptance criteria, ambiguities, missing requirements; Figma screen inventory and LLD/design differences | no write tools; Figma read tools |
| `code-analyzer` | read-only source analysis: flows, locators, LLD discrepancies | read-only |
| `test-designer` | writes and maintains the plan with stable IDs and traceability | read/write in the QA repo |
| `qa-reviewer` | independent review, blocking issues, design coverage | no write tools; Figma read tools |
| `playwright-engineer` | suitability analysis, Playwright TypeScript with POM and fixtures | all (so an optional Playwright MCP is usable) |

Skills (preloaded into the agents that need them): `lld-analysis`, `test-case-design`, `requirement-traceability`, `qa-review-standards`, `playwright-typescript`, `page-object-model`, `locator-strategy`, `test-data-fixtures`, `failure-analysis`, `lld-change-impact`. Commands coordinate agents directly; there is no orchestrator agent.

## QA repository structure

```
qa-repo/
├── qa/
│   ├── lld/login.md                       # the LLD (authoritative)
│   └── test-cases/
│       ├── login.md                       # ONE plan per feature: info, LLD ref + fingerprint, strategy,
│       │                                  # coverage, test cases, assumptions, questions, findings, approval
│       └── .lld-baseline/login.md         # LLD snapshot used by /qa-sync (script-owned)
├── tests/
│   ├── e2e/login.spec.ts                  # test('LOGIN-TC-001: …')
│   ├── pages/BasePage.ts, LoginPage.ts
│   └── fixtures/index.ts, environment.ts, users.ts, test-data.ts
├── scripts/open-report.mjs                # npm run report: opens the latest run's HTML report
├── playwright-report/<feature>/<date>_<time>-<env>-<projects>/   # one HTML report per run (git-ignored)
├── test-results/                          # latest run: results.json, screenshots, traces (git-ignored)
├── playwright.config.ts                   # standard config, reads matrix-qa.config.json
├── matrix-qa.config.json
├── .env.example                           # variable names only; .env is git-ignored
└── package.json
```

The plan format, IDs and state model are specified in [docs/plan-format.md](docs/plan-format.md). A complete Hebrew example (LLD, approved-ready plan, page objects, spec) is in [examples/login](examples/login).

## Configuration

`matrix-qa.config.json` (validated by `/qa-init` and `node scripts/mqa.mjs config validate`):

```json
{
  "projectId": "acme-portal",
  "language": "he",
  "paths": {
    "lldDir": "qa/lld",
    "testCasesDir": "qa/test-cases",
    "testDir": "tests/e2e",
    "pagesDir": "tests/pages",
    "fixturesDir": "tests/fixtures",
    "appSourcePath": "../acme-portal-app"
  },
  "environments": {
    "dev": { "baseUrl": "https://dev.acme-portal.example.com" },
    "qa": { "baseUrl": "https://qa.acme-portal.example.com" },
    "staging": { "baseUrl": "https://staging.acme-portal.example.com" },
    "production": { "baseUrl": "https://acme-portal.example.com", "protected": true }
  },
  "defaultEnvironment": "qa",
  "browsers": ["chromium", "firefox", "webkit"],
  "devices": { "mobile-chrome": "Pixel 7", "mobile-safari": "iPhone 15", "tablet": "iPad (gen 7)" },
  "defaultProjects": ["chromium"]
}
```

| Key | Default | Notes |
|---|---|---|
| `projectId` | — | kebab-case |
| `language` | `he` | `he` or `en`: plans, test descriptions, and the whole conversation — questions, approval choices, reports and the guard's confirmation prompts ([docs/conversation-language.md](docs/conversation-language.md)). IDs, file names, code and keys stay English |
| `paths.*` | as above | relative to the QA repo; `appSourcePath` is optional, must be outside the QA repo, and is read-only |
| `environments` | — | any names; `baseUrl` absolute http(s) without credentials; `protected: true` requires `MQA_CONFIRM_PROTECTED=<name>` to run |
| `defaultEnvironment` | — | must exist and not be protected |
| `browsers` | `["chromium"]` | desktop projects named `chromium`, `firefox`, `webkit` |
| `devices` | `{}` | project name → Playwright device name (mobile and tablet emulation) |
| `defaultProjects` | `["chromium"]` | what runs when no project is chosen — not every combination by default |

Running tests (no Claude Code needed):

```bash
npx playwright test                                   # default environment and projects
MQA_ENV=staging npx playwright test                   # another environment
npx playwright test --project=mobile-chrome           # any configured browser or device
MQA_PROJECTS=all npx playwright test                  # every configured project
MQA_BASE_URL=https://pr-42.example.com npx playwright test   # override the base URL
npm run report                                        # HTML report of the latest run (-- login: latest of a feature; -- --list: all kept runs)
```

Credentials come from environment variables (`.env` locally, CI secrets in pipelines), e.g. `MQA_USER_STANDARD_USERNAME` / `MQA_USER_STANDARD_PASSWORD`, read by `tests/fixtures/users.ts`. Reports: HTML (`playwright-report/`), JSON (`test-results/results.json`), screenshots and traces on failure; videos are off by default (set `video` in `playwright.config.ts`).

## End-to-end example

1. **LLD** — `qa/lld/login.md` describes the login form, validation (email format, password 8–64), success redirect, a generic invalid-credentials message, lockout after 5 failures, and "remember me".
2. **`/qa-plan qa/lld/login.md`** — the analyzer extracts 8 requirements and raises `LOGIN-Q-001` (BLOCKING: how lockout attempts are counted) and `LOGIN-Q-002` (NON_BLOCKING: remember-me duration). The designer writes 11 cases `LOGIN-TC-001…011` (happy path, validation, boundaries 7/8/65 characters, generic error for unknown email and wrong password, lockout, toggle, remember-me). `LOGIN-TC-009` is `BLOCKED (LOGIN-Q-001)`.
3. **Independent review** — the reviewer reports e.g. `LOGIN-RF-001` (MINOR, unclear verification for the 8-character boundary; fixed → RESOLVED) and `LOGIN-RF-002` (MAJOR, missing 64-character case; the QA engineer rejects it with a reason → REJECTED). No open BLOCKING finding → `REVIEWED`.
4. **`/qa-approve login`** — full approval is refused while `LOGIN-Q-001` is open; the QA engineer chooses partial approval. Recorded: `APPROVED`, scope `partial`, excluded `LOGIN-TC-009`, approver name, content and LLD fingerprints.
5. **`/qa-automate login`** — recommends TC-001…008 and TC-010, explains why TC-009 (excluded) and TC-011 (needs a browser restart with a persisted session) are not candidates; the QA engineer confirms; `LoginPage.ts`, `DashboardPage.ts`, `login.spec.ts` and the fixture registrations are generated and type-checked; `trace` shows only TC-011 not automated.
6. **`/qa-run login`** — runs 9 tests on chromium. If development changes the wrong-password message to "הסיסמה שגויה", `LOGIN-TC-007` fails and is classified as an **application defect** (the LLD requires one generic message so accounts cannot be discovered), with the screenshot and trace paths.
7. **LLD change** — lockout becomes 3 attempts. `/qa-sync login` reports section "נעילת חשבון" modified → `LOGIN-REQ-007` → `LOGIN-TC-009` → no automated test; proposes the updated case; after approval the plan returns to DRAFT and must be reviewed and approved again. IDs are preserved.

## Figma

The plugin declares Figma's official MCP server (`https://mcp.figma.com/mcp`, in `.claude-plugin/plugin.json`). Connect it once per machine: in Claude Code run `/mcp`, select the Figma server and authenticate in the browser with an account that can open the project's files. If Figma is already connected another way (the claude.ai Figma connector, the official Figma plugin or another plugin), Claude Code keeps only one of the duplicates and the plugin uses whichever is connected. Figma's own plan and seat limits apply.

- `/qa-plan` takes `--figma <url>` (repeatable), picks up `figma.com` links written in the LLD, and otherwise asks whether there is a design. Give frame or section links (right-click a frame → *Copy link to selection*; they contain `node-id`); for a whole-file link it proposes the matching frames and asks you to confirm them.
- The requirements analyzer lists every screen and state with its exact texts and compares them with the LLD. Every difference, and every design element no requirement covers, becomes an open question; where the LLD gives no exact text, the design text is used as a documented assumption.
- The links are recorded in the plan's `Figma` row (part of the content fingerprint). The design itself is not fingerprinted: after a design change, run `/qa-sync <feature> --figma`.
- Figma is never modified, and is never a locator source — locators come from the application's DOM.

## Safety and approval behaviour

Full rules: [docs/approvals-and-safety.md](docs/approvals-and-safety.md).

| Rule | How it is enforced |
|---|---|
| Plans are never silently approved | `/qa-approve` has `disable-model-invocation: true`; `mqa.mjs plan status … APPROVED` requires REVIEWED, unchanged content since review, unchanged LLD, a named approver, and no open BLOCKING question (unless partial); the guard hook forces a permission prompt for it and denies hand-written approval fields |
| Approved plans are not silently changed | content fingerprint recorded at approval; any later change makes the approval ineffective (`APPROVED_CONTENT_CHANGED`) and blocks `/qa-automate`; the guard asks before an APPROVED plan is edited |
| LLD changes are detected | normalised SHA-256 fingerprint of the LLD plus a section-level baseline snapshot — not timestamps |
| Existing automation is not changed without approval | the guard asks before editing any existing file in the test, page or fixture directories or project configuration |
| Figma is read-only | the analyzer and reviewer have no write tools and are told to use only Figma read tools; in a QA session the guard denies every Figma MCP tool outside a read-only allowlist, from any Figma server |
| Application source is read-only | analyzer agents have read-only tools; the guard denies Write/Edit and common shell writes into `paths.appSourcePath` |
| No git writes | in a Matrix QA session, the guard denies every git sub-command except read-only inspection (in any directory, including `git -C` and `cd … &&` forms), and `gh pr create`/`merge` and similar |
| No secrets | the guard denies reading or writing `.env` files and writing common credential patterns; run summaries redact secret environment values |
| No automatic repair | `/qa-run` only reports |

**What cannot be enforced technically** (details in the safety document): the shell parser is best-effort, not a sandbox (`sh -c`, `eval`, scripts can bypass it); an ordinary password cannot be told apart from test data; recursive search relies on `.env` being git-ignored; whether a human really approved is a property of the conversation — the plugin makes approval explicit and any later edit detectable; with `bypassPermissions` or broad allow rules, the handling of `ask` decisions is defined by Claude Code (`deny` always applies). For hard isolation of the application repository, also use Claude Code permission rules or OS permissions.

The guard is active only when the session runs inside, or a tool targets, a directory containing `matrix-qa.config.json`; elsewhere it allows everything, so installing the plugin does not affect other repositories.

## Development

```bash
node scripts/validate-plugin.mjs        # structure, references, templates, example; runs `claude plugin validate --strict` when available
node --test scripts/test/               # unit tests: config, plan format and state machine, LLD diff, traceability, results, init, guard, validator
node scripts/e2e-example.mjs            # fresh QA repo from templates + example feature + real Playwright runs (needs npm network access and browsers)
```

Versioning follows [Semantic Versioning](https://semver.org/); keep `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json` and the top entry of [CHANGELOG.md](CHANGELOG.md) in sync (the validator checks it).
