import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, enterAdmin, save, switchPersona, readConfig, restoreConfig } from './helpers.js';

test('scenario configuration reflects its label and approved destination on dashboard', async ({ page, request }) => {
  const selectScenario = (catalog) => catalog.scenarios.find((item) => item.id === 'enrollment');
  const original = selectScenario(await readConfig(request));
  expect(original).toBeTruthy();
  try {
    await enterAdmin(page);
    const label = `Scenario ${Date.now()}`;
    await page.getByLabel('Existing scenario').selectOption('enrollment');
    await page.getByLabel('Scenario display label').fill(`Operations ${label}`);
    await page.getByLabel('Available destination').selectOption('/operations');
    const scenario = await save(page, 'Save scenario', '/admin/scenarios');
    await expect(page.getByText('Scenario saved and confirmed.')).toBeVisible();
    await navigatePrimary(page, 'Dashboard');
    await switchPersona(page, 'executive');
    const heading = page.getByRole('heading', { name: `Operations ${label}`, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading.locator('..').getByRole('link')).toHaveAttribute('href', /\/operations/);
    await navigatePrimary(page, 'Administration');
    await page.getByLabel('Audit target ID').fill(scenario.configId);
    await page.getByLabel('Audit actor persona').fill('administrator');
    const auditResponse = responseFor(page, '/admin/audit', { target: scenario.configId, persona: 'administrator' });
    await page.getByRole('button', { name: 'Apply audit filters' }).click();
    const events = (await (await auditResponse).json()).data;
    expect(events.some((e) => e.id === scenario.auditId)).toBe(true);
    await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(scenario.auditId);

  } finally {
    await restoreConfig(request, '/admin/scenarios', { scenarioId: original.id, label: original.label, description: original.description, destination: original.destination }, selectScenario, original);
  }
});
