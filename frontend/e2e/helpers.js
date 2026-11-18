/** Shared real-service waits and responsive shell interactions. */
import { expect } from './fixtures.js';

export async function navigatePrimary(page, name) {
  const primary = page.getByRole('navigation', { name: 'Primary', exact: true, includeHidden: true });
  await expect(primary).toBeAttached();
  if (!(await primary.isVisible())) await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await expect(primary).toBeVisible();
  await primary.getByRole('link', { name, exact: true }).click();
}
export function responseFor(page, path, params = {}) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1${path}` && response.ok()
      && Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);
  });
}
export async function selectPersona(page, label = 'Executive', id = 'executive') {
  const response = responseFor(page, '/dashboard', { personaId: id });
  await page.getByRole('button', { name: new RegExp(label) }).click();
  const data = (await (await response).json()).data;
  expect(data.persona.id).toBe(id);
  await expect(page.getByRole('heading', { name: `${data.persona.label} perspective`, exact: true })).toBeVisible();
  return data;
}
export function display(metric) {
  if (metric.value === null || metric.availability !== 'available') return 'Unavailable';
  return metric.unit === '%' && typeof metric.value === 'number' ? `${metric.value.toFixed(2)}%`
    : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
}
/** Hold an unchanged real backend response until the UI loading state has been inspected. */
export async function holdResponse(page, path) {
  let release, arrived;
  const gate = new Promise((resolve) => { release = resolve; });
  const received = new Promise((resolve) => { arrived = resolve; });
  await page.route(`**/api/v1${path}*`, async (route) => {
    const response = await route.fetch({ maxRetries: 0 });
    arrived(response);
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  return { received, release };
}
export async function enterAdmin(page) {
  await page.goto('/');
  await selectPersona(page, 'Administrator', 'administrator');
  const response = responseFor(page, '/admin/config');
  await navigatePrimary(page, 'Administration');
  return (await (await response).json()).data;
}
export async function save(page, button, path) {
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v1${path}` && res.request().method() !== 'GET');
  await page.getByRole('button', { name: button, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const data = (await result.json()).data;
  expect(data.outcome).toBe('success');
  expect(data.effectiveStatus).toBe('confirmed');
  expect(data.saved).toBe(true);
  return data;
}
export async function switchPersona(page, persona) {
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await page.getByLabel('New persona').selectOption(persona);
  const response = responseFor(page, '/dashboard', { personaId: persona });
  await page.getByRole('button', { name: 'Confirm switch' }).click();
  const dashboard = (await (await response).json()).data;
  expect(dashboard.persona.id).toBe(persona);
  await expect(page.getByRole('heading', { name: `${dashboard.persona.label} perspective`, exact: true })).toBeVisible();
  return dashboard;
}

/** Read original state independently of the page so failed UI journeys can be cleaned up. */
export async function readConfig(request) {
  const response = await request.get('/api/v1/admin/config');
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

/** Restore only the selected configuration through the real API, then freshly verify it. */
export async function restoreConfig(request, path, payload, selectOriginal, original, method = 'POST') {
  const response = await request.fetch(`/api/v1${path}`, {
    method, data: { ...payload, actor: { personaId: 'administrator' } }, maxRetries: 0,
  });
  expect(response.status(), 'Cleanup must succeed, including after a failed UI assertion').toBe(200);
  const result = (await response.json()).data;
  expect(result.saved).toBe(true);
  expect(result.outcome).toBe('success');
  expect(result.effectiveStatus).toBe('confirmed');
  expect(selectOriginal(await readConfig(request))).toEqual(original);
}

/** Snapshot every title affected by a KPI write, not just the executive widget. */
export function kpiSnapshot(catalog, metricId) {
  const metric = catalog.metrics.find((item) => item.metricId === metricId);
  const widgets = catalog.widgets.filter((item) => item.metricId === metricId);
  expect(metric).toBeTruthy();
  expect(widgets.length).toBeGreaterThan(0);
  // The real API changes every associated title together; refuse a lossy restoration.
  expect(new Set(widgets.map((item) => item.title)).size).toBe(1);
  return { metric, widgets };
}
