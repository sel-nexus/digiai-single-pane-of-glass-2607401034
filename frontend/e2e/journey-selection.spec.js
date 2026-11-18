import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, selectPersona } from './helpers.js';

test('journey selection renders bounded source identities and retains list origin on return', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  const response = responseFor(page, '/journeys');
  await navigatePrimary(page, 'Journeys');
  const body = await (await response).json();
  expect(body.data.map((j) => j.id)).toEqual(['journey-enrollment', 'journey-renewal']);
  for (const journey of body.data) {
    await expect(page.getByRole('link', { name: journey.label, exact: true })).toBeVisible();
    await expect(page.getByText(`${journey.id} · Source: ${journey.source} · ${journey.sourceRef}`, { exact: true })).toBeVisible();
  }
  const origin = page.url();
  const detail = responseFor(page, '/journeys/journey-enrollment');
  await page.getByRole('link', { name: body.data[0].label, exact: true }).click();
  const journey = (await (await detail).json()).data;
  expect(journey.id).toBe(body.data[0].id);
  await expect(page.getByRole('heading', { name: journey.label, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await expect(page).toHaveURL(origin);
});
