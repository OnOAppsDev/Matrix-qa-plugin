import { defineConfig } from '@playwright/test';
import { loadConfig, loadLocalEnv, reportFolder, resolveEnvironment, resolveProjects } from './tests/fixtures/environment';

/**
 * Standard Playwright configuration driven by matrix-qa.config.json.
 *
 *   npx playwright test                                   default environment and defaultProjects
 *   MQA_ENV=staging npx playwright test                   another environment
 *   npx playwright test --project=firefox                 any configured browser or device project
 *   MQA_PROJECTS=all npx playwright test                  every configured project
 *   npx playwright test tests/e2e/login.spec.ts           one feature
 *   npm run report                                        open the latest run's HTML report
 */
loadLocalEnv();
const config = loadConfig();
const environment = resolveEnvironment(config);
process.env.MQA_ENV = environment.name; // fixtures read the same environment in every worker
const projects = resolveProjects(config);

export default defineConfig({
  testDir: config.paths?.testDir ?? 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // --list only lists tests: no report folder, and the last run's results.json is kept.
  reporter: process.argv.includes('--list')
    ? [['list']]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: reportFolder(environment.name, projects) }],
        ['json', { outputFile: 'test-results/results.json' }],
      ],
  use: {
    baseURL: environment.baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Videos are off by default; use 'retain-on-failure' or 'on' when needed.
    video: 'off',
  },
  projects,
});
