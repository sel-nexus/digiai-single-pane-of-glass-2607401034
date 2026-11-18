/** Exercise readiness through real navigation and backend response evidence. */
import { test, expect } from './fixtures.js';
import { navigatePrimary } from './helpers.js';

/** Wait for an exact backend route and selected query values before a user action. */
function responseFor(page, path, params = {}) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1${path}` && response.ok()
      && Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

/** Compare supplied values, source refs and exact periods with rendered metric cards. */
async function assertMetrics(page, metrics, family, count) {
  expect(metrics).toHaveLength(count);
  for (const metric of metrics) {
    expect(metric.family).toBe(family);
    const card = page.getByRole('article', { name: metric.label, exact: true });
    const value = metric.availability === 'unavailable' || metric.value === null ? 'Unavailable'
      : metric.unit === '%' && typeof metric.value === 'number' ? `${metric.value.toFixed(2)}%`
        : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
    await expect(card.getByText(value, { exact: true })).toBeVisible();
    await expect(card.getByText(`${metric.period} · ${metric.source}`, { exact: true })).toBeVisible();
    await expect(card.getByText(`Source: ${metric.sourceRef || 'Association unavailable'}`, { exact: true })).toBeVisible();
  }
}

test('QE / environment retain selected release and exact source periods', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Engineering/ }).click();
  const listResponse = responseFor(page, '/readiness/evidence');
  await navigatePrimary(page, 'Readiness');
  const releases = (await (await listResponse).json()).data;
  expect(releases.length).toBeGreaterThan(0);
  const release = releases.find((item) => item.id === 'release-1');
  expect(release.application.id).toBe('app-0001');
  const selectedResponse = responseFor(page, '/readiness/evidence', { releaseId: release.id, applicationId: release.application.id });
  await page.getByRole('list', { name: 'Release records' }).getByRole('link', { name: release.label, exact: true }).click();
  const selected = (await (await selectedResponse).json()).data;
  expect(selected).toHaveLength(1);
  expect(selected[0].id).toBe(release.id);
  const family = 'qe', label = 'QE / environment', count = 5;
    const metricsResponse = responseFor(page, '/readiness/metrics', { family, period: 'month', application: release.application.id });
    await page.getByRole('navigation', { name: 'Readiness families' }).getByRole('link', { name: label, exact: true }).click();
    const metrics = (await (await metricsResponse).json()).data;
    await assertMetrics(page, metrics, family, count);
    expect(new URL(page.url()).searchParams.get('releaseId')).toBe(release.id);
    const weekResponse = responseFor(page, '/readiness/metrics', { family, period: 'week' });
    await page.getByLabel('Reporting period').selectOption('week');
    const week = (await (await weekResponse).json()).data;
    expect(week.every((item) => item.value === null && item.period === 'week' && item.availability === 'unavailable')).toBe(true);
    await assertMetrics(page, week, family, count);
    const monthResponse = responseFor(page, '/readiness/metrics', { family, period: 'month' });
    await page.getByLabel('Reporting period').selectOption('month');
    await assertMetrics(page, (await (await monthResponse).json()).data, family, count);
});
