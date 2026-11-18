import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, selectPersona } from './helpers.js';

test('five-level hierarchy opens exact Application 360 and returns selected ancestor context', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  await navigatePrimary(page, 'Portfolio');
  for (const [label, id] of [['Member Experience', 'domain-member'], ['Digital Services', 'portfolio-digital'], ['Enrollment Services', 'service-enrollment'], ['Member Portal', 'app-0001']]) {
    const response = responseFor(page, '/hierarchy', { parentId: id });
    await page.getByRole('region', { name: 'Represented hierarchy' }).getByRole('button', { name: label, exact: true }).click();
    const body = await (await response).json();
    expect(body.ancestry.at(-1).id).toBe(id);
    await expect(page.getByRole('navigation', { name: 'Hierarchy ancestors' }).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'location');
  }
  const origin = page.url();
  const response = responseFor(page, '/applications/app-0001');
  await page.getByRole('link', { name: 'Open Application 360 · Member Portal', exact: true }).click();
  const profile = (await (await response).json()).data;
  expect(profile.id).toBe('app-0001');
  await expect(page.getByRole('region', { name: 'Health', exact: true })).toContainText(profile.categories.health.value[0].value);
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByRole('navigation', { name: 'Hierarchy ancestors' }).getByRole('button', { name: 'Member Portal', exact: true })).toHaveAttribute('aria-current', 'location');
  const leaf = responseFor(page, '/hierarchy', { parentId: 'env-0001' });
  await page.getByRole('button', { name: 'Sample production environment 0001', exact: true }).click();
  expect((await (await leaf).json()).data).toEqual([]);
  await expect(page.getByText('No represented children in this scope. Filters are retained.', { exact: true })).toBeVisible();
});
