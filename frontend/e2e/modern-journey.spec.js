/** Verify connected supplied journey pairs through real HTTP and responsive navigation. */
import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, selectPersona } from './helpers.js';

/** Compare every rendered directed pair to the observed overlay response.
 * Args:
 *   page: The browser showing the selected journey.
 *   overlay: Qualified relationship evidence returned by the real service.
 *   kind: The exact selected relationship type.
 */
async function verifyPairs(page, overlay, kind) {
  const title = kind === 'depends_on' ? 'Dependency' : 'Impact';
  const region = page.getByRole('region', { name: `${title} relationships`, exact: true });
  const rows = (overlay.value || []).filter((row) => row.type === kind);
  if (overlay.availability !== 'available' || !rows.length) {
    await expect(region.getByRole('status')).toContainText(`${title} relationships unavailable`);
    await expect(region.getByRole('list')).toHaveCount(0);
    return;
  }
  const edges = region.getByRole('list', { name: `${title} directed relationships` }).getByRole('listitem');
  await expect(edges).toHaveCount(rows.length);
  for (const [index, row] of rows.entries()) {
    const edge = edges.nth(index);
    await expect(edge).toHaveAttribute('data-relationship-id', row.id);
    const pair = edge.getByRole('group', {
      name: `${row.sourceLabel} (${row.sourceEntityId}) → ${row.target.label} (${row.target.entityId}): ${row.type}`,
      exact: true,
    });
    await expect(pair).toBeVisible();
    const nodes = pair.locator('[data-entity-id]');
    await expect(nodes).toHaveCount(2);
    await expect(nodes.nth(0)).toHaveAttribute('data-entity-id', row.sourceEntityId);
    await expect(nodes.nth(1)).toHaveAttribute('data-entity-id', row.target.entityId);
    await expect(nodes.nth(0).locator('.relationship-node-label')).toHaveText(row.sourceLabel);
    await expect(nodes.nth(1).locator('.relationship-node-label')).toHaveText(row.target.label);
    await expect(pair.getByText(row.type, { exact: true })).toBeVisible();
    await expect(pair.getByText(row.id, { exact: true })).toBeVisible();
    await expect(edge.getByText(`Relationship source: ${row.source} · ${row.sourceRef || 'Reference unavailable'}`, { exact: true })).toBeVisible();
    await expect(nodes.nth(1).getByText(`Asset source: ${row.target.source} · ${row.target.sourceRef || 'Reference unavailable'}`, { exact: true })).toBeVisible();
    if (row.representedContext) await expect(edge.getByText(row.representedContext, { exact: true })).toBeVisible();
  }
  await expect(region.getByText(/repeated nodes do not add links/)).toBeVisible();
}

test('supplied connected relationships switch exactly, inspect API and return from exact application scope', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  await page.getByText('Shared filters', { exact: false }).click();
  await page.getByLabel('Domain', { exact: true }).selectOption('domain-member');
  const listResponse = responseFor(page, '/journeys', { domain: 'domain-member' });
  await navigatePrimary(page, 'Journeys');
  const journeys = (await (await listResponse).json()).data;
  expect(journeys.length).toBeGreaterThan(0);
  const journey = journeys.find((row) => row.id === 'journey-enrollment');
  expect(journey).toBeTruthy();
  const detailResponse = responseFor(page, `/journeys/${journey.id}`, { domain: 'domain-member' });
  await page.getByRole('link', { name: journey.label, exact: true }).click();
  const detail = (await (await detailResponse).json()).data;
  expect(detail.id).toBe(journey.id);
  expect(detail.dependency.availability).toBe('available');
  expect(detail.dependency.value.length).toBeGreaterThan(0);
  await verifyPairs(page, detail.dependency, 'depends_on');
  await expect(page.getByText(`${detail.id} · Source: ${detail.source} · ${detail.sourceRef}`, { exact: true })).toBeVisible();
  if (detail.impact.availability !== 'available') await expect(page.getByText('Business impact unavailable.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Impact overlay', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).searchParams.get('overlay')).toBe('impact');
  await verifyPairs(page, detail.impactOverlay, 'impact');
  const api = detail.impactOverlay.value.find((row) => row.target.entityType === 'api');
  expect(api).toBeTruthy();
  const summary = page.getByText(`Inspect API asset · ${api.target.label}`, { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  await expect(page.getByText(`Represented API asset: ${api.target.entityId}. No live API connection or endpoint invocation.`, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open application/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Dependency overlay', exact: true }).click();
  await verifyPairs(page, detail.dependency, 'depends_on');
  const app = detail.dependency.value.find((row) => row.target.entityType === 'application').target;
  const origin = new URL(page.url()).pathname + new URL(page.url()).search;
  const link = page.getByRole('link', { name: `Open application · ${app.label}`, exact: true });
  const destination = new URL(await link.getAttribute('href'), page.url());
  expect(destination.pathname).toBe(`/applications/${encodeURIComponent(app.entityId)}`);
  expect(destination.searchParams.get('returnTo')).toBe(origin);
  expect(destination.searchParams.get('domain')).toBe('domain-member');
  const profileResponse = responseFor(page, `/applications/${app.entityId}`, { domain: 'domain-member' });
  await link.click();
  const profile = (await (await profileResponse).json()).data;
  expect(profile.id).toBe(app.entityId);
  expect(new URL(page.url()).pathname).toBe(destination.pathname);
  await expect(page.getByRole('heading', { name: profile.label, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.application-heading').getByText(`Source: ${profile.source} · ${profile.sourceRef}`, { exact: true })).toBeVisible();
  const returning = responseFor(page, `/journeys/${journey.id}`, { domain: 'domain-member' });
  await page.getByRole('link', { name: 'Return to previous view', exact: true }).click();
  const returned = (await (await returning).json()).data;
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(origin);
  expect(returned.id).toBe(detail.id);
  await expect(page.getByLabel('Domain', { exact: true })).toHaveValues(['domain-member']);
  await expect(page.getByRole('link', { name: 'Dependency overlay', exact: true })).toHaveAttribute('aria-current', 'page');
  await verifyPairs(page, returned.dependency, 'depends_on');
});

test('real missing relationship evidence never substitutes another journey or draws nodes', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  const listResponse = responseFor(page, '/journeys');
  await navigatePrimary(page, 'Journeys');
  const journeys = (await (await listResponse).json()).data;
  const renewal = journeys.find((row) => row.id === 'journey-renewal');
  expect(renewal).toBeTruthy();
  const detailResponse = responseFor(page, `/journeys/${renewal.id}`);
  await page.getByRole('link', { name: renewal.label, exact: true }).click();
  const detail = (await (await detailResponse).json()).data;
  expect(detail.id).toBe(renewal.id);
  expect(detail.relationships).toEqual([]);
  expect(detail.dependency.availability).toBe('unavailable');
  await verifyPairs(page, detail.dependency, 'depends_on');
  await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
  expect(detail.impactOverlay.availability).toBe('unavailable');
  await verifyPairs(page, detail.impactOverlay, 'impact');
  await expect(page.locator('[data-relationship-id], [data-entity-id]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open application/ })).toHaveCount(0);
});
