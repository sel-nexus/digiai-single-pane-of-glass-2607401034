/** Capture representative accessible structure, styles and screenshots without replaying journeys. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.PREFLIGHT_URL || 'http://127.0.0.1:8080';
const output = process.env.PREFLIGHT_OUTPUT || 'preflight-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const records = [];
for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto(base);
  await page.getByRole('button', { name: /Executive/ }).waitFor();
  /** Save text-based accessibility, rendered HTML and intrinsic layout evidence. */
  async function capture(state) {
    const accessibility = typeof page.accessibility?.snapshot === 'function'
      ? await page.accessibility.snapshot() : await page.locator('body').ariaSnapshot();
    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const main = getComputedStyle(document.querySelector('main'));
      return { font: body.fontFamily, background: body.backgroundColor, color: body.color,
        mainPadding: main.padding, mainWidth: main.width, viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: getComputedStyle(document.querySelector('h1')).fontSize };
    });
    const html = await page.content();
    records.push({ view: name, state, accessibility, styles, html });
    await page.screenshot({ path: `${output}/${name}-${state}.png`, fullPage: true });
  }
  await capture('selection');
  await page.getByRole('button', { name: /Executive/ }).click();
  await page.getByRole('heading', { name: 'Executive perspective' }).waitFor();
  await capture('dashboard');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await capture('dark-dashboard');
  await page.getByRole('button', { name: 'Switch persona' }).click();
  await capture('persona-dialog');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const primary = page.getByRole('navigation', { name: 'Primary', includeHidden: true });
  if (!(await primary.isVisible())) await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await primary.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('heading', { name: 'Portfolio explorer' }).waitFor();
  await capture('portfolio');
  await page.getByLabel('Search names or IDs').fill('unrepresented-preflight-record');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('No matching entities. Selected filters are retained.').waitFor();
  await capture('empty-search');
  await page.close();
}
await browser.close();
await writeFile(`${output}/structure.json`, JSON.stringify(records, null, 2), 'utf8');
console.log(`Captured ${records.length} representative states in ${output}/structure.json`);
