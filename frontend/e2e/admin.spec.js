/** Verify real configuration, dashboard reflection and persisted audit via clicked navigation. */
import { test, expect } from './fixtures';

/** Await one explicit configuration request and assert confirmed backend completion. */
async function save(page, button, path) {
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v1${path}` && res.request().method() !== 'GET');
  await page.getByRole('button', { name: button, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const body = await result.json();
  expect(body.data.effectiveStatus).toBe('confirmed');
  return body.data;
}

/** Switch display context using the actual shell interaction. */
async function switchPersona(page, persona) {
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await page.getByLabel('New persona').selectOption(persona);
  await page.getByRole('button', { name: 'Confirm switch' }).click();
}

test('configuration persists through dashboard and audit navigation without page reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Administrator/ }).click();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page.getByLabel('Supplied metric')).toBeVisible();
  for (const name of ['Snapshot export unavailable', 'Annotations unavailable', 'Export audit unavailable']) await expect(page.getByRole('button', { name })).toBeDisabled();
  const label = `Supplied uptime ${Date.now()}`;
  await page.getByLabel('Supplied metric').selectOption('availability');
  await page.getByLabel('Metric display label').fill(label);
  await page.getByLabel('Overview display title').fill(label);
  const kpi = await save(page, 'Save KPI definition', '/admin/kpis');
  await expect(page.getByText('KPI definition saved and confirmed.')).toBeVisible();
  await page.getByLabel('Existing scenario').selectOption('enrollment');
  await page.getByLabel('Scenario display label').fill(`Operations ${label}`);
  await page.getByLabel('Available destination').selectOption('/operations');
  const scenario = await save(page, 'Save scenario', '/admin/scenarios');
  await expect(page.getByText('Scenario saved and confirmed.')).toBeVisible();
  await page.getByLabel('Widget persona').selectOption('executive');
  await page.getByLabel('Existing widget').selectOption('sla');
  await page.getByLabel('Visible on selected persona dashboard').uncheck();
  const widget = await save(page, 'Save widget visibility', '/admin/personas/executive/widgets/sla');
  await expect(page.getByText('Widget visibility saved and confirmed.')).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await switchPersona(page, 'executive');
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  await expect(overview.getByRole('heading', { name: label, exact: true })).toBeVisible();
  await expect(overview.getByRole('heading', { name: 'SLA compliance %', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: `Operations ${label}`, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page.getByRole('option', { name: `${label} · availability`, exact: true })).toBeAttached();
  await page.getByLabel('Widget persona').selectOption('executive');
  await page.getByLabel('Existing widget').selectOption('sla');
  await expect(page.getByLabel('Visible on selected persona dashboard')).not.toBeChecked();
  for (const saved of [kpi, scenario, widget]) {
    await page.getByLabel('Audit target ID').fill(saved.configId);
    await page.getByLabel('Audit actor persona').fill('administrator');
    await page.getByRole('button', { name: 'Apply audit filters' }).click();
    await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(saved.auditId);
  }
  await page.getByLabel('Widget persona').selectOption('executive');
  await page.getByLabel('Existing widget').selectOption('sla');
  await page.getByLabel('Visible on selected persona dashboard').check();
  await save(page, 'Save widget visibility', '/admin/personas/executive/widgets/sla');
});
