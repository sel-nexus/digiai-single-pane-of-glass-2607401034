/** Exercise the responsive shell with real persona and scoped evidence responses. */
import { test, expect } from './fixtures.js';
import { display, navigatePrimary, responseFor, selectPersona } from './helpers.js';

test('retains scoped evidence, theme and accessible navigation across routes', async ({ page }, testInfo) => {
  await page.goto('/');
  const dashboard = await selectPersona(page, 'Engineering', 'engineering');
  expect(dashboard.widgets.length).toBeGreaterThan(0);
  const widgets = page.getByRole('region', { name: 'Persona widgets' });
  await expect(widgets.getByRole('article', { name: dashboard.widgets[0].title, exact: true }))
    .toContainText(display(dashboard.widgets[0].metric));
  await expect(page.getByText(/Read-only synthetic evidence/)).toBeVisible();

  await page.getByText('Shared filters (0 selected)', { exact: true }).click();
  const domain = page.getByLabel('Domain', { exact: true });
  await expect.poll(() => domain.locator('option').count()).toBeGreaterThan(0);
  const domainId = await domain.locator('option').first().getAttribute('value');
  expect(domainId).toBeTruthy();
  const filteredResponse = responseFor(page, '/dashboard', { personaId: 'engineering', domain: domainId });
  await domain.selectOption(domainId);
  const filtered = (await (await filteredResponse).json()).data;
  expect(filtered.widgets.length).toBeGreaterThan(0);
  await expect(widgets.getByRole('article', { name: filtered.widgets[0].title, exact: true }))
    .toContainText(display(filtered.widgets[0].metric));
  await page.getByText('Shared filters (1 selected)', { exact: true }).click();

  const targetTheme = await page.locator('html').getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  await page.getByRole('button', { name: `Use ${targetTheme} theme` }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', targetTheme);
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true, includeHidden: true });
  const toggle = page.getByRole('button', { name: 'Navigation', exact: true });
  if (testInfo.project.name === 'mobile') {
    await expect(navigation).toBeHidden();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(navigation).toBeVisible();
    await navigation.getByRole('link', { name: 'Dashboard', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(toggle).toBeFocused();
  } else {
    await expect(navigation).toBeVisible();
    const header = page.locator('.app-header');
    const sidebar = page.locator('.nav-bar');
    await expect(header).toHaveCSS('position', 'fixed');
    await expect(sidebar).toHaveCSS('position', 'fixed');
    const before = await page.evaluate(() => {
      const rect = (selector) => {
        const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return { header: rect('.app-header'), sidebar: rect('.nav-bar'), main: rect('main') };
    });
    expect(before.header.y).toBe(0);
    expect(before.header.height).toBe(80);
    expect(before.sidebar.x).toBe(0);
    expect(before.sidebar.y).toBe(80);
    expect(before.sidebar.width).toBe(256);
    expect(before.main.x).toBeGreaterThanOrEqual(before.sidebar.right);
    expect(before.main.y).toBeGreaterThanOrEqual(before.header.bottom);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const after = await page.evaluate(() => {
      const rect = (selector) => {
        const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return { header: rect('.app-header'), sidebar: rect('.nav-bar'), main: rect('main'), viewportHeight: innerHeight };
    });
    expect(after.header).toEqual(before.header);
    expect(after.sidebar).toEqual(before.sidebar);
    expect(after.sidebar.bottom).toBeLessThanOrEqual(after.viewportHeight);
    expect(after.main.y).toBeLessThan(before.main.y - 100);
    await expect(navigation.getByRole('link', { name: 'Portfolio', exact: true })).toBeVisible();
  }
  const hierarchyResponse = responseFor(page, '/hierarchy');
  await navigatePrimary(page, 'Portfolio');
  const nodes = (await (await hierarchyResponse).json()).data;
  expect(nodes.length).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: 'Represented hierarchy' })
    .getByRole('button', { name: nodes[0].label, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('domain')).toBe(domainId);
  await expect(page.locator('html')).toHaveAttribute('data-theme', targetTheme);
  if (testInfo.project.name === 'mobile') {
    await expect(navigation).toBeHidden();
    await toggle.click();
  }
  await expect(navigation.getByRole('link', { name: 'Portfolio', exact: true }))
    .toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
