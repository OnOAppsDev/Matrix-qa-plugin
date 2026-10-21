import { test, expect } from '../fixtures';

// Automated from qa/test-cases/login.md (approved, partial: LOGIN-TC-009 excluded).
// LOGIN-TC-011 is not automated: it needs a browser restart with a persisted session.

const INVALID_EMAIL = 'יש להזין כתובת דוא"ל תקינה';
const INVALID_PASSWORD_LENGTH = 'הסיסמה חייבת להכיל 8 עד 64 תווים';
const INVALID_CREDENTIALS = 'הדוא"ל או הסיסמה שגויים';

test.describe('Login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.open();
  });

  test('LOGIN-TC-001: valid credentials open the dashboard', async ({ page, loginPage, dashboardPage, userFor }) => {
    const user = userFor('standard');
    await loginPage.login(user.username, user.password);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(dashboardPage.greeting).toHaveText(/^שלום, .+/);
  });

  test('LOGIN-TC-002: empty email shows the email validation message', async ({ page, loginPage }) => {
    await loginPage.login('', 'Valid-pass1');

    await expect(loginPage.error).toHaveText(INVALID_EMAIL);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('LOGIN-TC-003: email without @ shows the email validation message', async ({ page, loginPage }) => {
    await loginPage.login('user.example.com', 'Valid-pass1');

    await expect(loginPage.error).toHaveText(INVALID_EMAIL);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('LOGIN-TC-004: 7-character password is rejected before submission', async ({ loginPage }) => {
    await loginPage.login('user@example.com', 'Abcdef1');

    await expect(loginPage.error).toHaveText(INVALID_PASSWORD_LENGTH);
  });

  test('LOGIN-TC-005: 8-character password passes validation and is submitted', async ({ loginPage }) => {
    await loginPage.login('nobody@example.com', 'Abcdef12');

    await expect(loginPage.error).toHaveText(INVALID_CREDENTIALS);
  });

  test('LOGIN-TC-006: 65-character password is rejected', async ({ loginPage }) => {
    await loginPage.login('user@example.com', 'a'.repeat(65));

    await expect(loginPage.error).toHaveText(INVALID_PASSWORD_LENGTH);
  });

  test('LOGIN-TC-007: wrong password shows the generic credentials message', async ({ page, loginPage, userFor }) => {
    await loginPage.login(userFor('standard').username, 'Wrong-pass1');

    await expect(loginPage.error).toHaveText(INVALID_CREDENTIALS);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('LOGIN-TC-008: unknown email shows the same generic credentials message', async ({ loginPage }) => {
    await loginPage.login('no-such-user@example.com', 'Valid-pass1');

    await expect(loginPage.error).toHaveText(INVALID_CREDENTIALS);
  });

  test('LOGIN-TC-010: show password toggles between visible and hidden', async ({ loginPage }) => {
    await loginPage.password.fill('Valid-pass1');

    await loginPage.showPassword.click();
    await expect(loginPage.password).toHaveAttribute('type', 'text');

    await loginPage.showPassword.click();
    await expect(loginPage.password).toHaveAttribute('type', 'password');
  });
});
