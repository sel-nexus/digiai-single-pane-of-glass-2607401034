import { test, expect } from './fixtures.js';
import { responseFor, selectPersona } from './helpers.js';

test('supplied journey scenario fetches actual evidence and returns persona theme and filters', async ({ page }) => {
  await page.goto('/');
  const dashboard = await selectPersona(page, 'Engineering', 'engineering');
  await page.getByText('Shared filters (0 selected)').click();
  await page.getByLabel('Domain', { exact: true }).selectOption('domain-member');
  await page.getByRole('button', { name: /Use (dark|light) theme/ }).click();
  const theme = await page.locator('html').getAttribute('data-theme');
  const scenario = dashboard.scenarios.find((s) => s.destination === '/journeys/journey-enrollment');
  expect(scenario).toBeTruthy();
  const origin = page.url();
  const response = responseFor(page, '/journeys/journey-enrollment');
  await page.getByRole('heading', { name: scenario.label, exact: true }).locator('..').getByRole('link').click();
  const journey = (await (await response).json()).data;
  await expect(page.getByRole('heading', { name: journey.label, exact: true })).toBeVisible();
  await expect(page.getByText(`${journey.id} · Source: ${journey.source} · ${journey.sourceRef}`, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByRole('heading', { name: 'Engineering perspective' })).toBeVisible();
  await expect(page.getByLabel('Domain', { exact: true })).toHaveValues(['domain-member']);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});
