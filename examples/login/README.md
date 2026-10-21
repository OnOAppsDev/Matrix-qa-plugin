# Example feature: login (Hebrew)

What a QA repository contains for one feature after `/qa-plan`, review, `/qa-approve` and `/qa-automate`:

| File | Produced by |
|---|---|
| `qa/lld/login.md` | the LLD author |
| `qa/test-cases/login.md` | `/qa-plan` (shown in `DRAFT` with its review findings recorded, ready for `/qa-review` → `/qa-approve`) |
| `tests/pages/LoginPage.ts`, `tests/pages/DashboardPage.ts` | `/qa-automate` |
| `tests/fixtures/index.ts` | the template's fixtures with the two page objects registered by `/qa-automate` |
| `tests/e2e/login.spec.ts` | `/qa-automate` (TC-009 excluded by partial approval, TC-011 not a good candidate) |

`app/` is a tiny demo application used only by the plugin's own end-to-end check (`node scripts/e2e-example.mjs`), which initialises a fresh QA repository from `templates/project`, copies this example over it, drives the plan through the approval gates and runs the tests on Chromium, Firefox, WebKit, mobile and tablet projects.
