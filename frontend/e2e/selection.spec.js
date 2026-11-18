import { test, expect } from './fixtures.js';
import { responseFor, selectPersona } from './helpers.js';

test('catalog requires explicit persona choice and displays real descriptions', async ({ page }) => {
  const response = responseFor(page, '/personas');
  await page.goto('/');
  const catalog = (await (await response).json()).data;
  expect(catalog.map((p) => p.label)).toEqual(['Executive', 'Operations', 'Engineering', 'Administrator']);
  await expect(page.getByRole('heading', { name: /perspective$/ })).toHaveCount(0);
  for (const persona of catalog) await expect(page.getByRole('button', { name: new RegExp(persona.label) })).toContainText(persona.description);
  await selectPersona(page);
});
test('test-controlled empty catalog never selects a default persona', async ({ page }) => {
  await page.route('**/api/v1/personas', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.data.length).toBeGreaterThan(0);
    await route.fulfill({ response, json: { ...body, data: [] } });
  });
  await page.goto('/');
  const catalog = page.getByRole('main');
  await expect(catalog.getByRole('status')).toContainText('No configured evidence for this view.');
  await expect(catalog.getByRole('button', { name: /Open perspective/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
});
