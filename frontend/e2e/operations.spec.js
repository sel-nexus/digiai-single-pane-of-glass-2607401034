/** Exercise real operational evidence navigation with automatic console-error capture. */
import { test, expect } from './fixtures';

test('incident correlation to application and return, then separate reliability route', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  const listResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/incidents' && res.ok());
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Operations', exact: true }).click();
  const records = (await (await listResponse).json()).data;
  expect(new Set(records.map((row) => row.recordType))).toEqual(new Set(['incident', 'problem_rca', 'major_incident']));
  const incident = records.find((row) => row.id === 'ticket-1');
  const linksResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/correlations' && new URL(res.url()).searchParams.get('incidentId') === incident.id && res.ok());
  await page.getByRole('list', { name: 'Operational records' }).getByRole('link', { name: incident.label, exact: true }).click();
  const links = (await (await linksResponse).json()).data;
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.relationshipLabel).toBe('represented correlation');
    await expect(page.getByRole('region', { name: 'Correlations', exact: true }).getByText(`Association: ${link.evidence.association}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Correlations', exact: true }).getByText(`${link.relationshipLabel} · ${link.sourceEntityId} → ${link.targetEntityId}`, { exact: true })).toBeVisible();
  }
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  const app = incident.businessContext.value.find((item) => item.value.type === 'application').value;
  const appResponse = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v1/applications/${app.id}` && res.ok());
  await page.getByRole('link', { name: `Open application · ${app.label}`, exact: true }).click();
  const profile = (await (await appResponse).json()).data;
  expect(profile.id).toBe(app.id);
  await expect(page.getByRole('heading', { name: profile.label, exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
  const metricsResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/metrics' && res.ok());
  const summaryResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/observability' && res.ok());
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Reliability', exact: true }).click();
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
  const signals = (await (await summaryResponse).json()).data;
  expect(signals.length).toBeGreaterThan(0);
  for (const signal of signals) {
    await expect(page.getByRole('region', { name: signal.label, exact: true }).getByText(`Association: ${signal.evidence.value[0].association}`, { exact: true })).toBeVisible();
    const context = page.getByRole('region', { name: `Application / service context · ${signal.label}`, exact: true });
    for (const item of signal.businessContext.value) await expect(context.getByText(item.value.id, { exact: true })).toBeVisible();
  }
});

test('unlinked incident remains unavailable and missing week metrics never fall back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  const listResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/incidents' && res.ok());
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Operations', exact: true }).click();
  const incident = (await (await listResponse).json()).data.find((row) => row.id === 'ticket-2');
  expect(incident.businessContext).toEqual({ availability: 'unavailable', value: null });
  const linksResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/correlations' && new URL(res.url()).searchParams.get('incidentId') === incident.id && res.ok());
  await page.getByRole('list', { name: 'Operational records' }).getByRole('link', { name: incident.label, exact: true }).click();
  const links = await (await linksResponse).json();
  expect(links.data).toEqual([]);
  expect(links.availability).toBe('unavailable');
  await expect(page.getByRole('region', { name: 'Business impact context' }).getByRole('status')).toContainText('Unavailable');
  await expect(page.getByText('Unavailable — no represented correlation supplied.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Review reliability' }).click();
  await expect(page.getByRole('article', { name: 'MTTR', exact: true })).toBeVisible();
  const weekResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/metrics' && new URL(res.url()).searchParams.get('period') === 'week' && res.ok());
  await page.getByLabel('Reporting period').selectOption('week');
  const metrics = (await (await weekResponse).json()).data;
  expect(metrics).toHaveLength(9);
  for (const metric of metrics) {
    expect(metric.value).toBeNull();
    expect(metric.period).toBe('week');
    await expect(page.getByRole('article', { name: metric.label, exact: true }).getByText('Unavailable', { exact: true })).toBeVisible();
  }
});
