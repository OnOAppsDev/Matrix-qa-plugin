---
description: Initialise (or migrate) a Matrix QA repository — inspect, propose the structure, wait for approval, create only approved files, validate.
argument-hint: "[project-id]"
---

# /qa-init

Initialise the current repository as a Matrix QA repository. Arguments: `$ARGUMENTS` (optional project id).

`MQA` below means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs"`. Approval rules: `${CLAUDE_PLUGIN_ROOT}/docs/approvals-and-safety.md`.

**Language:** ask every question and write every report in the project language (`language` in `matrix-qa.config.json`), using the fixed option wordings in `${CLAUDE_PLUGIN_ROOT}/docs/conversation-language.md`; identifiers stay in English.

## 1. Inspect (read-only)

1. Run `MQA init inspect`. It reports `package.json`, Playwright version and config files, the configured `testDir`, existing specs and page-object folders, whether `matrix-qa.config.json` exists and is valid, and for every template file whether it would be `create`d, `merge`d (`package.json`, `.gitignore` — additive only), is `identical`, or is a `conflict`.
2. Read-only git inspection is allowed (`git status`) to warn about uncommitted changes. No git writes.
3. If `matrix-qa.config.json` already exists and is valid and nothing is missing, report "already initialised", show the validation result and stop.

## 2. Collect settings

If there is no valid config yet, first ask the language on its own, in both languages, as described in `docs/conversation-language.md` (default Hebrew). Everything after that — including the remaining questions — is in the chosen language.

Then ask (with `AskUserQuestion`, at most 4 questions per call) only for what is missing:

- `projectId` (default: `$ARGUMENTS` or the folder name, kebab-case);
- environments: names and base URLs (e.g. `dev`, `qa`, `staging`, `production`); which one is the default; which are `protected` (production should be);
- the application source repository path (optional; it will be read-only);
- browsers (default all three available, `chromium` run by default) and device profiles (default `mobile-chrome: Pixel 7`, `mobile-safari: iPhone 15`, `tablet: iPad (gen 7)`).

Never ask for credentials. Users are configured as environment variable names in `.env.example`.

## 3. Propose

Show one proposal:

- the `matrix-qa.config.json` content (start from `${CLAUDE_PLUGIN_ROOT}/templates/matrix-qa.config.example.json`);
- the directory structure: `qa/lld/`, `qa/test-cases/` (with `.lld-baseline/`), `tests/e2e/`, `tests/pages/`, `tests/fixtures/`;
- each template file and its action from `init inspect`; for merges, exactly which scripts, devDependencies and `.gitignore` lines are added;
- **conflicts**: each existing file that differs from the template is kept untouched. If an existing Playwright project is present (`migrationProposalNeeded`), write a **migration proposal** instead of changing it: how the existing `playwright.config.*` can read `matrix-qa.config.json` (environments, projects), where existing specs and page objects map onto `paths` (set `testDir`, `pagesDir`, `fixturesDir` to the existing folders rather than moving files), which template files can be added side by side, and what would have to change by hand. Migration edits are listed separately and are **not** applied in this run unless the QA engineer approves each one.

Then ask for explicit approval with `AskUserQuestion`: "Apply this initialisation" / "Change settings" / "Cancel" (Hebrew: "החלת ההגדרה" / "שינוי הגדרות" / "ביטול").

## 4. Apply only what was approved

1. Write `matrix-qa.config.json` (only if it does not exist, or the QA engineer approved the exact change), then `MQA config validate`; fix and re-confirm if it fails.
2. `MQA init apply <comma-separated approved targets>` (or `all` when everything listed was approved). The guard asks for confirmation; the script never overwrites and reports `created`, `merged`, `skipped`.
3. Apply individually approved migration edits, if any.

## 5. Validate and report

- `MQA config validate`.
- If `node_modules` is missing: tell the QA engineer to run `npm install` and `npx playwright install` (do not install without their agreement). If installed: `npx tsc --noEmit` and `npx playwright test --list`.
- Report the files created/merged/skipped, the validation output, and next steps: copy `.env.example` to `.env` and fill it in by hand; put the first LLD in `qa/lld/<feature>.md`; if the project has Figma designs, connect Figma once (`/mcp` → the Figma server → authenticate); run `/qa-plan qa/lld/<feature>.md [--figma <frame link>]`; review and commit the changes with git yourself.
