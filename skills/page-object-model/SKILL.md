---
name: page-object-model
description: Page Object Model rules for Matrix QA Playwright projects — what a page object contains, naming, reuse of existing page objects, registration as fixtures, and responsive behaviour. Used by the playwright-engineer agent.
user-invocable: false
---

# Page Object Model

## What a page object is

One class per page or significant reusable component (`LoginPage`, `HeaderComponent`), in `tests/pages/`, extending `BasePage` for pages.

```ts
import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  protected readonly path = '/login';
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    super(page);
    this.email = page.getByLabel('דוא"ל');
    this.password = page.getByLabel('סיסמה');
    this.submit = page.getByRole('button', { name: 'התחברות' });
    this.error = page.getByRole('alert');
  }

  async login(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
```

## Rules

- **Locators** are `readonly` properties built in the constructor (see `locator-strategy`). Expose them so specs can assert on them.
- **Methods** are user intentions (`login`, `search`, `openProfileMenu`), not wrappers of single clicks, and contain no assertions — specs assert. A method may wait for the state it needs (e.g. `await expect(this.dialog).toBeVisible()` before acting is acceptable only as synchronisation, not as the test's verification).
- **Paths** are relative (`/login`); `baseURL` comes from the environment.
- No test data, credentials, or environment logic inside page objects.
- Naming: PascalCase class + `Page`/`Component`, file named like the class.

## Reuse before creating

1. Search `tests/pages/` (and `pagesDir` from config) for a page object covering the screen.
2. Reuse it; add missing locators or methods to it rather than creating a parallel class. Adding to an existing file is a change to existing automation — list it in the proposal for approval.
3. Create a new class only for a screen without one.

## Fixtures

Register each page object once in `tests/fixtures/index.ts` so specs receive it:

```ts
loginPage: async ({ page }, use) => { await use(new LoginPage(page)); },
```

Editing `index.ts` is a change to an existing file and needs approval like any other.

## Responsive behaviour

Viewport differences (collapsed navigation, drawers) are handled inside the page object, using `this.page.viewportSize()` or the `isMobile` fixture passed in, so specs stay identical across desktop, tablet and mobile projects.
