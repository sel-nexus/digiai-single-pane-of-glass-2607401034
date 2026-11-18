/** Verify persona journeys against the real backend with click-only navigation. */
import { test, expect } from './fixtures.js';

/** Match displayed formatting to actual API evidence rather than canned UI values. */
function display(metric) {
  if (metric.value === null || metric.availability !== 'available') return 'Unavailable';
  return metric.unit === '%' && typeof metric.value === 'number'
    ? `${metric.value.toFixed(2)}%`
    : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
}

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
