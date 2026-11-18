import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, enterAdmin, save, readConfig, restoreConfig } from './helpers.js';

test('explicit relationship save reflects on journey overlay and restores original relationship', async ({ page, request }) => {
  const catalog = await readConfig(request);
  const original = catalog.relationships.find((r) => r.sourceEntityId === 'journey-enrollment' && r.targetEntityId === 'app-0001' && r.type === 'depends_on');
  expect(original).toBeTruthy();
  // Only endpoints/type are API-restorable; representedContext is server-owned.
  try {
    await enterAdmin(page);
    await page.getByLabel('Existing relationship').selectOption(original.relationshipId);
    await page.getByLabel('Represented relationship type').selectOption('impact');
    const saved = await save(page, 'Save explicit mapping', '/admin/mappings');
    expect(saved.config.type).toBe('impact');
    await expect(page.getByText('Mapping saved and confirmed.', { exact: true })).toBeVisible();
    await navigatePrimary(page, 'Journeys');
    const response = responseFor(page, '/journeys/journey-enrollment');
    await page.getByRole('link', { name: 'Member Enrollment', exact: true }).click();
    const journey = (await (await response).json()).data;
    const mapped = journey.impactOverlay.value.find((r) => r.id === original.relationshipId);
    expect(mapped.type).toBe('impact');
    expect(mapped.target.entityId).toBe(original.targetEntityId);
    expect(journey.dependency.value?.some((r) => r.id === original.relationshipId) ?? false).toBe(false);
    await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Impact relationships' });
    await expect(panel.getByText(`${mapped.sourceLabel} → ${mapped.target.label}`, { exact: true })).toBeVisible();
    await expect(panel.getByText(mapped.representedContext, { exact: true })).toBeVisible();
  } finally {
    await restoreConfig(request, '/admin/mappings', original,
      (catalog) => catalog.relationships.find((item) => item.relationshipId === original.relationshipId), original);
  }
});
