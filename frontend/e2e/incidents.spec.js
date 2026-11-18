/** Exercise real operational evidence navigation with automatic console-error capture. */
import { test, expect } from './fixtures.js';
import { navigatePrimary } from './helpers.js';

test('unlinked incident remains unavailable and missing week metrics never fall back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  const listResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/incidents' && res.ok());
  await navigatePrimary(page, 'Operations');
  const incident = (await (await listResponse).json()).data.find((row) => row.id === 'ticket-2');
  expect(incident.businessContext).toEqual({ availability: 'unavailable', value: null });
  const linksResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/correlations' && new URL(res.url()).searchParams.get('incidentId') === incident.id && res.ok());
  await page.getByRole('list', { name: 'Operational records' }).getByRole('link', { name: incident.label, exact: true }).click();
  const links = await (await linksResponse).json();
  expect(links.data).toEqual([]);
  expect(links.availability).toBe('unavailable');
  await expect(page.getByRole('region', { name: 'Business impact context' }).getByRole('status')).toContainText('Unavailable');
  await expect(page.getByText('Unavailable — no represented correlation supplied.', { exact: true })).toBeVisible();
});
