---
name: locator-strategy
description: Accessibility-first locator selection for Playwright — priority order, how to derive locators from the LLD, source code or a live browser, what to avoid, and how to report missing stable locators without touching application code. Used by the code-analyzer and playwright-engineer agents.
user-invocable: false
---

# Locator strategy

## Priority

1. `page.getByRole(role, { name })` — buttons, links, headings, textboxes, checkboxes, dialogs, alerts.
2. `page.getByLabel(text)` — form fields with a label.
3. `page.getByPlaceholder(text)` — fields without a label.
4. `page.getByText(text)` — static text without a role; use `{ exact: true }` for short strings.
5. `page.getByTestId(id)` — when none of the above is stable or unique (e.g. repeated rows, icons without names).

Scope to a container when names repeat: `page.getByRole('dialog').getByRole('button', { name: 'שמירה' })`. Use `.filter({ hasText })` over `.nth()`.

## Avoid

- CSS chains, generated class names (`.css-1x2y3z`), XPath, DOM position (`nth-child`), and text that changes with data.
- `{ force: true }`, `page.$`, `page.evaluate` for clicking.
- Locators built from translated text that the LLD does not define; prefer roles + defined labels.

## Where locator information comes from

| Source | Use |
|---|---|
| LLD | the defined labels, button texts and messages — the primary source of accessible names |
| Application source (read-only, `paths.appSourcePath`) | confirm roles, `aria-label`, `<label for>`, `data-testid` attributes; detect where the implementation differs from the LLD |
| Playwright MCP / `npx playwright codegen` (optional) | interactive exploration of a running environment, when available. Never a dependency; the result is always rewritten as standard locators in a page object |

## Missing stable locators

If an element has no accessible name and no test id:

- Use the most stable available option and add a comment `// Locator limitation: <element> has no accessible name or data-testid` in the page object.
- Report it in the automation summary with a concrete recommendation for the development team (e.g. "add `aria-label="סגירה"` to the close icon button in `src/components/Modal.tsx`").
- **Never modify the application source** to add attributes — the application repository is read-only.

## Hebrew / RTL

Accessible names in Hebrew work exactly like English ones. Quote them exactly as rendered (including geresh/gershayim, e.g. `דוא"ל` — use single-quoted TypeScript strings). Use a `RegExp` only for genuinely dynamic parts (`/שלום, .+/`).
