/** Exercise the modern shell against real evidence on desktop and mobile in both themes. */
import { test, expect } from './fixtures.js';
import { navigatePrimary, responseFor, selectPersona, display } from './helpers.js';

/** Verify document overflow without hiding oversized content to make the check pass. */
async function expectNoOverflow(page) {
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return document.documentElement.scrollWidth <= viewport + 1
      && document.body.scrollWidth <= viewport + 1;
  }), { message: 'Content must fit the viewport without document-level horizontal scrolling' }).toBe(true);
}

/** Assert values and provenance from the observed dashboard response, never fabricated fixtures. */
async function expectDashboard(page, dashboard) {
  const overview = page.getByRole('region', { name: 'Persona widgets' });
  await expect(overview.getByRole('article')).toHaveCount(dashboard.widgets.length);
  expect(dashboard.widgets.length).toBeGreaterThan(0);
  for (const widget of dashboard.widgets) {
    const card = overview.getByRole('article', { name: widget.title, exact: true });
    await expect(card).toContainText(display(widget.metric));
    await expect(card).toContainText(widget.metric.sourceRef || 'Association unavailable');
  }
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 360, height: 800 }]) {
  for (const theme of ['light', 'dark']) {
    test(`${viewport.name} ${theme} shell retains real evidence and context across navigation without overflow`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/');
      await expectNoOverflow(page);
      const dashboard = await selectPersona(page, 'Engineering', 'engineering');
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByRole('button', { name: `Use ${theme} theme` }).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectDashboard(page, dashboard);
      await expect(page.getByText(/Read-only synthetic evidence/)).toBeVisible();
      await expectNoOverflow(page);
      await page.getByText('Shared filters (0 selected)', { exact: true }).click();
      const domain = page.getByLabel('Domain', { exact: true });
      await expect(domain).toBeVisible();
      await expect.poll(() => domain.locator('option').count()).toBeGreaterThan(0);
      const domainId = await domain.locator('option').first().getAttribute('value');
      expect(domainId).toBeTruthy();
      const filtered = responseFor(page, '/dashboard', { personaId: 'engineering', domain: domainId });
      await domain.selectOption(domainId);
      await expectDashboard(page, (await (await filtered).json()).data);
      await expectNoOverflow(page);
      await page.getByText('Shared filters (1 selected)', { exact: true }).click();
      const before = new URL(page.url()).searchParams;
      const hierarchy = responseFor(page, '/hierarchy');
      await navigatePrimary(page, 'Portfolio');
      const nodes = (await (await hierarchy).json()).data;
      expect(nodes.length).toBeGreaterThan(0);
      await expect(page.getByRole('heading', { name: 'Portfolio explorer', exact: true })).toBeVisible();
      for (const node of nodes) {
        await expect(page.getByRole('region', { name: 'Represented hierarchy' }).getByRole('button', { name: node.label, exact: true })).toBeVisible();
      }
      await expectNoOverflow(page);
      const primary = page.getByRole('navigation', { name: 'Primary', exact: true, includeHidden: true });
      if (viewport.name === 'mobile') {
        await expect(primary).toBeHidden();
        await expect(page.getByRole('button', { name: 'Navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
        await page.getByRole('button', { name: 'Navigation', exact: true }).click();
        await expect(primary).toBeVisible();
        await expectNoOverflow(page);
      }
      const returning = responseFor(page, '/dashboard', { personaId: 'engineering' });
      await navigatePrimary(page, 'Dashboard');
      const returned = (await (await returning).json()).data;
      expect(returned.persona.id).toBe('engineering');
      await expectDashboard(page, returned);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const after = new URL(page.url()).searchParams;
      for (const [key, value] of before) expect(after.get(key)).toBe(value);
      if (viewport.name === 'mobile') {
        await expect(primary).toBeHidden();
        const toggle = page.getByRole('button', { name: 'Navigation', exact: true });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(primary).toBeVisible();
        await expect(primary.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
        await toggle.click();
        await expect(primary).toBeHidden();
      } else {
        await expect(primary.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
      }
      await expectNoOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`modern-shell-${viewport.name}-${theme}.png`), fullPage: true });
    });
  }
}
