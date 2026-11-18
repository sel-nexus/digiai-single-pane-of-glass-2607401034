/** Exercise readiness through real navigation and backend response evidence. */
import { test, expect } from './fixtures';

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

test('release evidence to exact application and return, then three separate measure families', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Engineering/ }).click();
  const listResponse = responseFor(page, '/readiness/evidence');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Readiness', exact: true }).click();
  const releases = (await (await listResponse).json()).data;
  expect(releases.length).toBeGreaterThan(0);
  const release = releases.find((item) => item.id === 'release-1');
  expect(release.application.id).toBe('app-0001');
  const selectedResponse = responseFor(page, '/readiness/evidence', { releaseId: release.id, applicationId: release.application.id });
  await page.getByRole('list', { name: 'Release records' }).getByRole('link', { name: release.label, exact: true }).click();
  const selected = (await (await selectedResponse).json()).data;
  expect(selected).toHaveLength(1);
  expect(selected[0].id).toBe(release.id);
  for (const [key, category] of Object.entries(selected[0].categories)) {
    const panel = page.getByRole('region', { name: `${key[0].toUpperCase()}${key.slice(1)} evidence`, exact: true });
    expect(category.availability).toBe('available');
    for (const evidence of category.value) {
      await expect(panel.getByText(evidence.value.status, { exact: true })).toBeVisible();
      await expect(panel.getByText(`Period: ${evidence.period}`, { exact: true })).toBeVisible();
      await expect(panel.getByText(`Source: ${evidence.source} · ${evidence.sourceRef}`, { exact: true })).toBeVisible();
      await expect(panel.getByText(`Association: ${evidence.association}`, { exact: true })).toBeVisible();
    }
  }
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  const appResponse = responseFor(page, `/applications/${release.application.id}`);
  await page.getByRole('link', { name: `Open application · ${release.application.label}`, exact: true }).click();
  const profile = (await (await appResponse).json()).data;
  expect(profile.id).toBe(release.application.id);
  await expect(page.getByRole('heading', { name: profile.label, exact: true, level: 1 })).toBeVisible();
  const returnResponse = responseFor(page, '/readiness/evidence', { releaseId: release.id });
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await returnResponse;
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
  for (const [family, label, count] of [['release', 'DevSecOps metrics', 5], ['qe', 'QE / environment', 5], ['security', 'Security posture', 4]]) {
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
  }
});

test('missing application evidence stays empty through retained filters and family navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Engineering/ }).click();
  const listResponse = responseFor(page, '/readiness/evidence');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Readiness', exact: true }).click();
  await listResponse;
  await page.getByText('Shared filters', { exact: false }).click();
  const filteredResponse = responseFor(page, '/readiness/evidence', { application: 'app-0002' });
  await page.getByLabel('Application', { exact: true }).selectOption('app-0002');
  const filtered = await (await filteredResponse).json();
  expect(filtered.data).toEqual([]);
  expect(filtered.page.total).toBe(0);
  await expect(page.getByText(/No associated releases in this scope/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Open application/ })).toHaveCount(0);
  const metricsResponse = responseFor(page, '/readiness/metrics', { family: 'security', application: 'app-0002' });
  await page.getByRole('navigation', { name: 'Readiness families' }).getByRole('link', { name: 'Security posture', exact: true }).click();
  expect((await (await metricsResponse).json()).data).toEqual([]);
  await expect(page.getByText('No measures in this scope. Selected filters are retained.', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('application')).toBe('app-0002');
});
