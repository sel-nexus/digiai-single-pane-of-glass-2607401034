/** Verify dashboard presentation and real supplied evidence at both configured viewport sizes. */
import { test, expect } from './fixtures.js';
import { display, responseFor, selectPersona } from './helpers.js';

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
