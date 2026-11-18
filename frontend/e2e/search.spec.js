import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, selectPersona } from './helpers.js';

const pages = ['Dashboard', 'Portfolio', 'Journeys', 'Operations', 'Reliability', 'Readiness', 'Insights', 'Administration', 'Uploads',
  'Application 360', 'Journey detail', 'Journey impact', 'Transformation', 'Selected release',
  'DevSecOps metrics', 'QE / environment', 'Security posture'];
const identities = [['domain-member', 'domain'], ['portfolio-digital', 'portfolio'], ['service-enrollment', 'service'], ['app-0001', 'application'], ['env-0001', 'environment'], ['ticket-1', 'ticket'], ['release-1', 'release']];
for (const source of pages) {
  test(`enterprise search on ${source} resolves all seven supported types using real response identities`, async ({ page }) => {
    await page.goto('/');
    await selectPersona(page);
    if (source === 'Application 360') {
      await navigatePrimary(page, 'Portfolio');
      const search = responseFor(page, '/entities', { q: 'app-0001' });
      await page.getByLabel('Search names or IDs').fill('app-0001');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const entity = (await (await search).json()).data.find((item) => item.id === 'app-0001');
      const detail = responseFor(page, '/applications/app-0001');
      await page.getByRole('region', { name: 'Enterprise search' }).getByRole('link', { name: entity.label, exact: true }).click();
      const profile = (await (await detail).json()).data;
      expect(profile.id).toBe(entity.id);
      await expect(page.getByRole('heading', { name: profile.label, level: 1, exact: true })).toBeVisible();
    } else if (source.startsWith('Journey ')) {
      const list = responseFor(page, '/journeys');
      await navigatePrimary(page, 'Journeys');
      const journey = (await (await list).json()).data.find((item) => item.id === 'journey-enrollment');
      const detail = responseFor(page, `/journeys/${journey.id}`);
      await page.getByRole('link', { name: journey.label, exact: true }).click();
      expect((await (await detail).json()).data.id).toBe(journey.id);
      if (source === 'Journey impact') await page.getByRole('link', { name: 'Impact overlay', exact: true }).click();
      await expect(page.getByRole('heading', { name: journey.label, level: 1, exact: true })).toBeVisible();
    } else if (source === 'Transformation') {
      await navigatePrimary(page, 'Insights');
      const evidence = responseFor(page, '/transformation');
      await page.getByRole('link', { name: 'Transformation evidence', exact: true }).click();
      const item = (await (await evidence).json()).data.find((record) => record.id === 'transformation-1');
      await expect(page.getByRole('article', { name: item.label, exact: true })).toBeVisible();
    } else if (['Selected release', 'DevSecOps metrics', 'QE / environment', 'Security posture'].includes(source)) {
      const releases = responseFor(page, '/readiness/evidence');
      await navigatePrimary(page, 'Readiness');
      const release = (await (await releases).json()).data.find((record) => record.id === 'release-1');
      if (source === 'Selected release') {
        const detail = responseFor(page, '/readiness/evidence', { releaseId: release.id });
        await page.getByRole('list', { name: 'Release records' }).getByRole('link', { name: release.label, exact: true }).click();
        expect((await (await detail).json()).data[0].id).toBe(release.id);
      } else {
        const family = { 'DevSecOps metrics': 'release', 'QE / environment': 'qe', 'Security posture': 'security' }[source];
        const measures = responseFor(page, '/readiness/metrics', { family });
        await page.getByRole('navigation', { name: 'Readiness families' }).getByRole('link', { name: source, exact: true }).click();
        const metric = (await (await measures).json()).data[0];
        expect(metric.family).toBe(family);
        await expect(page.getByRole('article', { name: metric.label, exact: true })).toBeVisible();
      }
    } else if (source !== 'Dashboard') await navigatePrimary(page, source);
    // Clear prior setup search before submitting the same ID on a detail page.
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    const sourceURL = page.url();
    for (const [id, type] of identities) {
      const response = responseFor(page, '/entities', { q: id });
      await page.getByLabel('Search names or IDs').fill(id);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const records = (await (await response).json()).data;
      const entity = records.find((e) => e.id === id);
      expect(entity.type).toBe(type);
      const item = page.getByRole('region', { name: 'Enterprise search' }).getByRole('listitem').filter({ has: page.getByRole('link', { name: entity.label, exact: true }) });
      await expect(item).toContainText(entity.type);
      await expect(item).toContainText(entity.source);
      await expect(item.getByRole('link')).toBeVisible();
      await expect(page).toHaveURL(sourceURL);
    }
    const empty = responseFor(page, '/entities', { q: 'no such source entity' });
    await page.getByLabel('Search names or IDs').fill('no such source entity');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    expect((await (await empty).json()).data).toEqual([]);
    await expect(page.getByText('No matching entities. Selected filters are retained.', { exact: true })).toBeVisible();
  });
}

test('source ID search opens exact destinations for seven entity types through clicked navigation', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  for (const [id, type] of identities) {
    const q = id === 'ticket-1' ? 'TICKET-1' : id;
    const search = responseFor(page, '/entities', { q });
    await page.getByLabel('Search names or IDs').fill(q);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const entity = (await (await search).json()).data.find((e) => e.id === id);
    expect(entity.type).toBe(type);
    const origin = page.url();
    const destination = responseFor(page, type === 'application' ? `/applications/${id}`
      : type === 'ticket' ? '/operations/incidents'
      : type === 'release' ? '/readiness/evidence' : '/entities',
      type === 'ticket' ? { incidentId: id } : type === 'release' ? { releaseId: id } : type === 'application' ? {} : { q: id });
    await page.getByRole('region', { name: 'Enterprise search' }).getByRole('link', { name: entity.label, exact: true }).click();
    const data = (await (await destination).json()).data;
    if (type === 'application') {
      expect(data.id).toBe(id);
      await expect(page.getByRole('heading', { name: data.label, level: 1, exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Return to previous view' }).click();
    } else {
      const record = data.find((e) => e.id === id);
      expect(record.label).toBe(entity.label);
      if (type === 'ticket') {
        await expect(page.getByRole('region', { name: 'Selected record' }).getByRole('heading', { name: record.label, level: 2, exact: true })).toBeVisible();
        await page.getByRole('link', { name: 'Return to previous view', exact: true }).click();
        await expect(page).toHaveURL(origin);
      }
      else if (type === 'release') await expect(page.getByRole('list', { name: 'Release records' }).getByRole('link', { name: record.label, exact: true })).toBeVisible();
      else await expect(page.getByRole('region', { name: 'Selected entity' }).getByRole('heading', { name: record.label, exact: true })).toBeVisible();
      if (type !== 'ticket') await navigatePrimary(page, 'Dashboard');
    }
    await page.getByRole('button', { name: 'Clear search' }).click();
  }
});


test('ticket search returns exact portfolio origin, filters and hierarchy after local type and record navigation', async ({ page }) => {
  await page.goto('/');
  await selectPersona(page);
  await navigatePrimary(page, 'Portfolio');
  await page.getByText('Shared filters', { exact: false }).click();
  await page.getByLabel('Domain', { exact: true }).selectOption('domain-member');
  await page.getByLabel('Application', { exact: true }).selectOption('app-0001');
  for (const [label, id] of [['Member Experience', 'domain-member'], ['Digital Services', 'portfolio-digital'], ['Enrollment Services', 'service-enrollment'], ['Member Portal', 'app-0001']]) {
    const hierarchy = responseFor(page, '/hierarchy', { parentId: id });
    await page.getByRole('region', { name: 'Represented hierarchy' }).getByRole('button', { name: label, exact: true }).click();
    expect((await (await hierarchy).json()).ancestry.at(-1).id).toBe(id);
  }
  const origin = page.url();
  const search = responseFor(page, '/entities', { q: 'TICKET-1', domain: 'domain-member', application: 'app-0001' });
  await page.getByLabel('Search names or IDs').fill('TICKET-1');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const ticket = (await (await search).json()).data.find((item) => item.id === 'ticket-1');
  expect(ticket.type).toBe('ticket');
  const detail = responseFor(page, '/operations/incidents', { incidentId: ticket.id });
  await page.getByRole('region', { name: 'Enterprise search' }).getByRole('link', { name: ticket.label, exact: true }).click();
  const record = (await (await detail).json()).data.find((item) => item.id === ticket.id);
  await expect(page.getByRole('region', { name: 'Selected record' })).toContainText(record.label);
  const typed = responseFor(page, '/operations/incidents', { recordType: 'incident' });
  await page.getByLabel('Record type', { exact: true }).selectOption('incident');
  expect((await (await typed).json()).data.some((item) => item.id === ticket.id)).toBe(true);
  const reselected = responseFor(page, '/operations/incidents', { incidentId: ticket.id });
  await page.getByRole('list', { name: 'Operational records' }).getByRole('link', { name: record.label, exact: true }).click();
  expect((await (await reselected).json()).data[0].id).toBe(ticket.id);
  await expect(page.getByRole('region', { name: 'Selected record' })).toContainText(record.sourceRef);
  await page.getByRole('link', { name: 'Return to previous view', exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByLabel('Domain', { exact: true })).toHaveValues(['domain-member']);
  await expect(page.getByLabel('Application', { exact: true })).toHaveValues(['app-0001']);
  await expect(page.getByRole('navigation', { name: 'Hierarchy ancestors' }).getByRole('button', { name: 'Member Portal', exact: true })).toHaveAttribute('aria-current', 'location');
});
