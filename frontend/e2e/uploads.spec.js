/** Exercise real upload and reflected profile via clicked navigation with console capture. */
import { test, expect } from './fixtures';

async function enterUploads(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Administrator/ }).click();
  await page.getByRole('link', { name: 'Uploads', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upload & mapping' })).toBeVisible();
  await page.getByLabel('Dataset class *').selectOption('master');
  for (const [field, column] of [['id', 'Key'], ['type', 'Kind'], ['label', 'Name']]) await page.getByLabel(`Source column for ${field} *`).fill(column);
  await page.getByLabel('Source column for attributes').fill('Data');
}
async function searchProfile(page, key) {
  await page.getByRole('link', { name: 'Portfolio', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Health', exact: true })).toContainText(profile.categories.health.value[0].value);
});
test('invalid upload shows backend issues and cannot replace existing application', async ({ page }) => {
  await enterUploads(page);
  await page.getByLabel('CSV or XLSX file *').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('Key,Kind,Name,Data\napp-0001,application,Must not replace,{}\n') });
  const uploadResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/admin/uploads' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate and upload' }).click();
  const response = await uploadResponse;
  expect(response.status()).toBe(422);
  const issue = (await response.json()).error.details.issues[0];
  await expect(page.getByRole('alert')).toContainText(issue.message);
  const profile = await searchProfile(page, 'app-0001');
  expect(profile.label).not.toBe('Must not replace');
  await expect(page.getByRole('heading', { name: profile.label, exact: true })).toBeVisible();
});
