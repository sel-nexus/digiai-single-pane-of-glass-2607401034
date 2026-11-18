import { test, expect } from './fixtures.js';
import { selectPersona, switchPersona, display } from './helpers.js';

test('cancel retains persona and focus; confirmed switch replaces old widgets', async ({ page }) => {
  await page.goto('/');
  const previous = await selectPersona(page);
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await expect(page.getByRole('button', { name: 'Confirm switch' })).toBeDisabled();
  await page.getByLabel('New persona').selectOption('engineering');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Executive perspective' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch persona' })).toBeFocused();
  const engineering = await switchPersona(page, 'engineering');
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  await expect(overview.getByRole('article')).toHaveCount(engineering.widgets.length);
  for (const widget of engineering.widgets) await expect(overview.getByRole('article', { name: widget.title })).toContainText(display(widget.metric));
  for (const widget of previous.widgets.filter((w) => !engineering.widgets.some((e) => e.id === w.id))) await expect(overview.getByRole('article', { name: widget.title })).toHaveCount(0);
});
test('no alternative in controlled catalog leaves confirmation disabled and cancel safe', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  await page.route('**/api/v1/personas', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    expect(body.data.some((p) => p.id === 'executive')).toBe(true);
    await route.fulfill({ response, json: { ...body, data: body.data.filter((p) => p.id === 'executive') } });
  });
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await expect(page.getByLabel('New persona').getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Confirm switch' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Executive perspective' })).toBeVisible();
});
