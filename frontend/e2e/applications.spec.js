/** Exercise Application 360 through real backend navigation with console capture. */
import { test, expect } from './fixtures';

test('journey to exact application evidence and return retain original context', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  await page.getByRole('link', { name: 'Journeys', exact: true }).click();
  const journeyResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/journeys/journey-enrollment' && res.ok());
  await page.getByRole('link', { name: 'Member Enrollment', exact: true }).click();
  const journey = (await (await journeyResponse).json()).data;
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  const appLink = journey.dependency.value.find((row) => row.target.entityType === 'application');
  const profileResponse = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v1/applications/${appLink.target.entityId}` && res.ok());
  await page.getByRole('link', { name: `Open application · ${appLink.target.label}` }).click();
  const profile = (await (await profileResponse).json()).data;
  expect(profile.id).toBe(appLink.target.entityId);
  expect(Object.keys(profile.categories)).toHaveLength(11);
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Health', exact: true }).getByText(profile.categories.health.value[0].value)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Defects', exact: true }).getByRole('heading', { name: profile.categories.defects.value[0].label })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Dependencies', exact: true }).getByText(profile.categories.dependencies.value[0].value.id, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
  await expect(page.getByRole('heading', { name: journey.label, exact: true })).toBeVisible();
});

test('search opens exact partial application and shows unavailable evidence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.getByLabel('Search names or IDs').fill('app-0002');
  const searchResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/entities' && res.url().includes('q=app-0002') && res.ok());
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const entities = (await (await searchResponse).json()).data;
  const exact = entities.find((row) => row.id === 'app-0002');
  const profileResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/applications/app-0002' && res.ok());
  await page.getByRole('region', { name: 'Enterprise search' }).getByRole('link', { name: exact.label, exact: true }).click();
  const profile = (await (await profileResponse).json()).data;
  expect(profile.id).toBe(exact.id);
  expect(profile.categories.health).toEqual({ availability: 'unavailable', value: null });
  expect(profile.categories.dependencies.value).toBeNull();
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Health', exact: true }).getByRole('status')).toContainText('Unavailable');
  await expect(page.getByRole('region', { name: 'Ownership', exact: true }).getByText(profile.categories.ownership.value[0].value.label, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
});
