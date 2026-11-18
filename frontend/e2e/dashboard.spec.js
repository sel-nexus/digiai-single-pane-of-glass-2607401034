import { test, expect } from './fixtures.js';
import { selectPersona, display } from './helpers.js';

test('dashboard renders supplied widget values and sources and preserves template screenshot', async ({ page }, testInfo) => {
  await page.goto('/');
  const dashboard = await selectPersona(page);
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  await expect(overview.getByRole('article')).toHaveCount(dashboard.widgets.length);
  for (const widget of dashboard.widgets) {
    const card = overview.getByRole('article', { name: widget.title });
    await expect(card).toContainText(display(widget.metric));
    await expect(card).toContainText(widget.metric.sourceRef || 'Association unavailable');
  }
  await page.screenshot({ path: testInfo.outputPath('persona-dashboard.png'), fullPage: true });
});
test('visible dashboard loading holds real evidence until release', async ({ page }) => {
  await page.goto('/');
  let release, arrived;
  const gate = new Promise((resolve) => { release = resolve; });
  const received = new Promise((resolve) => { arrived = resolve; });
  // StrictMode can cancel the first mount read and issue another. Hold every
  // dashboard response so a replacement read cannot render widgets early.
  await page.route('**/api/v1/dashboard?*', async (route) => {
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    arrived(response);
    await gate;
    await route.fulfill({ response });
  });
  const selecting = selectPersona(page);
  const response = await received;
  expect(response.ok()).toBe(true);
  try {
    await expect(page.getByRole('status').filter({ hasText: 'Loading prototype evidence' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Persona widgets' })).toHaveCount(0);
  } finally {
    release();
  }
  const dashboard = await selecting;
  await expect(page.getByRole('region', { name: 'Persona widgets' }).getByRole('article')).toHaveCount(dashboard.widgets.length);
});
