---
name: playwright-typescript
description: Conventions for generated Playwright Test TypeScript in Matrix QA repositories — file layout, test titles with manual test case IDs, meaningful web-first assertions, waiting, projects for browsers and devices, and technical validation. Used by the playwright-engineer agent for /qa-automate.
user-invocable: false
---

# Playwright TypeScript

Generated code is plain Playwright Test. It must run with `npx playwright test` with no Claude Code, plugin or MCP present, locally and in CI.

## Layout

| What | Where (config `paths`) |
|---|---|
| Specs, one per feature | `tests/e2e/<feature>.spec.ts` |
| Page objects | `tests/pages/<Name>Page.ts` — see `page-object-model` |
| Fixtures, users, static data | `tests/fixtures/` — see `test-data-fixtures` |
| Configuration | `playwright.config.ts` reads `matrix-qa.config.json`; never hardcode URLs or projects in specs |

## Spec shape

```ts
import { test, expect } from '../fixtures';

test.describe('Login', () => {
  test('LOGIN-TC-001: valid credentials open the dashboard', async ({ loginPage, userFor, page }) => {
    const user = userFor('standard');
    await loginPage.open();
    await loginPage.login(user.username, user.password);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /שלום,/ })).toBeVisible();
  });
});
```

- Import `test` and `expect` from the project fixtures, not from `@playwright/test`, so fixtures are available.
- Title: `'<TC-ID>: <short English or project-language title>'`, exactly one ID, matching the manual case.
- One manual test case → one test (or one parameterised loop of tests sharing the ID for data variants).
- Tests are independent: no order dependence, no shared mutable state, each starts from a URL.
- `test.describe` groups by feature or screen; tags are optional (`{ tag: '@smoke' }`) and never replace the ID.

## Assertions

Every test asserts the manual case's expected result — a test that only clicks through proves nothing.

- Use web-first assertions that retry: `toBeVisible`, `toHaveText`, `toContainText`, `toHaveURL`, `toHaveValue`, `toBeEnabled`/`toBeDisabled`, `toHaveAttribute`, `toHaveCount`.
- Assert exact texts the LLD defines (messages, headings). Prefer `toHaveText` with the full defined string.
- Assert what must **not** happen when the case says so: `await expect(page).toHaveURL(/\/login$/)`, `await expect(errorBox).toBeHidden()`.
- Never `expect(await locator.isVisible()).toBe(true)` — it does not retry.

## Waiting

- Never `page.waitForTimeout()` or fixed sleeps. Wait through assertions, `locator.waitFor()`, `page.waitForURL()`, or `page.waitForResponse()` for a specific request.
- Do not raise global timeouts to hide slowness; report it.

## Browsers and devices

- Projects come from `browsers`, `devices` and `defaultProjects` in `matrix-qa.config.json`. Specs stay project-agnostic.
- A case that only applies to one form factor uses `test.skip(({ isMobile }) => !isMobile, 'mobile layout only')` with a reason — not a separate copy of the test.
- Responsive differences belong in the page object (e.g. opening a hamburger menu when `isMobile`), not in the spec.

## Not automated

When a manual case is selected but a step cannot be automated reliably, write `test.fixme('<TC-ID>: …', …)` with a comment stating the reason, rather than a weak test.

## Validation (run and report, never claim without output)

```bash
npx tsc --noEmit                     # types
npx playwright test --list           # specs load, titles and projects resolve
npx playwright test <spec> --project=chromium   # only when the QA engineer agreed to run against the environment
node "${CLAUDE_PLUGIN_ROOT}/scripts/mqa.mjs" trace <feature>
```

If dependencies are not installed, say so and give the install command (`npm install && npx playwright install`) instead of skipping silently.
