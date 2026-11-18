import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, enterAdmin, save, switchPersona, readConfig, restoreConfig, kpiSnapshot } from './helpers.js';

test('KPI display configuration reflects in dashboard and persisted catalog', async ({ page, request }) => {
  const original = kpiSnapshot(await readConfig(request), 'availability');
  try {
    await enterAdmin(page);
    const label = `Supplied uptime ${Date.now()}`;
    await page.getByLabel('Supplied metric').selectOption('availability');
    await page.getByLabel('Metric display label').fill(label);
    await page.getByLabel('Overview display title').fill(label);
    const kpi = await save(page, 'Save KPI definition', '/admin/kpis');
    await expect(page.getByText('KPI definition saved and confirmed.')).toBeVisible();
    await navigatePrimary(page, 'Dashboard');
    await switchPersona(page, 'executive');
    await expect(page.getByRole('region', { name: 'Persona widgets' }).getByRole('heading', { name: label, exact: true })).toBeVisible();
    await navigatePrimary(page, 'Administration');
    await page.getByLabel('Audit target ID').fill(kpi.configId);
    await page.getByLabel('Audit actor persona').fill('administrator');
    const auditResponse = responseFor(page, '/admin/audit', { target: kpi.configId, persona: 'administrator' });
    await page.getByRole('button', { name: 'Apply audit filters' }).click();
    const events = (await (await auditResponse).json()).data;
    expect(events.some((e) => e.id === kpi.auditId)).toBe(true);
    await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(kpi.auditId);

    await expect(page.getByRole('option', { name: `${label} · availability`, exact: true })).toBeAttached();
  } finally {
    await restoreConfig(request, '/admin/kpis', { metricId: 'availability', label: original.metric.label, title: original.widgets[0].title },
      (catalog) => kpiSnapshot(catalog, 'availability'), original);
  }
});
