/** Start both real tiers and cover desktop and mobile persona journeys. */
import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';
import path from 'node:path';
import os from 'node:os';

const env = { ...loadEnv('test', process.cwd(), ''), ...process.env };
const baseURL = env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const apiURL = env.E2E_API_URL || 'http://127.0.0.1:8000';
const python = env.E2E_PYTHON === 'python' || !env.E2E_PYTHON ? path.join(os.homedir(), 'venvs/app/bin/python') : env.E2E_PYTHON;
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: [
    { command: `"${python}" -m app.main`, cwd: path.resolve('../backend'), url: `${apiURL}/api/health`, reuseExistingServer: false, timeout: 30000, env: { DATABASE_PATH: path.join(os.tmpdir(), `digiai-e2e-${process.pid}.db`), BIND_HOST: new URL(apiURL).hostname, BIND_PORT: new URL(apiURL).port || '8000', SEED_ON_STARTUP: 'true' } },
    { command: 'node node_modules/vite/bin/vite.js', url: baseURL, reuseExistingServer: false, timeout: 30000, env: { DEV_HOST: new URL(baseURL).hostname, DEV_PORT: new URL(baseURL).port || '5173', DEV_API_PROXY_TARGET: apiURL } },
  ],
});
