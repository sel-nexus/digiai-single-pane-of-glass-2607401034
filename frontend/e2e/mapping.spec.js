import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { test as base, expect } from './fixtures.js';
import { navigatePrimary, responseFor, enterAdmin, save, readConfig } from './helpers.js';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const backend = fileURLToPath(new URL('../../backend/', import.meta.url));

// Each invocation gets a real backend, disposable SQLite file and Vite proxy.
// The API cannot restore represented_context or remove the resulting audit record.
const test = base.extend({
  baseURL: async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'digiai-mapping-e2e-'));
    let child, vite, exited;
    try {
      const env = { ...loadEnv('test', frontend, ''), ...process.env };
      const python = env.E2E_PYTHON === 'python' || !env.E2E_PYTHON
        ? path.join(os.homedir(), 'venvs/app/bin/python') : env.E2E_PYTHON;
      child = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '0'], {
        cwd: backend,
        env: { ...process.env, DATABASE_PATH: path.join(dir, 'mapping.db'), SEED_ON_STARTUP: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      exited = new Promise((resolve) => child.once('close', resolve));
      const apiURL = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => finish(new Error(`Mapping backend startup timed out: ${output}`)), 25000);
        const finish = (error, url) => {
          clearTimeout(timer);
          child.off('error', onError);
          child.off('close', onClose);
          child.stdout.off('data', onData);
          child.stderr.off('data', onData);
          if (error) reject(error); else resolve(url);
        };
        const onError = (error) => finish(error);
        const onClose = (code) => finish(new Error(`Mapping backend exited (${code}): ${output}`));
        const onData = (chunk) => {
          output += chunk.toString();
          const match = output.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) finish(null, match[1]);
        };
        child.once('error', onError);
        child.once('close', onClose);
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
      });
      // Continue draining backend logs after detecting readiness.
      child.stdout.resume();
      child.stderr.resume();
      vite = await createServer({
        root: frontend,
        configFile: false,
        plugins: [react()],
        define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
        server: { host: '127.0.0.1', port: 5174, strictPort: false, proxy: { '/api': { target: apiURL, changeOrigin: true } } },
      });
      await vite.listen();
      await use(`http://127.0.0.1:${vite.httpServer.address().port}`);
    } finally {
      try {
        if (vite) await vite.close();
      } finally {
        if (child) {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          const forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
          await exited;
          clearTimeout(forceKill);
        }
        await rm(dir, { recursive: true, force: true });
      }
    }
  },
  request: async ({ playwright, baseURL }, use) => {
    const request = await playwright.request.newContext({ baseURL });
    try {
      await use(request);
    } finally {
      await request.dispose();
    }
  },
});

test('explicit relationship save reflects on journey overlay', async ({ page, request }) => {
  const catalog = await readConfig(request);
  const original = catalog.relationships.find((r) => r.sourceEntityId === 'journey-enrollment' && r.targetEntityId === 'app-0001' && r.type === 'depends_on');
  expect(original).toBeTruthy();
  await enterAdmin(page);
  await page.getByLabel('Existing relationship').selectOption(original.relationshipId);
  await page.getByLabel('Represented relationship type').selectOption('impact');
  const saved = await save(page, 'Save explicit mapping', '/admin/mappings');
  expect(saved.config.type).toBe('impact');
  await expect(page.getByText('Mapping saved and confirmed.', { exact: true })).toBeVisible();
  await navigatePrimary(page, 'Journeys');
  const response = responseFor(page, '/journeys/journey-enrollment');
  await page.getByRole('link', { name: 'Member Enrollment', exact: true }).click();
  const journey = (await (await response).json()).data;
  const mapped = journey.impactOverlay.value.find((r) => r.id === original.relationshipId);
  expect(mapped.type).toBe('impact');
  expect(mapped.target.entityId).toBe(original.targetEntityId);
  expect(journey.dependency.value?.some((r) => r.id === original.relationshipId) ?? false).toBe(false);
  await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Impact relationships' });
  await expect(panel.getByText(`${mapped.sourceLabel} → ${mapped.target.label}`, { exact: true })).toBeVisible();
  await expect(panel.getByText(mapped.representedContext, { exact: true })).toBeVisible();
});
