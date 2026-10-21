import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  protected readonly path = '/login';
  readonly email: Locator;
  readonly password: Locator;
  readonly showPassword: Locator;
  readonly submit: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    super(page);
    this.email = page.getByLabel('דוא"ל');
    this.password = page.getByLabel('סיסמה', { exact: true });
    this.showPassword = page.getByRole('button', { name: 'הצג סיסמה' });
    this.submit = page.getByRole('button', { name: 'התחברות' });
    this.error = page.getByRole('alert');
  }

  async login(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
