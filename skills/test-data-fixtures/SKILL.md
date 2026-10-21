---
name: test-data-fixtures
description: Static test data, predefined users, environment-specific data and credential handling through environment variables in Matrix QA Playwright projects. Used by the playwright-engineer agent and by /qa-run.
user-invocable: false
---

# Test data and fixtures

The initial version uses **static** data only. There is no data generation or cleanup framework: a test that needs data relies on data that already exists in the environment, documented in the manual case's preconditions.

## Where things live

| What | File | Rule |
|---|---|---|
| Users and roles | `tests/fixtures/users.ts` | `USER_ROLES` maps a role to the **names** of its environment variables; `getUser(role)` reads them and fails with the variable name (never the value) when one is missing |
| Static data | `tests/fixtures/test-data.ts` | `common` for shared values, `byEnvironment[<env>]` for values that differ per environment |
| Fixtures | `tests/fixtures/index.ts` | `testData`, `userFor(role)`, and one fixture per page object |
| Variable names | `.env.example` (committed) | every variable the tests read, with an empty value |
| Values | `.env` (git-ignored, local) or CI secrets | filled by the QA engineer, never by Claude |

## Credentials

- Never write a credential, token or real personal data into any file. The guard hook blocks common credential patterns, but it cannot recognise an ordinary password — the rule is yours to follow.
- Never read or print `.env` (the guard denies it). To know which variables exist, read `.env.example`.
- Never log credentials: no `console.log(user)`, no credential in a test title, annotation or error message.
- Adding a role: add it to `USER_ROLES`, add `MQA_USER_<ROLE>_USERNAME` / `_PASSWORD` to `.env.example`, and tell the QA engineer which variables to set locally and in CI.

## Environment-specific data

`process.env.MQA_ENV` is set by `playwright.config.ts` to the resolved environment for every worker; `getTestData()` picks `byEnvironment[MQA_ENV]`. Keep values non-sensitive (IDs of seeded records, product names, feature-flag expectations).

## Test data in specs

- Literal values that come from the manual case (`'user.example.com'`, a 65-character string built with `'a'.repeat(65)`) may live in the spec next to the test, since they *are* the case.
- Values reused by several specs, or that differ per environment, go to `test-data.ts`.
- Tests that change shared server data (lockouts, deletions) need a dedicated user/record documented in the case's preconditions, so parallel runs do not interfere.
