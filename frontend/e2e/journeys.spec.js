/** Exercise represented journey evidence through real backend-driven navigation. */
import { test, expect } from './fixtures';

test('journey overlays, application profile and return retain source scope', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  await page.getByText('Shared filters (0 selected)').click();
  await page.getByLabel('Domain', { exact: true }).selectOption('domain-member');
  const listResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/journeys' && res.ok());
  await page.getByRole('link', { name: 'Journeys', exact: true }).click();
  const list = await (await listResponse).json();
  expect(list.data.map((row) => row.id)).toEqual(['journey-enrollment']);
  const detailResponse = page.waitForResponse((res) => res.url().includes('/journeys/journey-enrollment') && res.ok());
  await page.getByRole('link', { name: list.data[0].label, exact: true }).click();
  const detail = (await (await detailResponse).json()).data;
  await expect(page.getByRole('heading', { name: detail.label, exact: true })).toBeVisible();
  expect(detail.dependency.value.map((row) => row.target.entityId)).toEqual(['app-0001', 'api-enrollment']);
  await expect(page.getByRole('region', { name: 'Dependency relationships' })
    .getByText('Relationship source: sample · sample-v1')).toHaveCount(2);
  await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
  expect(detail.impactOverlay.value.map((row) => row.target.entityId)).toEqual(['api-enrollment']);
  await page.getByText('Inspect API asset · Enrollment API asset').click();
  await expect(page.getByText(/Represented API asset: api-enrollment/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Open application/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Dependency overlay', exact: true }).click();
  const origin = page.url();
  const profileResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/applications/app-0001' && res.ok());
  await page.getByRole('link', { name: 'Open application · Member Portal' }).click();
  const profile = (await (await profileResponse).json()).data;
  expect(profile.id).toBe('app-0001');
  expect(profile.label).toBe('Member Portal');
  expect(Object.keys(profile.categories)).toHaveLength(11);
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Health', exact: true }).getByText(profile.categories.health.value[0].value, { exact: true })).toBeVisible();
  const dependency = profile.categories.dependencies.value[0];
  await expect(page.getByRole('region', { name: 'Dependencies', exact: true }).getByText(dependency.value.id, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Dependencies', exact: true }).getByText(`Association: ${dependency.association}`, { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/applications/app-0001');
  await expect(page).toHaveURL(/domain=domain-member/);
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByRole('heading', { name: detail.label, exact: true })).toBeVisible();
  await expect(page.getByLabel('Domain', { exact: true })).toHaveValues(['domain-member']);
  await expect(page.getByRole('link', { name: 'Dependency overlay', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Dependency relationships' })
    .getByText('Relationship source: sample · sample-v1')).toHaveCount(2);
  await page.getByRole('link', { name: 'All journeys' }).click();
  await page.getByRole('button', { name: 'Clear Domain', exact: true }).click();
  const renewalResponse = page.waitForResponse((res) => res.url().includes('/journeys/journey-renewal') && res.ok());
  await page.getByRole('link', { name: 'Member Renewal', exact: true }).click();
  const renewal = (await (await renewalResponse).json()).data;
  expect(renewal.relationships).toEqual([]);
  expect(renewal.dependency.value).toBeNull();
  await expect(page.getByText(/Dependency relationships unavailable/)).toBeVisible();
  await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
  await expect(page.getByText(/Impact relationships unavailable/)).toBeVisible();
});
