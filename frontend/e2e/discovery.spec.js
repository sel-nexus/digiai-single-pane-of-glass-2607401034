/** Exercise backend-driven discovery navigation and mobile shared controls. */
import { test, expect } from './fixtures';

test('search, eight filters, hierarchy and return preserve real source context', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  await page.getByRole('link', { name: 'Portfolio', exact: true }).click();
  for (const name of ['Member Experience', 'Digital Services', 'Enrollment Services', 'Member Portal']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Sample production environment 0001', exact: true }).click();
  await expect(page.getByText('No represented children in this scope. Filters are retained.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Hierarchy ancestors' })
    .getByRole('button', { name: 'Enrollment Services', exact: true }).click();
  await page.getByText('Shared filters (0 selected)').click();
  const selections = { Domain: 'domain-member', Portfolio: 'portfolio-digital', Application: 'app-0001',
    Environment: 'prod', Criticality: 'high', 'Date range': '2025-01/2025-02',
    'Tool source': 'sample-monitor', 'Incident severity': 'Sev1' };
  for (const [label, value] of Object.entries(selections)) {
    const updated = page.waitForResponse((res) => res.url().includes('/filters/options') && res.status() === 200);
    await page.getByLabel(label, { exact: true }).selectOption(value);
    await updated;
  }
  const searchResponse = page.waitForResponse((res) => res.url().includes('/entities') && res.status() === 200);
  await page.getByLabel('Search names or IDs').fill('member portal');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const body = await (await searchResponse).json();
  expect(body.data.map((item) => item.id)).toEqual(['app-0001']);
  const origin = page.url();
  const profileResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/applications/app-0001' && res.ok());
  await page.getByRole('link', { name: body.data[0].label, exact: true }).click();
  const profile = (await (await profileResponse).json()).data;
  expect(profile.id).toBe(body.data[0].id);
  expect(profile.label).toBe(body.data[0].label);
  expect(Object.keys(profile.categories)).toHaveLength(11);
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Health', exact: true }).getByText(profile.categories.health.value[0].value, { exact: true })).toBeVisible();
  const ownership = profile.categories.ownership.value[0];
  await expect(page.getByRole('region', { name: 'Ownership', exact: true }).getByText(ownership.value.label, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ownership', exact: true }).getByText(`Source: ${ownership.source} · ${ownership.sourceRef}`, { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/applications/app-0001');
  await expect(page).toHaveURL(/application=app-0001/);
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await expect(page).toHaveURL(origin);
  await expect(page).toHaveURL(/hierarchyNodeId=service-enrollment/);
  await expect(page.getByRole('navigation', { name: 'Hierarchy ancestors' })
    .getByRole('button', { name: 'Enrollment Services', exact: true })).toHaveAttribute('aria-current', 'location');
  for (const [label, value] of Object.entries(selections)) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValues([value]);
  }
  const emptyResponse = page.waitForResponse((res) => res.url().includes('/entities') && res.status() === 200);
  await page.getByLabel('Search names or IDs').fill('no such source entity');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const empty = await (await emptyResponse).json();
  expect(empty.data).toEqual([]);
  await expect(page.getByText('No matching entities. Selected filters are retained.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear Date range' }).click();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await page.getByRole('button', { name: 'Clear search' }).click();
});

test('mobile navigation and source ID search remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio explorer' })).toBeVisible();
  const response = page.waitForResponse((res) => res.url().includes('/entities') && res.status() === 200);
  await page.getByLabel('Search names or IDs').fill('TICKET-1');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const body = await (await response).json();
  expect(body.data[0].type).toBe('ticket');
  await page.getByRole('link', { name: body.data[0].label }).click();
  await expect(page.getByRole('heading', { name: body.data[0].label })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await page.getByRole('button', { name: 'Clear search' }).click();
});
