/** Verify percentage visualization against unchanged real KPI responses and UI filter journeys. */
import { test, expect } from './fixtures.js';
import { responseFor, selectPersona } from './helpers.js';

/** Interpret supported decimal evidence exactly for an independent scale and display oracle. */
function decimal(value) {
  if (!['string', 'number'].includes(typeof value)) return null;
  const text = String(value);
  if (text.length > 1024) return null;
  const match = /^([+-]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) return null;
  const exponent = Number(match[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const fraction = match[3] ?? match[4] ?? '';
  const coefficient = BigInt(`${match[2] || '0'}${fraction}`);
  const shift = exponent - fraction.length;
  const numerator = shift >= 0 ? coefficient * 10n ** BigInt(shift) : coefficient;
  const denominator = shift < 0 ? 10n ** BigInt(-shift) : 1n;
  const cents = numerator * 100n / denominator
    + (numerator * 100n % denominator * 2n >= denominator ? 1n : 0n);
  if (cents > 900719925474099100n) return null;
  const digits = cents.toString().padStart(3, '0');
  return {
    coefficient,
    inRange: !(match[1] === '-' && coefficient !== 0n) && numerator <= 100n * denominator,
    display: `${match[1] === '-' && cents !== 0n ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}%`,
  };
}

/** Compare every rendered value, source and gauge to the observed backend evidence. */
async function expectEvidence(board, metrics) {
  await expect(board.getByRole('article')).toHaveCount(metrics.length);
  if (!metrics.length) {
    await expect(board.getByRole('status')).toContainText('No configured evidence for this view.');
    await expect(board.getByRole('img')).toHaveCount(0);
    return { plotted: 0, withheld: 0 };
  }
  let plotted = 0, withheld = 0;
  for (const [index, metric] of metrics.entries()) {
    const card = board.getByRole('article').nth(index);
    await expect(card).toHaveAccessibleName(metric.label);
    const parsed = decimal(metric.value);
    const available = metric.availability === 'available' && metric.value != null;
    const text = !available ? 'Unavailable' : metric.unit === '%'
      ? parsed?.display ?? 'Unavailable' : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
    await expect(card.locator('.metric-value')).toHaveText(text);
    await expect(card.locator('.muted')).toHaveText(`${metric.period || 'Period unavailable'} · ${metric.source || 'Source unavailable'}`);
    await expect(card.locator('.source-ref')).toHaveText(`Source: ${metric.sourceRef || 'Association unavailable'}`);
    const qualified = [metric.period, metric.source, metric.sourceRef].every((value) => typeof value === 'string' && value.trim());
    const numeric = Number(metric.value);
    const eligible = available && metric.unit === '%' && qualified && parsed?.inRange
      && Number.isFinite(numeric) && (numeric !== 0 || parsed.coefficient === 0n);
    await expect(card.getByRole('img')).toHaveCount(eligible ? 1 : 0);
    if (eligible) {
      plotted += 1;
      await expect(card.getByRole('img')).toHaveAccessibleName(`${metric.label}: supplied ${metric.value}% on a 0–100% scale`);
      await expect(card.getByRole('img')).toHaveAccessibleDescription('Fixed percentage scale only; not a score, target, trend or inferred health.');
      await expect(card.locator('.metric-gauge-value')).toHaveAttribute('stroke-dasharray', `${numeric} 100`);
      await expect(card.locator('.metric-gauge-value')).toHaveAttribute('pathLength', '100');
    } else {
      withheld += 1;
      await expect(card.locator('.metric-visualization-context')).toContainText(available && metric.unit !== '%' ? 'Textual measure' : 'Visualization unavailable');
    }
    if (available && metric.unit === '%' && parsed) {
      await expect(card.locator('.metric-source-value')).toHaveText(`Supplied value: ${metric.value}%`);
    }
  }
  return { plotted, withheld };
}

test('family and period selections preserve real text and only visualize qualified percentages', async ({ page, browserErrors }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const initial = responseFor(page, '/kpis', { family: 'enterprise', period: 'month' });
  await selectPersona(page, 'Operations', 'operations');
  const board = page.getByRole('region', { name: 'KPI evidence' });
  const first = await initial;
  expect(first.status()).toBe(200);
  let total = await expectEvidence(board, (await first.json()).data);
  for (const family of ['reliability', 'release', 'qe', 'security', 'transformation', 'enterprise']) {
    const familyResponse = responseFor(page, '/kpis', { family, period: 'month' });
    await page.getByLabel('Metric family', { exact: true }).selectOption(family);
    total.plotted += (await expectEvidence(board, (await (await familyResponse).json()).data)).plotted;
    for (const period of ['day', 'week', 'quarter', 'month']) {
      const periodResponse = responseFor(page, '/kpis', { family, period });
      await page.getByLabel('Reporting period', { exact: true }).selectOption(period);
      const response = await periodResponse;
      expect(response.status()).toBe(200);
      const metrics = (await response.json()).data;
      for (const metric of metrics) expect(metric.period).toBe(period);
      const counts = await expectEvidence(board, metrics);
      total.plotted += counts.plotted;
      total.withheld += counts.withheld;
      expect(new URL(page.url()).searchParams.get('family')).toBe(family);
      expect(new URL(page.url()).searchParams.get('period')).toBe(period);
    }
  }
  expect(total.plotted, 'Live evidence must exercise an actual eligible percentage').toBeGreaterThan(0);
  expect(total.withheld, 'Live evidence must exercise an unavailable or textual measure').toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('modern-metrics-mobile.png'), fullPage: true });
});
