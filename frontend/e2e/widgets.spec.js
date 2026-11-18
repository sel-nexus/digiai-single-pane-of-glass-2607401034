import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, enterAdmin, save, switchPersona, readConfig, restoreConfig } from './helpers.js';

test('widget visibility persists and hides only selected persona widget', async ({ page, request }) => {
  const selectWidget = (catalog) => catalog.widgets.find((item) => item.personaId === 'executive' && item.id === 'sla');
  const original = selectWidget(await readConfig(request));
  expect(original?.visible).toBe(true);
  try {
    await enterAdmin(page);
    await page.getByLabel('Widget persona').selectOption('executive');
    await page.getByLabel('Existing widget').selectOption('sla');
    await page.getByLabel('Visible on selected persona dashboard').uncheck();
    const widget = await save(page, 'Save widget visibility', '/admin/personas/executive/widgets/sla');
    await expect(page.getByText('Widget visibility saved and confirmed.')).toBeVisible();
    await navigatePrimary(page, 'Dashboard');
    const dashboard = await switchPersona(page, 'executive');
    expect(dashboard.widgets.some((w) => w.id === 'sla')).toBe(false);
    await expect(page.getByRole('region', { name: 'Persona widgets' }).getByRole('heading', { name: 'SLA compliance %', exact: true })).toHaveCount(0);
    await navigatePrimary(page, 'Administration');
    await page.getByLabel('Audit target ID').fill(widget.configId);
    await page.getByLabel('Audit actor persona').fill('administrator');
    const auditResponse = responseFor(page, '/admin/audit', { target: widget.configId, persona: 'administrator' });
    await page.getByRole('button', { name: 'Apply audit filters' }).click();
    const events = (await (await auditResponse).json()).data;
    expect(events.some((e) => e.id === widget.auditId)).toBe(true);
    await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(widget.auditId);

    await page.getByLabel('Widget persona').selectOption('executive');
    await page.getByLabel('Existing widget').selectOption('sla');
    await expect(page.getByLabel('Visible on selected persona dashboard')).not.toBeChecked();

  } finally {
    await restoreConfig(request, '/admin/personas/executive/widgets/sla', { visible: original.visible }, selectWidget, original, 'PUT');
  }
});
