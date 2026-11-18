/** Exercise real operational evidence navigation with automatic console-error capture. */
import { test, expect } from './fixtures.js';
import { navigatePrimary } from './helpers.js';

test('supplied reliability measures preserve source and missing week never falls back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  const metricsResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/metrics' && res.ok());
  await navigatePrimary(page, 'Reliability');
  const metrics = (await (await metricsResponse).json()).data;
  expect(metrics).toHaveLength(9);
  for (const metric of metrics) {
    const card = page.getByRole('article', { name: metric.label, exact: true });
    const value = metric.availability === 'unavailable' || metric.value === null ? 'Unavailable'
      : metric.unit === '%' && typeof metric.value === 'number' ? `${metric.value.toFixed(2)}%`
        : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
    await expect(card.getByText(value, { exact: true })).toBeVisible();
    await expect(card.getByText(`Source: ${metric.sourceRef || 'Association unavailable'}`, { exact: true })).toBeVisible();
  }
  const weekResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/metrics' && new URL(res.url()).searchParams.get('period') === 'week' && res.ok());
  await page.getByLabel('Reporting period').selectOption('week');
  const weekMetrics = (await (await weekResponse).json()).data;
  expect(weekMetrics).toHaveLength(9);
  for (const metric of weekMetrics) {
    expect(metric.value).toBeNull();
    expect(metric.period).toBe('week');
    await expect(page.getByRole('article', { name: metric.label, exact: true }).getByText('Unavailable', { exact: true })).toBeVisible();
  }
});
