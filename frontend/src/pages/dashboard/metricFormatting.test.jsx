/** Verify CSV/XLSX-equivalent decimal text presentation without mutating evidence. */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { formatMetric, MetricCard } from './KpiBoard';

afterEach(cleanup);

const metric = { availability: 'available', unit: '%' };

const qualified = { ...metric, label: 'Availability', period: 'month', source: 'uploaded', sourceRef: 'csv-source-a' };

it.each([0, 100, 42.125, '0', '-0', '100', '+12.345', '.125', '9.999e1', '99.2345600000000000001']) (
  'plots qualified supplied percentage %s on the fixed scale with exact evidence', (value) => {
    const supplied = Object.freeze({ ...qualified, value });
    render(<MetricCard metric={supplied} />);
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAccessibleName(`Availability: supplied ${value}% on a 0–100% scale`);
    expect(gauge).toHaveAccessibleDescription('Fixed percentage scale only; not a score, target, trend or inferred health.');
    expect(gauge.querySelector('.metric-gauge-value')).toHaveAttribute('stroke-dasharray', `${Number(value)} 100`);
    expect(gauge.querySelector('.metric-gauge-value')).toHaveAttribute('pathLength', '100');
    expect(screen.getByText(formatMetric(supplied))).toBeVisible();
    expect(screen.getByText(`Supplied value: ${value}%`)).toBeVisible();
    expect(screen.getByText('month · uploaded')).toBeVisible();
    expect(screen.getByText('Source: csv-source-a')).toBeVisible();
    expect(supplied.value).toBe(value);
  },
);

it.each([-1, 100.01, '-.001', '-1e-1000', '100.0000000000000000001', '101', '1e3']) (
  'withholds the gauge for raw out-of-range percentage %s even when display rounds into range', (value) => {
    render(<MetricCard metric={{ ...qualified, value }} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Visualization unavailable: supplied percentage is outside 0–100%.')).toBeVisible();
    expect(screen.getByText(`Supplied value: ${value}%`)).toBeVisible();
    expect(screen.getByText(formatMetric({ ...qualified, value }))).toBeVisible();
  },
);

it.each(['', ' 12 ', '12%', '0x10', 'NaN', 'Infinity', '1e1001', '9'.repeat(1025), true, {}, [], NaN, Infinity]) (
  'does not plot malformed or unsupported percentage %s', (value) => {
    render(<MetricCard metric={{ ...qualified, value }} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable', { exact: true })).toBeVisible();
    expect(screen.getByText('Visualization unavailable: unsupported finite percentage value.')).toBeVisible();
  },
);

it.each([
  { value: null }, { value: undefined }, { value: 50, availability: 'unavailable' },
  { value: 50, period: null }, { value: 50, source: '' }, { value: 50, sourceRef: null },
  { value: 50, period: ' ' }, { value: 50, source: ' ' }, { value: 50, sourceRef: ' ' },
])('withholds unqualified or missing percentage evidence %s', (override) => {
  render(<MetricCard metric={{ ...qualified, ...override }} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Visualization unavailable:/)).toBeVisible();
});

it('keeps non-percentage measures textual and preserves an alternate title and provenance', () => {
  render(<MetricCard title="Release duration" metric={{ ...qualified, value: '12.3450000000000000001', unit: 'hours' }} />);
  expect(screen.getByRole('article', { name: 'Release duration' })).toBeVisible();
  expect(screen.getByText('12.3450000000000000001 hours')).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('Textual measure: no percentage visualization.')).toBeVisible();
  expect(screen.getByText('month · uploaded')).toBeVisible();
  expect(screen.getByText('Source: csv-source-a')).toBeVisible();
});

it.each([
  ['0', '0.00%'], ['+0', '0.00%'], ['-0', '0.00%'], [0, '0.00%'],
  ['+12.345', '12.35%'], ['-12.345', '-12.35%'],
  ['1.005', '1.01%'], [1.005, '1.01%'], ['-.125', '-0.13%'],
  ['99.2345600000000000001', '99.23%'], ['87.9950000000000000001', '88.00%'],
  ['1.004999999999999999999', '1.00%'], ['1.005000000000000000001', '1.01%'],
  ['9.999e1', '99.99%'], ['12345E-3', '12.35%'], ['+1.25e+2', '125.00%'],
  ['-5e-3', '-0.01%'], ['-4e-3', '0.00%'], ['1e-1000', '0.00%'],
  ['12.', '12.00%'], ['00012.3', '12.30%'],
  ['9007199254740991', '9007199254740991.00%'],
])('formats finite literal %s as exactly two decimals', (value, expected) => {
  const supplied = Object.freeze({ ...metric, value });
  expect(formatMetric(supplied)).toBe(expected);
  expect(supplied.value).toBe(value);
});

it.each([
  '', ' ', ' 12 ', 'NaN', 'Infinity', '-Infinity', '0x10', '1,234', '12%',
  '=1+1', '+SUM(A1)', '<script>', '1e', '.', '--1', '1_000',
  '1e1001', '1e-1001', '1e999999999999999999999', '9007199254740992',
  '9'.repeat(1025), Number.NaN, Number.POSITIVE_INFINITY, true, [], {}, undefined, null,
])('rejects invalid or unsafe percent input %s without coercing it', (value) => {
  expect(formatMetric({ ...metric, value })).toBe('Unavailable');
});

it('preserves raw non-percent text, units and absent evidence', () => {
  expect(formatMetric({ ...metric, value: '12.3450000000000000001', unit: 'hours' })).toBe('12.3450000000000000001 hours');
  expect(formatMetric({ ...metric, value: 'Developing', unit: null })).toBe('Developing');
  expect(formatMetric({ ...metric, value: 0, unit: 'incidents' })).toBe('0 incidents');
  expect(formatMetric({ ...metric, value: '12.345', unit: null })).toBe('12.345');
  expect(formatMetric({ ...metric, value: '12.345', availability: 'unavailable' })).toBe('Unavailable');
});
