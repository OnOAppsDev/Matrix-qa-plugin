import fs from 'node:fs';
import path from 'node:path';
import { devices, type Project } from '@playwright/test';

/**
 * Reads matrix-qa.config.json and turns it into Playwright settings.
 * Shared by playwright.config.ts and the fixtures so both agree on the environment.
 */

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface EnvironmentConfig {
  baseUrl: string;
  protected?: boolean;
  description?: string;
}

export interface MatrixQaConfig {
  projectId: string;
  language?: 'he' | 'en';
  paths?: { testDir?: string; [key: string]: string | undefined };
  environments: Record<string, EnvironmentConfig>;
  defaultEnvironment: string;
  browsers?: BrowserName[];
  devices?: Record<string, string>;
  defaultProjects?: string[];
}

const DESKTOP_DEVICE: Record<BrowserName, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
};

/** Nearest matrix-qa.config.json from the working directory upwards (MQA_CONFIG overrides). */
export function configPath(): string {
  if (process.env.MQA_CONFIG) return path.resolve(process.env.MQA_CONFIG);
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, 'matrix-qa.config.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('matrix-qa.config.json not found; run Playwright from the QA repository root');
    dir = parent;
  }
}

export function loadConfig(): MatrixQaConfig {
  return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as MatrixQaConfig;
}

/** Loads .env (never committed) without overriding variables already set, e.g. by CI. */
export function loadLocalEnv(): void {
  const file = path.join(path.dirname(configPath()), '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function currentEnvironmentName(config: MatrixQaConfig = loadConfig()): string {
  return process.env.MQA_ENV || config.defaultEnvironment;
}

export function resolveEnvironment(config: MatrixQaConfig = loadConfig()): { name: string; baseURL: string } {
  const name = currentEnvironmentName(config);
  const env = config.environments[name];
  if (!env) {
    throw new Error(`Unknown environment "${name}". Available: ${Object.keys(config.environments).join(', ')}`);
  }
  if (env.protected && process.env.MQA_CONFIRM_PROTECTED !== name) {
    throw new Error(`Environment "${name}" is protected. Set MQA_CONFIRM_PROTECTED=${name} to run against it deliberately.`);
  }
  return { name, baseURL: process.env.MQA_BASE_URL || env.baseUrl };
}

/** Every configured browser and device profile, filtered by MQA_PROJECTS or defaultProjects. */
export function resolveProjects(config: MatrixQaConfig = loadConfig()): Project[] {
  const all: Project[] = [
    ...(config.browsers ?? ['chromium']).map((browser) => ({
      name: browser,
      use: { ...devices[DESKTOP_DEVICE[browser]] },
    })),
    ...Object.entries(config.devices ?? {}).map(([name, device]) => {
      if (!devices[device]) throw new Error(`devices.${name}: "${device}" is not a Playwright device name`);
      return { name, use: { ...devices[device] } };
    }),
  ];
  // An explicit --project chooses from every configured project. Workers inherit this variable,
  // so the main process and the workers always see the same project list.
  if (!process.env.MQA_PROJECTS && process.argv.some((a) => a === '--project' || a.startsWith('--project='))) {
    process.env.MQA_PROJECTS = 'all';
  }
  const selection = process.env.MQA_PROJECTS || (config.defaultProjects ?? ['chromium']).join(',');
  if (selection === 'all') return all;
  const wanted = selection.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !all.some((p) => p.name === w));
  if (unknown.length) {
    throw new Error(`Unknown project(s) ${unknown.join(', ')}. Available: ${all.map((p) => p.name).join(', ')}`);
  }
  return all.filter((p) => wanted.includes(p.name!));
}

/**
 * playwright-report/<feature>/<date>_<time>-<environment>-<projects>: one HTML report folder per run,
 * grouped by feature ("all" when no spec file or test case filter was given), so earlier reports are
 * kept. `npm run report` opens the latest. MQA_REPORT_DIR overrides the folder.
 */
export function reportFolder(environment: string, projects: Project[]): string {
  // Workers load the config again; the variable keeps the folder the main process chose.
  if (!process.env.MQA_REPORT_DIR) {
    const argv = process.argv;
    const values = (flags: string[]) =>
      argv.flatMap((a, i) => {
        const eq = flags.find((f) => a.startsWith(`${f}=`));
        return flags.includes(a) ? [argv[i + 1] ?? ''] : eq ? [a.slice(eq.length + 1)] : [];
      });
    // Spec files name the feature (login.spec.ts → login); otherwise a test case filter does (--grep "LOGIN-TC-" → login).
    // shortcut: --grep maps the feature ID to lower case, which differs from the file name when the two were named differently.
    const specs = argv.filter((a) => /\.spec\.[cm]?[jt]sx?(:\d+)*$/.test(a)).map((a) => path.basename(a).replace(/\.spec\..*$/, ''));
    const ids = values(['--grep', '-g']).flatMap((g) => /^\^?([A-Z][A-Z0-9_]*)-TC-/.exec(g)?.[1].toLowerCase() ?? []);
    const feature = [...new Set(specs.length ? specs : ids)].join('+') || 'all';
    const projectArgs = values(['--project']);
    const names = projectArgs.length ? projectArgs : projects.map((p) => p.name!);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safe = (text: string) => text.replace(/[^\w.+-]/g, '_').slice(0, 60);
    process.env.MQA_REPORT_DIR = path.join('playwright-report', safe(feature), `${stamp}-${environment}-${safe(names.join('+'))}`);
  }
  return process.env.MQA_REPORT_DIR;
}
