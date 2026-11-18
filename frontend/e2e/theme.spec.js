import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, selectPersona } from './helpers.js';

test('theme and persona context survive real portfolio navigation and return on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page, 'Engineering', 'engineering');
  const previous = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /Use (dark|light) theme/ }).click();
  const theme = previous === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const hierarchy = responseFor(page, '/hierarchy');
  await navigatePrimary(page, 'Portfolio');
  const nodes = (await (await hierarchy).json()).data;
  expect(nodes.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Portfolio explorer' })).toBeVisible();
  for (const node of nodes) await expect(page.getByRole('region', { name: 'Represented hierarchy' }).getByRole('button', { name: node.label, exact: true })).toBeVisible();
  const response = responseFor(page, '/dashboard', { personaId: 'engineering' });
  await navigatePrimary(page, 'Dashboard');
  const dashboard = (await (await response).json()).data;
  await expect(page.getByRole('heading', { name: `${dashboard.persona.label} perspective` })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});
