import { fileURLToPath } from 'node:url';
/** Exercise real upload and reflected profile via clicked navigation with console capture. */
import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, holdResponse } from './helpers.js';

async function enterUploads(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Administrator/ }).click();
  await navigatePrimary(page, 'Uploads');
  await expect(page.getByRole('heading', { name: 'Upload & mapping' })).toBeVisible();
  await page.getByLabel('Dataset class *').selectOption('master');
  for (const [field, column] of [['id', 'Key'], ['type', 'Kind'], ['label', 'Name']]) await page.getByLabel(`Source column for ${field} *`).fill(column);
  await page.getByLabel('Source column for attributes').fill('Data');
}
async function searchProfile(page, key) {
  await navigatePrimary(page, 'Portfolio');
  await page.getByLabel('Search names or IDs').fill(key);
  const search = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/entities' && res.url().includes(`q=${key}`));
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const entity = (await (await search).json()).data.find((item) => item.id === key);
  const profile = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v1/applications/${key}` && res.ok());
  await page.getByRole('region', { name: 'Enterprise search' }).getByRole('link', { name: entity.label, exact: true }).click();
  return (await (await profile).json()).data;
}
test('file upload confirms version then profile fetch reflects uploaded health', async ({ page }) => {
  await enterUploads(page);
  const key = `e2e-upload-${Date.now()}`;
  await page.getByLabel('CSV or XLSX file *').setInputFiles({ name: 'inventory.csv', mimeType: 'text/csv', buffer: Buffer.from(`Key,Kind,Name,Data\n${key},application,Uploaded ${key},"{""health"":""Source upload evidence""}"\n`) });
  const uploadResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/admin/uploads' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const upload = (await response.json()).data;
  await expect(page.getByRole('status').filter({ hasText: 'Upload confirmed' })).toContainText(upload.datasetVersion);
  const profile = await searchProfile(page, key);
  expect(profile.source).toBe('uploaded');
  expect(profile.sourceRef).toBe(upload.datasetVersion);
  await expect(page.getByRole('heading', { name: profile.label, level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Health', exact: true })).toContainText(profile.categories.health.value[0].value);
});
test('invalid upload shows backend issues and cannot replace existing application', async ({ page, expectedTransportErrors }) => {
  await enterUploads(page);
  expectedTransportErrors.push(/^Failed to load resource: the server responded with a status of 422 \(Unprocessable Entity\)$/);
  await page.getByLabel('CSV or XLSX file *').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('Key,Kind,Name,Data\napp-0001,application,Must not replace,{}\n') });
  const uploadResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/admin/uploads' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const response = await uploadResponse;
  expect(response.status()).toBe(422);
  const issue = (await response.json()).error.details.issues[0];
  await expect(page.getByRole('alert')).toContainText(issue.message);
  const profile = await searchProfile(page, 'app-0001');
  expect(profile.label).not.toBe('Must not replace');
  await expect(page.getByRole('heading', { name: profile.label, level: 1, exact: true })).toBeVisible();
});

test('actual XLSX file upload reflects literal worksheet evidence in Application 360', async ({ page }, testInfo) => {
  await enterUploads(page);
  await page.getByLabel('CSV or XLSX file *').setInputFiles(fileURLToPath(new URL(`./fixtures/inventory-${testInfo.project.name}.xlsx`, import.meta.url)));
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/admin/uploads' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const upload = (await result.json()).data;
  expect(upload.acceptedRows).toBe(1);
  expect(upload.reflection.status).toBe('confirmed');
  await expect(page.getByRole('status').filter({ hasText: 'Upload confirmed' })).toContainText(upload.datasetVersion);
  const profile = await searchProfile(page, `e2e-xlsx-${testInfo.project.name}`);
  expect(profile.sourceRef).toBe(upload.datasetVersion);
  expect(profile.categories.health.value[0].value).toBe('Literal XLSX source evidence');
  await expect(page.getByRole('region', { name: 'Health', exact: true })).toContainText(profile.categories.health.value[0].value);
});
test('upload loading stays visible until unchanged real commit response is released', async ({ page }) => {
  await enterUploads(page);
  const key = `held-upload-${Date.now()}`;
  await page.getByLabel('CSV or XLSX file *').setInputFiles({ name: 'held.csv', mimeType: 'text/csv', buffer: Buffer.from(`Key,Kind,Name,Data\n${key},application,Held source record,{}\n`) });
  const held = await holdResponse(page, '/admin/uploads');
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const response = await held.received;
  expect(response.status()).toBe(201);
  const upload = (await response.json()).data;
  await expect(page.getByRole('status').filter({ hasText: 'Validating the full batch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validating and committing…' })).toBeDisabled();
  await expect(page.getByLabel('CSV or XLSX file *')).toBeDisabled();
  held.release();
  await expect(page.getByRole('status').filter({ hasText: 'Upload confirmed' })).toContainText(upload.datasetVersion);
  const profile = await searchProfile(page, key);
  expect(profile.sourceRef).toBe(upload.datasetVersion);
});
test('connection loss after real commit locks unknown completion without automatic retry and evidence remains queryable', async ({ page, request, expectedTransportErrors }) => {
  await enterUploads(page);
  const key = `lost-upload-${Date.now()}`;
  await page.getByLabel('CSV or XLSX file *').setInputFiles({ name: 'lost.csv', mimeType: 'text/csv', buffer: Buffer.from(`Key,Kind,Name,Data\n${key},application,Committed with lost response,{}\n`) });
  expectedTransportErrors.push(/^Failed to load resource: net::ERR_CONNECTION_RESET$/);
  let writes = 0, committed;
  const received = new Promise((resolve) => { committed = resolve; });
  await page.route('**/api/v1/admin/uploads', async (route) => {
    writes += 1;
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(201);
    const upload = (await response.json()).data;
    expect(upload.reflection.status).toBe('confirmed');
    committed(upload);
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const upload = await received;
  await expect(page.getByRole('alert')).toContainText('Upload completion unconfirmed');
  await expect(page.getByRole('alert')).toContainText('Do not assume rollback');
  await expect(page.getByRole('button', { name: 'Validate and upload' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Upload confirmed', exact: true })).toHaveCount(0);
  // UploadForm's lock is local to the mounted page. Verify persistence independently
  // before navigating, rather than claiming a remounted form retained the lock.
  const profileCheck = await request.get(`/api/v1/applications/${key}`);
  expect(profileCheck.status()).toBe(200);
  const persisted = (await profileCheck.json()).data;
  expect(persisted.id).toBe(key);
  expect(persisted.sourceRef).toBe(upload.datasetVersion);
  const auditCheck = await request.get('/api/v1/admin/audit', {
    params: { target: upload.datasetVersion, eventType: 'uploaded_data_version' },
  });
  expect(auditCheck.status()).toBe(200);
  const persistedEvents = (await auditCheck.json()).data;
  expect(persistedEvents).toHaveLength(1);
  expect(persistedEvents[0].datasetVersionId).toBe(upload.datasetVersion);
  await expect(page.getByRole('button', { name: 'Validate and upload' })).toBeDisabled();
  await page.getByRole('button', { name: 'I checked the outcome; unlock a new attempt', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Validate and upload' })).toBeEnabled();
  await expect(page.getByLabel('CSV or XLSX file *')).toBeEnabled();
  await expect(page.getByLabel('Dataset class *')).toHaveValue('master');
  await expect(page.getByText(/Selected: lost.csv/)).toBeVisible();
  expect(writes, 'Unlock is not a second submission').toBe(1);
  const profile = await searchProfile(page, key);
  expect(profile.sourceRef).toBe(upload.datasetVersion);
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
  await navigatePrimary(page, 'Administration');
  await page.getByLabel('Audit event type').selectOption('uploaded_data_version');
  await page.getByLabel('Audit target ID').fill(upload.datasetVersion);
  const audit = responseFor(page, '/admin/audit', { target: upload.datasetVersion, eventType: 'uploaded_data_version' });
  await page.getByRole('button', { name: 'Apply audit filters' }).click();
  const events = (await (await audit).json()).data;
  expect(events).toHaveLength(1);
  expect(events[0].datasetVersionId).toBe(upload.datasetVersion);
  await expect(page.getByRole('region', { name: 'Audit log' })).toContainText(events[0].id);
  expect(events[0].id).toBe(persistedEvents[0].id);
  await page.getByRole('link', { name: 'Open dataset uploads and column mapping', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upload & mapping', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate and upload' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Upload confirmed', exact: true })).toHaveCount(0);
  const finalAudit = await request.get('/api/v1/admin/audit', {
    params: { target: upload.datasetVersion, eventType: 'uploaded_data_version' },
  });
  expect(finalAudit.status()).toBe(200);
  expect((await finalAudit.json()).data).toEqual(persistedEvents);
  expect(writes, 'No automatic second write through unlock, dependent views and UI return').toBe(1);
});
