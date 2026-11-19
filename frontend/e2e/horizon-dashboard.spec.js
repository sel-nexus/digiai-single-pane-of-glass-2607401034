/** Verify dashboard presentation and real supplied evidence at both configured viewport sizes. */
import { test, expect } from './fixtures.js';
import { display, navigatePrimary, responseFor, selectPersona } from './helpers.js';

test('shows supplied widgets and period-specific KPI evidence in the responsive dashboard', async ({ page }, testInfo) => {
  await page.goto('/');
  const dashboard = await selectPersona(page, 'Executive', 'executive');
  expect(dashboard.widgets.length).toBeGreaterThan(0);
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  const cards = overview.getByRole('article');
  await expect(cards).toHaveCount(dashboard.widgets.length);
  for (const widget of dashboard.widgets) {
    const card = overview.getByRole('article', { name: widget.title, exact: true });
    await expect(card).toContainText(display(widget.metric));
    await expect(card).toContainText(widget.metric.period || 'Period unavailable');
    await expect(card).toContainText(widget.metric.sourceRef || 'Association unavailable');
  }

  await expect(page.locator('.dashboard-heading h1')).toHaveCSS('font-size', '24px');
  await expect(cards.first()).toHaveCSS('border-radius', '12px');
  const columns = await overview.locator('.metric-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(testInfo.project.name === 'mobile' ? 1 : 4);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const response = responseFor(page, '/kpis', { personaId: 'executive', period: 'week' });
  await page.getByLabel('Reporting period').selectOption('week');
  const metrics = (await (await response).json()).data;
  const board = page.getByRole('region', { name: 'KPI evidence' });
  if (metrics.length) {
    await expect(board.getByRole('article')).toHaveCount(metrics.length);
    for (const metric of metrics) {
      const card = board.getByRole('article', { name: metric.label, exact: true });
      await expect(card).toContainText(display(metric));
      await expect(card).toContainText(metric.sourceRef || 'Association unavailable');
    }
  } else {
    await expect(board).toContainText('No configured evidence for this view.');
  }
  expect(new URL(page.url()).searchParams.get('period')).toBe('week');
  await page.screenshot({ path: testInfo.outputPath('horizon-dashboard.png'), fullPage: true });
});

test('tablet dashboard shows two columns and navigates with backend evidence without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/');
  const dashboard = await selectPersona(page, 'Executive', 'executive');
  expect(dashboard.widgets.length).toBeGreaterThan(0);
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  await expect(overview.getByRole('article')).toHaveCount(dashboard.widgets.length);
  for (const widget of dashboard.widgets) {
    const card = overview.getByRole('article', { name: widget.title, exact: true });
    await expect(card).toContainText(display(widget.metric));
    await expect(card).toContainText(widget.metric.sourceRef || 'Association unavailable');
  }
  const columns = await overview.locator('.metric-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const hierarchy = responseFor(page, '/hierarchy');
  await navigatePrimary(page, 'Portfolio');
  const nodes = (await (await hierarchy).json()).data;
  expect(nodes.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Portfolio explorer', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Represented hierarchy' }).getByRole('button', { name: nodes[0].label, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const returning = responseFor(page, '/dashboard', { personaId: 'executive' });
  await navigatePrimary(page, 'Dashboard');
  const returned = (await (await returning).json()).data;
  expect(returned.persona.id).toBe('executive');
  expect(returned.widgets.length).toBeGreaterThan(0);
  await expect(overview.getByRole('article', { name: returned.widgets[0].title, exact: true })).toContainText(display(returned.widgets[0].metric));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
