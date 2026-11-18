/** Exercise real operational evidence navigation with automatic console-error capture. */
import { test, expect } from './fixtures.js';
import { navigatePrimary } from './helpers.js';

test('incident correlation to application and return, then separate reliability route', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  const listResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/incidents' && res.ok());
  await navigatePrimary(page, 'Operations');
  const records = (await (await listResponse).json()).data;
  expect(new Set(records.map((row) => row.recordType))).toEqual(new Set(['incident', 'problem_rca', 'major_incident']));
  const incident = records.find((row) => row.id === 'ticket-1');
  const linksResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/correlations' && new URL(res.url()).searchParams.get('incidentId') === incident.id && res.ok());
  await page.getByRole('list', { name: 'Operational records' }).getByRole('link', { name: incident.label, exact: true }).click();
  const links = (await (await linksResponse).json()).data;
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.relationshipLabel).toBe('represented correlation');
    await expect(page.getByRole('region', { name: 'Correlations', exact: true }).getByText(`Association: ${link.evidence.association}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Correlations', exact: true }).getByText(`${link.relationshipLabel} · ${link.sourceEntityId} → ${link.targetEntityId}`, { exact: true })).toBeVisible();
  }
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  const app = incident.businessContext.value.find((item) => item.value.type === 'application').value;
  const appResponse = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v1/applications/${app.id}` && res.ok());
  await page.getByRole('link', { name: `Open application · ${app.label}`, exact: true }).click();
  const profile = (await (await appResponse).json()).data;
  expect(profile.id).toBe(app.id);
  await expect(page.getByRole('heading', { name: profile.label, exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
});
