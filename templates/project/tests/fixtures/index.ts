import { test as base, expect } from '@playwright/test';
import { getTestData, type TestData } from './test-data';
import { getUser, type TestUser, type UserRole } from './users';

/**
 * Project fixtures. Specs import { test, expect } from here instead of '@playwright/test'.
 * Page objects are registered below as fixtures, one per page, e.g.:
 *   loginPage: async ({ page }, use) => { await use(new LoginPage(page)); },
 */
type Fixtures = {
  testData: TestData;
  userFor: (role: UserRole) => TestUser;
};

export const test = base.extend<Fixtures>({
  testData: async ({}, use) => {
    await use(getTestData());
  },
  userFor: async ({}, use) => {
    await use(getUser);
  },
});

export { expect };
