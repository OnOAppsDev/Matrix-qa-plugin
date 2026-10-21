# Changelog

All notable changes to this plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

First release.

### Added
- Commands: `/qa-init`, `/qa-plan`, `/qa-review`, `/qa-approve`, `/qa-sync`, `/qa-automate`, `/qa-run`.
- Agents: `requirements-analyzer`, `code-analyzer` (read-only tools), `test-designer`, `qa-reviewer` (read-only tools), `playwright-engineer`.
- Skills: LLD analysis, manual test case design, requirement traceability, QA review standards, Playwright TypeScript, Page Object Model, locator strategy, test data and fixtures, failure analysis, LLD change impact analysis.
- One Markdown test plan per feature (`qa/test-cases/<feature>.md`) with stable IDs, requirement coverage, assumptions, open questions, review findings, retired IDs, change log and approval record; Hebrew (default) and English templates.
- State model `DRAFT` → `REVIEWED` → `APPROVED`, plus `CHANGES_REQUIRED`, enforced by `scripts/mqa.mjs`; content and LLD fingerprints make an approval ineffective after any later change; partial approval while blocking questions remain open.
- LLD change detection by normalised SHA-256 fingerprints and a section-level baseline snapshot, mapped to affected requirements, test cases and Playwright tests.
- Playwright TypeScript project template driven by `matrix-qa.config.json`: environments (with protected environments), browsers, device profiles, default projects, `.env`-based credentials, HTML/JSON reports, screenshots and traces on failure.
- `hooks/guard.mjs` PreToolUse guard: denies git writes, application-source writes, `.env` access and credential patterns; asks before approvals, `--keep-approval`, template application, edits of approved plans and edits of existing automation.
- Figma as an optional design source: the plugin declares Figma's MCP server; `/qa-plan --figma` (or links in the LLD, or a question) feeds a screen inventory and LLD/design comparison into the plan; the reviewer checks design coverage; `/qa-sync --figma` re-checks the design; the guard keeps Figma read-only.
- One HTML report folder per run, grouped by feature (`playwright-report/<feature>/<date>_<time>-<environment>-<projects>`), so earlier reports are kept; `npm run report` opens the latest (`-- <feature>`, `-- --list`, `-- <feature>/<run>`); `/qa-run` offers to open it.
- Conversation in the project language: with `language: he` every question, approval choice, report and guard confirmation prompt is in Hebrew (`docs/conversation-language.md`); `/qa-init` asks the language first.
- Installable from GitHub: the repository is its own marketplace (`matrix-qa`, `.claude-plugin/marketplace.json`).
- Validation: `scripts/validate-plugin.mjs`, unit tests (`node --test scripts/test/`), end-to-end check `scripts/e2e-example.mjs` with a Hebrew login example.

[0.1.0]: https://github.com/OnOAppsDev/Matrix-qa-plugin/releases/tag/v0.1.0
