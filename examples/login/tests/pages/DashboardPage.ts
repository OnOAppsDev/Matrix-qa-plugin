import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  protected readonly path = '/dashboard';
  readonly greeting: Locator;

  constructor(page: Page) {
    super(page);
    this.greeting = page.getByRole('heading', { level: 1 });
  }
}
