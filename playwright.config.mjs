import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..', '.claude', 'skills', 'qa-dashboard');
// Template assumes user runs `qa-dashboard scaffold` which copies this to repo root.
// Adjust SKILL path if you moved the skill.
const HARNESS = resolve(process.env.QA_DASHBOARD_SKILL ?? `${process.env.HOME}/.claude/skills/qa-dashboard`, 'harness');

export default defineConfig({
  testDir: HARNESS,
  testMatch: ['invariants/*.spec.mjs', 'auth.setup.mjs'],

  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,
  timeout: 60_000,
  expect: { timeout: 30_000 },

  globalSetup: resolve(HARNESS, 'globalSetup.mjs'),

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '.qa-dashboard/html-report' }],
    ['junit', { outputFile: '.qa-dashboard/junit.xml' }],
    ...(process.env.GITHUB_ACTIONS ? [['github']] : []),
    [resolve(HARNESS, 'notify-reporter.mjs')],
  ],

  use: {
    baseURL: process.env.QA_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-qa',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.mjs/,
    },
    {
      name: 'invariants',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
