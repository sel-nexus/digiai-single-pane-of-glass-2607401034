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

/** Assert each item against its own source explanation rather than hardcoded page copy. */
async function assertRecommendations(page, records, scope) {
  for (const item of records) {
    const card = (scope || page).getByRole('article', { name: item.label, exact: true });
    await expect(card.getByText(`Reason: ${item.reason ?? 'Unavailable'}`, { exact: true })).toBeVisible();
    await expect(card.getByText(`Confidence: ${item.confidence ?? 'Unavailable'}`, { exact: true })).toBeVisible();
    await expect(card.getByRole('status')).toHaveText(item.complete && item.availability === 'available'
      ? 'Complete mock recommendation' : 'Incomplete · unavailable');
    await expect(card.getByText(`${item.id} · Source: ${item.source} · ${item.sourceRef}`, { exact: true })).toBeVisible();
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

test('mock recommendations navigate explicit destinations and return shared context', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Executive/ }).click();
  const recommendationsResponse = responseFor(page, '/recommendations');
  await navigatePrimary(page, 'Insights');
  let records = (await (await recommendationsResponse).json()).data;
  expect(records.length).toBeGreaterThan(1);
  expect(records.some((record) => !record.complete && record.reason === null)).toBe(true);
  await assertRecommendations(page, records);
  await page.getByText('Shared filters', { exact: false }).click();
  const filteredResponse = responseFor(page, '/recommendations', { domain: 'domain-member' });
  await page.getByLabel('Domain', { exact: true }).selectOption('domain-member');
  records = (await (await filteredResponse).json()).data;
  await assertRecommendations(page, records);
  await followDestinations(page, records.find((record) => record.associations.length === 3), '/recommendations');
});
test('contextual recommendations remain associated with selected application and filtered empty insights stay empty', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Engineering/ }).click();
  const listResponse = responseFor(page, '/recommendations');
  await navigatePrimary(page, 'Insights');
  const records = (await (await listResponse).json()).data;
  const item = records.find((record) => record.complete && record.associations.some((link) => link.entityType === 'application'));
  const app = item.associations.find((link) => link.entityType === 'application');
  const appResponse = responseFor(page, `/applications/${app.entityId}`);
  const contextualResponse = responseFor(page, '/recommendations', { applicationId: app.entityId });
  await page.getByRole('article', { name: item.label }).getByRole('link', { name: `Open application · ${app.label}`, exact: true }).click();
  expect((await (await appResponse).json()).data.id).toBe(app.entityId);
  const associated = (await (await contextualResponse).json()).data;
  expect(associated.every((record) => record.associations.some((link) => link.entityType === 'application' && link.entityId === app.entityId))).toBe(true);
  await assertRecommendations(page, associated, page.getByRole('region', { name: 'Contextual recommendations' }));
  const returnResponse = responseFor(page, '/recommendations');
  await page.getByRole('link', { name: 'Return to previous view' }).click();
  await returnResponse;
  await page.getByText('Shared filters', { exact: false }).click();
  const emptyResponse = responseFor(page, '/recommendations', { application: 'app-0002' });
  await page.getByLabel('Application', { exact: true }).selectOption('app-0002');
  expect((await (await emptyResponse).json()).data).toEqual([]);
  await expect(page.getByText(/No associated recommendations in this scope/)).toBeVisible();
});
