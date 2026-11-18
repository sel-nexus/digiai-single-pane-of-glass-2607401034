/** Verify CSV/XLSX-equivalent decimal text presentation without mutating evidence. */
import { expect, it } from 'vitest';
import { formatMetric } from './KpiBoard';

const metric = { availability: 'available', unit: '%' };

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
