/** Exercise real operational evidence navigation with automatic console-error capture. */
import { test, expect } from './fixtures.js';
import { navigatePrimary } from './helpers.js';

test('observability summaries preserve explicit service context and source association', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Operations/ }).click();
  const summaryResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/operations/observability' && res.ok());
  await navigatePrimary(page, 'Reliability');
  const signals = (await (await summaryResponse).json()).data;
  expect(signals.length).toBeGreaterThan(0);
  for (const signal of signals) {
    await expect(page.getByRole('region', { name: signal.label, exact: true }).getByText(`Association: ${signal.evidence.value[0].association}`, { exact: true })).toBeVisible();
    const context = page.getByRole('region', { name: `Application / service context · ${signal.label}`, exact: true });
    for (const item of signal.businessContext.value) await expect(context.getByText(item.value.id, { exact: true })).toBeVisible();
  }
});

