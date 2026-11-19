/** Exercise insights with real backend evidence, explicit links and captured browser errors. */
import { test, expect } from './fixtures.js';
import { navigatePrimary } from './helpers.js';

/** Register an exact successful backend response wait before navigation. */
function responseFor(page, path, params = {}) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1${path}` && response.ok()
      && Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

/** Verify comparison geometry and exact alternatives against observed backend points.
 * Args:
 *   card: The rendered transformation evidence article.
 *   series: An actual backend response series, never a mock or replacement dataset.
 */
async function verifyComparison(card, series) {
  const points = Array.isArray(series.points) ? series.points : [];
  const qualified = series.availability === 'available' && points.length >= 2
    && points.every((point) => point.availability === 'available'
      && [point.source, point.sourceRef, point.period, point.unit]
        .every((field) => typeof field === 'string' && field.trim())
      && point.unit === points[0].unit
      && (typeof point.value === 'number' || (typeof point.value === 'string'
        && /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(point.value)))
      && Number.isFinite(Number(point.value)));
  const region = card.getByRole('region', { name: `${series.label} series`, exact: true });
  const chart = region.getByRole('img');
  if (!qualified) {
    await expect(chart).toHaveCount(0);
    await expect(region.getByText(/Comparison unplotted/)).toBeVisible();
    return;
  }
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAccessibleName(`${series.label}: source-ordered comparison (${points[0].unit})`);
  const exact = points.map((point, index) =>
    `${index + 1}. ${point.period}: ${String(point.value)} (unit: ${point.unit}); Source: ${point.source} · ${point.sourceRef}`).join(' | ');
  await expect(chart).toHaveAccessibleDescription(exact);
  await expect(region.getByText(`Exact supplied values: ${exact}`, { exact: true })).toBeVisible();
  const bars = chart.locator('rect');
  await expect(bars).toHaveCount(points.length);
  const values = points.map((point) => Number(point.value));
  const magnitude = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0) || 1;
  const lower = Math.min(0, ...values.map((value) => value / magnitude));
  const upper = Math.max(0, ...values.map((value) => value / magnitude));
  const span = upper - lower || 1;
  const zero = 80 + (-lower / span) * 480;
  expect(Number(await chart.locator('line').getAttribute('x1'))).toBeCloseTo(zero);
  for (const [index, point] of points.entries()) {
    const end = 80 + ((Number(point.value) / magnitude - lower) / span) * 480;
    expect(Number(await bars.nth(index).getAttribute('x'))).toBeCloseTo(Math.min(zero, end));
    expect(Number(await bars.nth(index).getAttribute('width'))).toBeCloseTo(Math.abs(end - zero));
    expect(Number(await bars.nth(index).getAttribute('y'))).toBe(16 + index * 40);
  }
}

/** Follow all three explicit target kinds and return to the exact saved insight scope. */
async function followDestinations(page, item, sourcePath) {
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  for (const kind of ['journey', 'portfolio', 'application']) {
    const link = item.associations.find((association) => association.entityType === kind);
    expect(link?.sourceRef).toBeTruthy();
    const targetResponse = responseFor(page, kind === 'portfolio' ? '/entities'
      : `/${kind === 'application' ? 'applications' : 'journeys'}/${link.entityId}`);
    await page.getByRole('article', { name: item.label, exact: true })
      .getByRole('link', { name: `Open ${kind} · ${link.label}`, exact: true }).click();
    const target = (await (await targetResponse).json()).data;
    if (kind === 'portfolio') {
      expect(target.some((record) => record.id === link.entityId)).toBe(true);
      await expect(page.getByRole('region', { name: 'Selected entity' }).getByRole('heading', { name: link.label })).toBeVisible();
    } else {
      expect(target.id).toBe(link.entityId);
      await expect(page.getByRole('heading', { name: target.label, level: 1, exact: true })).toBeVisible();
    }
    expect(new URL(page.url()).searchParams.get('domain')).toBe('domain-member');
    const returning = responseFor(page, sourcePath);
    await page.getByRole('link', { name: 'Return to previous view', exact: true }).click();
    await returning;
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
  }
}

test('transformation measures and source-ordered trends follow explicit destinations and return context', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  const recommendationsResponse = responseFor(page, '/recommendations');
  await navigatePrimary(page, 'Insights');
  expect((await (await recommendationsResponse).json()).data.length).toBeGreaterThan(0);
  await page.getByText('Shared filters', { exact: false }).click();
  const filteredResponse = responseFor(page, '/recommendations', { domain: 'domain-member' });
  await page.getByLabel('Domain', { exact: true }).selectOption('domain-member');
  await filteredResponse;
  const transformationResponse = responseFor(page, '/transformation', { domain: 'domain-member' });
  await page.getByRole('link', { name: 'Transformation evidence', exact: true }).click();
  const items = (await (await transformationResponse).json()).data;
  expect(items.length).toBeGreaterThan(0);
  const item = items.find((record) => record.associations.length === 3);
  const card = page.getByRole('article', { name: item.label, exact: true });
  for (const metric of item.measures) {
    const value = metric.availability === 'unavailable' ? 'Unavailable' : metric.unit === '%' && typeof metric.value === 'number'
      ? `${metric.value.toFixed(2)}%` : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
    await expect(card.getByText(value, { exact: true }).first()).toBeVisible();
    await expect(card.getByText(`Period: ${metric.period || 'Unavailable'} · ${metric.source} · ${metric.sourceRef}`, { exact: true })).toBeVisible();
  }
  for (const series of item.series) {
    const points = card.getByRole('list', { name: `${series.label} source order` }).getByRole('listitem');
    await expect(points).toHaveCount(series.points.length);
    for (let index = 0; index < series.points.length; index += 1) {
      await expect(points.nth(index)).toContainText(series.points[index].period);
      await expect(points.nth(index)).toContainText(series.points[index].sourceRef);
    }
  }
  for (const record of items) {
    for (const series of record.series) {
      await verifyComparison(page.getByRole('article', { name: record.label, exact: true }), series);
    }
  }
  const single = items.find((record) => record.series.some((series) => series.points.length === 1));
  expect(single).toBeTruthy();
  await expect(page.getByRole('article', { name: single.label }).getByText(/Trend unavailable. A single point/)).toBeVisible();
  await followDestinations(page, item, '/transformation');
});


test('empty transformation retains application filter and never substitutes evidence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Engineering/ }).click();
  const listResponse = responseFor(page, '/recommendations');
  await navigatePrimary(page, 'Insights');
  expect((await (await listResponse).json()).data.length).toBeGreaterThan(0);
  await page.getByText('Shared filters', { exact: false }).click();
  const emptyResponse = responseFor(page, '/recommendations', { application: 'app-0002' });
  await page.getByLabel('Application', { exact: true }).selectOption('app-0002');
  expect((await (await emptyResponse).json()).data).toEqual([]);
  const transformationResponse = responseFor(page, '/transformation', { application: 'app-0002' });
  await page.getByRole('link', { name: 'Transformation evidence' }).click();
  expect((await (await transformationResponse).json()).data).toEqual([]);
  await expect(page.getByText(/No transformation evidence in this scope/)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});


test('real transformation upload retains numeric text and rounds only percent browser presentation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Administrator/ }).click();
  await navigatePrimary(page, 'Uploads');
  await page.getByLabel('Dataset class *').selectOption('transformation_maturity');
  const id = `numeric-transformation-${Date.now()}`;
  const label = `Uploaded decimal evidence ${id}`;
  const evidence = (value, unit, period, sourceRef) => ({ value, unit, period, sourceRef });
  const attrs = {
    measures: {
      adoption: evidence('12.3456', '%', 'month', `${id}-adoption`),
      maturity: evidence('Developing', null, 'month', `${id}-maturity`),
      value: evidence('125000.2500', 'USD', 'month', `${id}-value`),
      effort: evidence('420.5000', 'hours', 'month', `${id}-effort`),
    },
    series: [{ label: 'Uploaded adoption', points: [
      evidence('12.3456', '%', 'week', `${id}-point-one`),
      evidence('98.7654', '%', 'month', `${id}-point-two`),
    ] }],
  };
  const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = 'Key,Kind,Name,Data\n' + [id, 'transformation', label, JSON.stringify(attrs)].map(csvCell).join(',') + '\n';
  for (const [field, column] of [['id', 'Key'], ['type', 'Kind'], ['label', 'Name']]) {
    await page.getByLabel(`Source column for ${field} *`).fill(column);
  }
  await page.getByLabel('Source column for attributes').fill('Data');
  await page.getByLabel('CSV or XLSX file *').setInputFiles({ name: 'transformation.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const uploadResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/admin/uploads' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const upload = (await response.json()).data;
  expect(upload.acceptedRows).toBe(1);
  expect(upload.reflection.status).toBe('confirmed');
  await expect(page.getByRole('status').filter({ hasText: 'Upload confirmed' })).toContainText(upload.datasetVersion);
  await navigatePrimary(page, 'Insights');
  const transformed = responseFor(page, '/transformation');
  await page.getByRole('link', { name: 'Transformation evidence', exact: true }).click();
  const item = (await (await transformed).json()).data.find((record) => record.id === id);
  expect(item.source).toBe('uploaded');
  expect(item.sourceRef).toBe(upload.datasetVersion);
  expect(item.availability).toBe('available');
  const card = page.getByRole('article', { name: item.label, exact: true });
  for (const [key, rendered] of [['adoption', '12.35%'], ['maturity', 'Developing'], ['value', '125000.2500 USD'], ['effort', '420.5000 hours']]) {
    const metric = item.measures.find((entry) => entry.id === `${id}-${key}`);
    expect(metric.value).toBe(attrs.measures[key].value);
    expect(metric.period).toBe('month');
    expect(metric.sourceRef).toBe(attrs.measures[key].sourceRef);
    expect(metric.availability).toBe('available');
    await expect(card.getByText(rendered, { exact: true }).first()).toBeVisible();
    await expect(card.getByText(`Period: month · uploaded · ${metric.sourceRef}`, { exact: true })).toBeVisible();
  }
  const series = item.series[0];
  expect(series.availability).toBe('available');
  expect(series.points.map((point) => point.value)).toEqual(['12.3456', '98.7654']);
  const points = card.getByRole('list', { name: 'Uploaded adoption source order' }).getByRole('listitem');
  await expect(points).toHaveCount(2);
  for (const [index, rendered] of ['12.35%', '98.77%'].entries()) {
    expect(series.points[index].sourceRef).toBe(attrs.series[0].points[index].sourceRef);
    expect(series.points[index].period).toBe(attrs.series[0].points[index].period);
    await expect(points.nth(index)).toContainText(`${series.points[index].period} · ${rendered}`);
    await expect(points.nth(index)).toContainText(series.points[index].sourceRef);
  }
  await verifyComparison(card, series);
  await expect(card.getByText(/12\.3456 %|98\.7654 %/)).toHaveCount(0);
});
