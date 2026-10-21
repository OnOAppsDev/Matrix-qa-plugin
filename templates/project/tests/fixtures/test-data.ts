import { currentEnvironmentName } from './environment';

/**
 * Static, non-sensitive test data. Shared values go in `common`; values that differ per
 * environment go in `byEnvironment` under the environment names from matrix-qa.config.json.
 */
const common = {
  // e.g. invalidEmail: 'not-an-email',
};

const byEnvironment: Record<string, Partial<typeof common>> = {
  // qa: { ... },
  // staging: { ... },
};

export type TestData = typeof common;

export function getTestData(environment: string = currentEnvironmentName()): TestData {
  return { ...common, ...(byEnvironment[environment] ?? {}) };
}
