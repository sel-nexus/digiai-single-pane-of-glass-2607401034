import { test, expect } from './fixtures.js';
import { responseFor, enterAdmin, save, readConfig, restoreConfig, kpiSnapshot } from './helpers.js';

test('exact audit filters show the real saved event and empty mismatch without invented export', async ({ page, request }) => {
  const original = kpiSnapshot(await readConfig(request), 'availability');
  try {
    await enterAdmin(page);
    for (const name of ['Snapshot export unavailable', 'Annotations unavailable', 'Export audit unavailable']) await expect(page.getByRole('button', { name })).toBeDisabled();
    await page.getByLabel('Supplied metric').selectOption('availability');
    await page.getByLabel('Metric display label').fill(`Audit metric ${Date.now()}`);
    await page.getByLabel('Overview display title').fill('Audited overview');
    const saved = await save(page, 'Save KPI definition', '/admin/kpis');
    await page.getByLabel('Audit target ID').fill(saved.configId);
    await page.getByLabel('Audit actor persona').fill('administrator');
    const response = responseFor(page, '/admin/audit', { target: saved.configId, persona: 'administrator' });
    await page.getByRole('button', { name: 'Apply audit filters' }).click();
    const events = (await (await response).json()).data;
    const event = events.find((e) => e.id === saved.auditId);
    expect(event.targetId).toBe(saved.configId);
    expect(event.actor.personaId).toBe('administrator');
    await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(event.id);
    await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(event.summary);
    await page.getByLabel('Audit actor persona').fill('nonexistent-actor');
    const empty = responseFor(page, '/admin/audit', { persona: 'nonexistent-actor' });
    await page.getByRole('button', { name: 'Apply audit filters' }).click();
    expect((await (await empty).json()).data).toEqual([]);
    await expect(page.getByText('No matching audit events.', { exact: true })).toBeVisible();
  } finally {
    await restoreConfig(request, '/admin/kpis', { metricId: 'availability', label: original.metric.label, title: original.widgets[0].title },
      (catalog) => kpiSnapshot(catalog, 'availability'), original);
  }
});
