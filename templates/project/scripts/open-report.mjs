// Opens a Playwright HTML report. Reports are kept per run in playwright-report/<feature>/<run>.
//   npm run report                      latest run of any feature
//   npm run report -- login             latest run of the feature "login"
//   npm run report -- --list            list the kept runs
//   npm run report -- login/<run>       a specific run
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = 'playwright-report';
const dirs = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
const hasReport = (dir) => existsSync(join(dir, 'index.html'));
// Run folder names start with the date and time, so sorting by them puts the latest last.
const runs = dirs(root)
  .flatMap((feature) => dirs(join(root, feature)).filter((run) => hasReport(join(root, feature, run))).map((run) => ({ feature, run })))
  .sort((a, b) => a.run.localeCompare(b.run));
const arg = process.argv[2];

if (arg === '--list') {
  console.log(runs.length ? runs.map((r) => `${r.feature}/${r.run}`).join('\n') : 'No reports yet.');
  process.exit(0);
}
const latest = (list) => (list.length ? join(root, list.at(-1).feature, list.at(-1).run) : null);
const folder = !arg ? latest(runs) : runs.some((r) => r.feature === arg) ? latest(runs.filter((r) => r.feature === arg)) : existsSync(arg) ? arg : join(root, arg);
if (!folder || !hasReport(folder)) {
  console.error(arg ? `No report for "${arg}". Kept runs:\n${runs.map((r) => `${r.feature}/${r.run}`).join('\n')}` : 'No reports yet: run the tests first (npm test).');
  process.exit(1);
}
console.log(`Opening ${folder}`);
const result = spawnSync('npx', ['playwright', 'show-report', folder], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
