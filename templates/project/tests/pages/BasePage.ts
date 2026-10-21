import type { Page } from '@playwright/test';

/**
 * Base for page objects. A page object exposes user-level actions and locators;
 * assertions stay in the specs. Paths are relative to the environment's baseURL.
 */
export abstract class BasePage {
  protected abstract readonly path: string;

  constructor(readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(this.path);
  }
}
