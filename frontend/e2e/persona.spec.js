/** Verify persona journeys against the real backend with click-only navigation. */
import { test, expect } from './fixtures.js';

/** Match displayed formatting to actual API evidence rather than canned UI values. */
function display(metric) {
  if (metric.value === null || metric.availability !== 'available') return 'Unavailable';
  return metric.unit === '%' && typeof metric.value === 'number'
    ? `${metric.value.toFixed(2)}%`
    : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
}

test('explicit selection, cancel, switch, theme and supplied scenario return', async ({ page, browserErrors }, testInfo) => {
  const catalogResponse = page.waitForResponse((response) => response.url().includes('/api/v1/personas') && response.status() === 200);
  await page.goto('/');
  const catalog = (await (await catalogResponse).json()).data;
  expect(catalog.map((p) => p.label)).toEqual(['Executive', 'Operations', 'Engineering', 'Administrator']);
  await expect(page.getByRole('heading', { name: /perspective$/ })).toHaveCount(0);
  const executive = catalog.find((p) => p.id === 'executive');
  const dashboardResponse = page.waitForResponse((response) => response.url().includes('/dashboard?') && response.url().includes('personaId=executive'));
  await page.getByRole('button', { name: new RegExp(executive.label) }).click();
  const response = await dashboardResponse;
  expect(response.status()).toBe(200);
  const dashboard = (await response.json()).data;
  await expect(page.getByRole('heading', { name: `${dashboard.persona.label} perspective` })).toBeVisible();
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  for (const widget of dashboard.widgets) {
    const card = overview.getByRole('article', { name: widget.title });
    await expect(card).toContainText(display(widget.metric));
    await expect(card).toContainText(widget.metric.sourceRef || 'Association unavailable');
  }
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await page.getByLabel('New persona').selectOption('engineering');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Executive perspective' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch persona' })).toBeFocused();
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await expect(page.getByRole('button', { name: 'Confirm switch' })).toBeDisabled();
  await page.getByLabel('New persona').selectOption('engineering');
  const switchedResponse = page.waitForResponse((res) => res.url().includes('/dashboard?') && res.url().includes('personaId=engineering'));
  await page.getByRole('button', { name: 'Confirm switch' }).click();
  const switched = await switchedResponse;
  expect(switched.status()).toBe(200);
  const engineering = (await switched.json()).data;
  await expect(page.getByRole('heading', { name: `${engineering.persona.label} perspective` })).toBeVisible();
  await expect(overview.getByRole('article')).toHaveCount(engineering.widgets.length);
  for (const widget of engineering.widgets) await expect(overview.getByRole('article', { name: widget.title })).toContainText(display(widget.metric));
  for (const widget of dashboard.widgets.filter((w) => !engineering.widgets.some((e) => e.id === w.id))) await expect(overview.getByRole('article', { name: widget.title })).toHaveCount(0);
  const themeButton = page.getByRole('button', { name: /Use (dark|light) theme/ });
  const previousTheme = await page.locator('html').getAttribute('data-theme');
  await themeButton.click();
  const newTheme = previousTheme === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', newTheme);
  const scenario = engineering.scenarios[0];
  await page.getByRole('heading', { name: scenario.label }).locator('..').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(scenario.destination));
  await expect(page.getByRole('heading', { name: 'Module unavailable', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Engineering perspective' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', newTheme);
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Navigation', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible();
    await page.getByRole('link', { name: /Portfolio Unavailable/ }).click();
    await expect(page.getByRole('heading', { name: 'Module unavailable', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Return to dashboard' }).click();
  }
  await page.screenshot({ path: testInfo.outputPath('persona-dashboard.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test('exact absent period remains unavailable and does not reuse monthly metrics', async ({ page, browserErrors }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  await expect(page.getByRole('heading', { name: 'Operations perspective' })).toBeVisible();
  const responsePromise = page.waitForResponse((response) => response.url().includes('/kpis?') && response.url().includes('period=week'));
  await page.getByLabel('Reporting period').selectOption('week');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const metrics = (await response.json()).data;
  expect(metrics.length).toBeGreaterThan(0);
  const board = page.getByRole('region', { name: 'KPI evidence' });
  for (const metric of metrics) {
    expect(metric.period).toBe('week');
    expect(metric.value).toBeNull();
    await expect(board.getByRole('article', { name: metric.label })).toContainText('Unavailable');
    await expect(board.getByRole('article', { name: metric.label })).toContainText('week');
  }
  await expect(page).toHaveURL(/period=week/);
  expect(browserErrors).toEqual([]);
});
