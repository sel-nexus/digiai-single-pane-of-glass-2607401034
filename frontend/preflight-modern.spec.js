/** Capture real UI accessibility, styles, HTML and screenshots for human review. */
import { test, expect } from './e2e/fixtures.js';
import { navigatePrimary, selectPersona } from './e2e/helpers.js';
import fs from 'node:fs/promises';

/** Preserve representative state evidence without rerunning journey assertions. */
test('capture modern interface evidence', async ({ page }) => {
  test.setTimeout(120000);
  await fs.mkdir('preflight-modern-evidence', { recursive: true });
  const captures = [];
  async function capture(name) {
    const styles = await page.evaluate(() => ({
      font: getComputedStyle(document.body).fontFamily,
      background: getComputedStyle(document.body).backgroundColor,
      heading: getComputedStyle(document.querySelector('h1')).fontSize,
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      theme: document.documentElement.dataset.theme,
    }));
    const accessibility = await page.locator('body').ariaSnapshot();
    const html = await page.content();
    captures.push(`${name}\nSTYLES ${JSON.stringify(styles)}\nACCESSIBILITY\n${accessibility}\nHTML\n${html}\n`);
    await page.screenshot({ path: `preflight-modern-evidence/${name}.png`, fullPage: true });
  }
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Administrator/ })).toBeVisible();
    await capture(`${width}-selection`);
    await selectPersona(page, 'Administrator', 'administrator');
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByRole('button', { name: `Use ${theme} theme` }).click();
      }
      await capture(`${width}-${theme}-dashboard`);
      for (const [label, heading] of [['Portfolio', 'Portfolio explorer'], ['Journeys', 'Journey maps'], ['Operations', 'Incidents and problem records'], ['Reliability', 'Reliability evidence'], ['Readiness', 'Release evidence'], ['Insights', 'Mock recommendations'], ['Administration', 'Local data stewardship'], ['Uploads', 'Upload prototype evidence']]) {
        await navigatePrimary(page, label);
        await page.locator('h1').waitFor();
        await expect(page.getByText('Loading prototype evidence…')).toHaveCount(0);
        await capture(`${width}-${theme}-${label.toLowerCase()}`);
      }
      await navigatePrimary(page, 'Dashboard');
    }
  }
  await fs.writeFile('preflight-modern-evidence/ui-evidence.txt', captures.join('\n\n'), 'utf8');
});
