/** Verify safe per-item explanations, contextual isolation and supplied-only trends. */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import RecommendationList, { ContextualRecommendations } from './RecommendationList';
import TransformationBoard from './TransformationBoard';
import TransformationTrends, { insightValue } from './TransformationTrends';
import ApplicationProfile from '../portfolio/ApplicationProfile';
import IncidentBoard from '../operations/IncidentBoard';
import ReleaseEvidence from '../readiness/ReleaseEvidence';

const association = { id: 'link-1', entityType: 'application', entityId: 'a/1', label: 'Exact app',
  destination: '/applications/a%2F1', source: 'uploaded', sourceRef: 'map-file' };
const records = [
  { id: 'one', label: 'First suggestion', reason: '<script>unsafe</script>', confidence: 'Source level A', complete: true,
    availability: 'available', source: 'uploaded', sourceRef: 'file-1', associations: [association] },
  { id: 'two', label: 'Second suggestion', reason: 'Second reason', confidence: 0, complete: true,
    availability: 'available', source: 'local', sourceRef: 'file-2', associations: [] },
  { id: 'three', label: 'Missing reason', reason: null, confidence: 'Supplied B', complete: false,
    availability: 'unavailable', source: 'sample', sourceRef: 'file-3', associations: [] },
  { id: 'four', label: 'Missing confidence', reason: 'Fourth reason', confidence: null, complete: false,
    availability: 'unavailable', source: 'sample', sourceRef: 'file-4', associations: [] },
];
const point = (id, period, value) => ({ id, period, value, label: 'Adoption', unit: '%',
  source: 'uploaded', sourceRef: `source-${id}`, availability: 'available' });
const transformation = { id: 't1', label: 'Supplied transformation', source: 'uploaded', sourceRef: 'trans-file',
  associations: [association], measures: [point('adoption', 'later', 65.4321),
    { ...point('maturity', 'later', 'Developing'), label: 'Maturity', unit: null },
    { ...point('value', 'later', 1200.25), label: 'Value realized', unit: 'USD' },
    { ...point('effort', null, 4), label: 'Effort saved', unit: 'hours', value: null, availability: 'unavailable' }],
  series: [{ label: 'Adoption', availability: 'available', points: [point('p1', 'later', 65.4321), point('p2', 'earlier', 58.25)] }] };

/** Keep tests on the real envelope adapter and cancellable request hook. */
function response(data, extras = {}) {
  return { ok: true, json: async () => ({ data, availability: 'available', page: { total: data?.length || 0, nextCursor: null }, ...extras }) };
}

/** Expose real navigable detail placements and selected shared scope. */
function Harness() {
  const { setPersona } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('executive')}>Select persona</button>
      <output aria-label="URL">{location.pathname}{location.search}</output>
      <Routes>
        <Route path="/insights" element={<RecommendationList />} />
        <Route path="/insights/transformation" element={<TransformationBoard />} />
        <Route path="/applications/:applicationId" element={<ApplicationProfile />} />
        <Route path="/operations" element={<IncidentBoard />} />
        <Route path="/readiness" element={<ReleaseEvidence />} />
        <Route path="/context" element={<ContextualRecommendations applicationId="a/1" />} />
      </Routes>
    </div>
  );
}

/** Mount only slice components, keeping the actual context provider and router. */
function mount(entry = '/insights?domain=d1&hierarchyNodeId=h1') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SharedContextProvider>
        <Harness />
      </SharedContextProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url.includes('/recommendations')) return response(records);
    if (url.includes('/transformation')) return response([transformation]);
    if (url.includes('/applications/')) return response({ id: 'a/1', label: 'Exact app', categories: {}, source: 'uploaded', sourceRef: 'app-file' });
    return response([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('keeps reason and confidence local to each item, handles zero, safe text and reordered responses', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  const first = within(await screen.findByRole('article', { name: 'First suggestion' }));
  expect(first.getByText('Reason: <script>unsafe</script>')).toBeInTheDocument();
  expect(first.getByText('Confidence: Source level A')).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
  expect(within(screen.getByRole('article', { name: 'Second suggestion' })).getByText('Confidence: 0')).toBeInTheDocument();
  for (const label of ['Missing reason', 'Missing confidence']) {
    expect(within(screen.getByRole('article', { name: label })).getByRole('status')).toHaveTextContent('Incomplete · unavailable');
  }
  expect(first.getByText('Association: link-1 · uploaded · map-file')).toBeInTheDocument();
  fetch.mockImplementation(async () => response([...records].reverse()));
  await user.click(screen.getByRole('link', { name: 'Transformation evidence' }));
  await user.click(screen.getByRole('link', { name: 'Mock recommendations' }));
  await screen.findByRole('article', { name: 'First suggestion' });
  expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Missing confidence');
  expect(within(screen.getByRole('article', { name: 'First suggestion' })).getByText('Confidence: Source level A')).toBeInTheDocument();
});

it('uses exact application links and returns to saved filters and hierarchy', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Open application · Exact app' }));
  expect(await screen.findByRole('heading', { name: 'Exact app', level: 1 })).toBeInTheDocument();
  const contextual = within(screen.getByRole('region', { name: 'Contextual recommendations' }));
  await waitFor(() => expect(contextual.getAllByRole('article')).toHaveLength(1));
  expect(contextual.queryByRole('article', { name: 'Second suggestion' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('/insights?domain=d1&hierarchyNodeId=h1');
});

it('renders supplied measure precision and series order without labeling single or missing-period points as trends', async () => {
  const user = userEvent.setup();
  mount('/insights/transformation');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  const card = within(await screen.findByRole('article', { name: transformation.label }));
  expect(card.getAllByText('65.43%').length).toBeGreaterThan(0);
  expect(card.getByText('Developing')).toBeInTheDocument();
  expect(card.getByText('1200.25 USD')).toBeInTheDocument();
  expect(card.getByText('Unavailable', { exact: true })).toBeInTheDocument();
  const points = within(screen.getByRole('list', { name: 'Adoption source order' })).getAllByRole('listitem');
  expect(points[0]).toHaveTextContent('later · 65.43%');
  expect(points[1]).toHaveTextContent('earlier · 58.25%');
  fetch.mockImplementation(async () => response([{ ...transformation, series: [{ label: 'Adoption', availability: 'unavailable', points: [point('p1', 'later', 65.4321)] }] }]));
  await user.selectOptions(screen.getByLabelText('Source reporting period'), 'later');
  expect(await screen.findByText(/Trend unavailable. A single point/)).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('period=later');
});

it.each([
  ['65.4321', '65.43%'],
  ['1.005', '1.01%'],
  ['-1.005', '-1.01%'],
  ['0', '0.00%'],
])('formats numeric-text percentage %s in measures and supplied series as %s', async (value, expected) => {
  const user = userEvent.setup();
  const measure = point('text-measure', 'later', value);
  const seriesPoints = [point('text-later', 'later', value), point('text-earlier', 'earlier', '58.25')];
  fetch.mockImplementation(async () => response([{
    ...transformation,
    measures: [measure],
    series: [{ label: 'Adoption', availability: 'available', points: seriesPoints }],
  }]));
  mount('/insights/transformation');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  const card = within(await screen.findByRole('article', { name: transformation.label }));
  expect(card.getByText(expected, { exact: true })).toBeInTheDocument();
  const points = within(card.getByRole('list', { name: 'Adoption source order' })).getAllByRole('listitem');
  expect(points[0]).toHaveTextContent(`later · ${expected}`);
  expect(points[1]).toHaveTextContent('earlier · 58.25%');
  expect(card.queryByRole('status')).not.toBeInTheDocument();
  expect(measure.value).toBe(value);
  expect(seriesPoints[0].value).toBe(value);
});

it.each([
  { availability: 'unavailable' },
  { period: null },
  { sourceRef: null },
  { value: null },
  { value: undefined },
  { value: { unsafe: 1 } },
  { value: true },
  { value: Infinity },
  { value: NaN },
])('retains insight evidence guards for %j', (override) => {
  expect(insightValue({ ...point('guarded', 'later', '65.4321'), ...override })).toBe('Unavailable');
});

it.each([
  ['Developing', null, 'Developing'],
  ['1200.2500', 'USD', '1200.2500 USD'],
  ['Source estimate', 'hours', 'Source estimate hours'],
])('preserves raw non-percent value %s and unit %s', (value, unit, expected) => {
  expect(insightValue({ ...point('raw', 'later', value), unit })).toBe(expected);
});

it('handles absent and malformed periods safely without invented trend or object rendering', () => {
  const { rerender } = render(<TransformationTrends />);
  expect(screen.getByRole('status')).toHaveTextContent('No explicit-period series supplied');
  rerender(<TransformationTrends series={[{ label: 'Unsafe', availability: 'available', points: [point('1', null, 5), point('2', 'p2', { unsafe: 1 })] }]} />);
  expect(screen.getByRole('status')).toHaveTextContent('Trend unavailable');
  expect(screen.getByText('Period unavailable · Unavailable')).toBeInTheDocument();
});

it.each(['/insights', '/insights/transformation'])('shows loading, error, retry and filtered empty state on %s', async (entry) => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  mount(entry);
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  resolve({ ok: false, json: async () => ({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Insights unavailable.' } }) });
  expect(await screen.findByRole('alert')).toHaveTextContent('Insights unavailable.');
  fetch.mockImplementation(async () => response([], { availability: 'unavailable', unavailableDimensions: ['toolSource'] }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Unavailable dimensions: toolSource')).toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});

it('shows contextual recommendations only for selected incident and release application evidence', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => {
    if (url.includes('/recommendations')) return response(records);
    if (url.includes('/operations/incidents')) return response([{ id: 'i1', label: 'Incident', recordType: 'incident',
      evidence: { availability: 'unavailable', value: null }, businessContext: { availability: 'available', value: [
        { id: 'e1', label: 'App association', source: 'uploaded', sourceRef: 'incident-map', association: 'context:e1',
          value: { id: 'a/1', type: 'application', label: 'Exact app' } }] } }]);
    return response([]);
  });
  mount('/operations?incidentId=i1');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('article', { name: 'First suggestion' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'Second suggestion' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => new URL(url, 'http://test').searchParams.get('applicationId') === 'a/1')).toBe(true);
});

it('places contextual recommendations on selected release detail, not the unselected list', async () => {
  const user = userEvent.setup();
  const absent = { availability: 'unavailable', value: null };
  fetch.mockImplementation(async (url) => url.includes('/recommendations') ? response(records) : response([{
    id: 'r1', label: 'Release', application: { id: 'a/1', label: 'Exact app' }, categories: {
      build: absent, test: absent, security: absent, change: absent, environment: absent } }]));
  mount('/readiness');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await screen.findByRole('link', { name: 'Release', exact: true });
  expect(screen.queryByRole('region', { name: 'Contextual recommendations' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Release', exact: true }));
  expect(await screen.findByRole('article', { name: 'First suggestion' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'Second suggestion' })).not.toBeInTheDocument();
});

it('omits unsafe destinations and unproven associations rather than inventing a link', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async () => response([{ ...records[0], associations: [
    { ...association, destination: 'https://evil.example' },
    { ...association, id: 'unproven', sourceRef: null },
  ] }]));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  const card = within(await screen.findByRole('article', { name: 'First suggestion' }));
  expect(card.getByText('Related destinations unavailable.')).toBeInTheDocument();
  expect(card.queryByRole('link')).not.toBeInTheDocument();
});


it('adds an accessible comparison while retaining exact values, units, provenance and source order', () => {
  const supplied = [
    { ...point('later', 'later category', '1200.2500'), unit: 'USD' },
    { ...point('earlier', 'earlier category', '-400.5000'), unit: 'USD' },
  ];
  const { rerender } = render(<TransformationTrends series={[{ label: 'Value', availability: 'available', points: supplied }]} />);
  const chart = screen.getByRole('img', { name: 'Value: source-ordered comparison (USD)' });
  expect(chart).toHaveAccessibleDescription('1. later category: 1200.2500 (unit: USD); Source: uploaded · source-later | 2. earlier category: -400.5000 (unit: USD); Source: uploaded · source-earlier');
  expect(screen.getByText(/Exact supplied values:/)).toHaveTextContent('1200.2500 (unit: USD)');
  const list = within(screen.getByRole('list', { name: 'Value source order' })).getAllByRole('listitem');
  expect(list[0]).toHaveTextContent('later category · 1200.2500 USD');
  expect(list[1]).toHaveTextContent('earlier category · -400.5000 USD');
  expect(chart.querySelectorAll('rect')).toHaveLength(2);
  expect(chart.querySelector('polyline, path')).toBeNull();
  rerender(<TransformationTrends series={[{ label: 'Value', availability: 'available', points: [...supplied].reverse() }]} />);
  expect(screen.getByRole('img')).toHaveAccessibleDescription(/^1\. earlier category:/);
  expect(supplied[0].value).toBe('1200.2500');
});

it.each([
  { availability: 'unavailable' }, { availability: undefined },
  { source: null }, { source: '' }, { source: ' ' }, { source: 42 },
  { sourceRef: null }, { sourceRef: ' ' }, { sourceRef: 42 },
  { period: null }, { period: ' ' },
  { unit: null }, { unit: '' }, { unit: ' ' }, { unit: 'hours' },
  { value: null }, { value: undefined }, { value: true }, { value: false },
  { value: {} }, { value: [] }, { value: '' }, { value: ' ' },
  { value: 'Developing' }, { value: '1 hour' }, { value: '0x10' },
  { value: '1,000' }, { value: '12%' }, { value: 'Infinity' },
  { value: '1e309' }, { value: Infinity }, { value: -Infinity }, { value: NaN },
])('leaves the entire comparison unplotted for invalid point %j', (override) => {
  const supplied = [
    { ...point('one', 'later', 12), unit: 'USD' },
    { ...point('two', 'earlier', 8), unit: 'USD', ...override },
  ];
  render(<TransformationTrends series={[{ label: 'Value', availability: 'available', points: supplied }]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Comparison unplotted/)).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Value source order' })).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('later · 12 USD')).toBeInTheDocument();
});

it.each([
  { availability: 'unavailable', points: [point('1', 'p1', 1), point('2', 'p2', 2)] },
  { points: [point('1', 'p1', 1)] },
  { points: [] }, { points: {} },
])('withholds charts for missing or unavailable whole series %j', (override) => {
  render(<TransformationTrends series={[{ label: 'Adoption', availability: 'available', ...override }]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Comparison unplotted/)).toBeInTheDocument();
});

it.each([
  [-10, 0, 20], [-10, -5, -0], [0, -0, 0], [7, 7, 7], [-7, -7, -7],
  [-Number.MAX_VALUE, 0, Number.MAX_VALUE], [Number.MIN_VALUE, 0, -Number.MIN_VALUE],
])('keeps signed bars and zero markers bounded for %j', (...values) => {
  const supplied = values.map((value, index) => ({ ...point(String(index), `category-${index}`, value), unit: 'hours' }));
  render(<TransformationTrends series={[{ label: 'Effort', availability: 'available', points: supplied }]} />);
  const chart = screen.getByRole('img', { name: 'Effort: source-ordered comparison (hours)' });
  const baseline = Number(chart.querySelector('line').getAttribute('x1'));
  const bars = [...chart.querySelectorAll('rect')];
  for (const [index, bar] of bars.entries()) {
    const x = Number(bar.getAttribute('x'));
    const width = Number(bar.getAttribute('width'));
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(width)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(80);
    expect(width).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(560);
    if (values[index] < 0) { expect(x).toBeLessThan(baseline); expect(x + width).toBeCloseTo(baseline); }
    else { expect(x).toBe(baseline); }
    if (values[index] === 0) expect(width).toBe(0);
    else expect(width).toBeGreaterThan(0);
  }
  expect(chart.querySelectorAll('circle')).toHaveLength(values.filter((value) => value === 0).length);
  expect(chart.outerHTML).not.toMatch(/NaN|Infinity/);
  if (values.every((value) => value === values[0])) {
    expect(new Set(bars.map((bar) => bar.getAttribute('width'))).size).toBe(1);
  }
});

it.each(['1e-400', '+1e-400', '-1e-400'])('withholds qualified underflow %s without representing it as exact zero', (value) => {
  const supplied = [point('tiny', 'tiny category', value), point('other', 'other category', '1')];
  render(<TransformationTrends series={[{ label: 'Adoption', availability: 'available', points: supplied }]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Comparison unplotted/)).toHaveTextContent(/magnitudes.*numeric conversion or chart scaling/i);
  expect(screen.getByText(/Exact supplied values:/)).toHaveTextContent(`${value} (unit: %)`);
  expect(document.querySelector('circle')).toBeNull();
  expect(supplied[0].value).toBe(value);
});

it.each([
  [Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 0],
  [-Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 0],
  [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE],
  [-1, 1, Number.MIN_VALUE, -Number.MIN_VALUE],
])('withholds mixed signed magnitudes %j when nonzero bars would collapse', (...values) => {
  const supplied = values.map((value, index) => ({ ...point(String(index), `category-${index}`, value), unit: 'hours' }));
  render(<TransformationTrends series={[{ label: 'Effort', availability: 'available', points: supplied }]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/Comparison unplotted/)).toHaveTextContent(/magnitudes.*numeric conversion or chart scaling/i);
  const exact = screen.getByText(/Exact supplied values:/);
  values.forEach((value, index) => expect(exact).toHaveTextContent(`${index + 1}. category-${index}: ${String(value)} (unit: hours)`));
  expect(document.querySelector('circle')).toBeNull();
  expect(within(screen.getByRole('list', { name: 'Effort source order' })).getAllByRole('listitem')).toHaveLength(values.length);
});

it.each(['0', '-0', '+0.000e-400'])('retains true numeric-text zero markers for %s', (value) => {
  render(<TransformationTrends series={[{ label: 'Effort', availability: 'available', points: [
    { ...point('zero', 'zero category', value), unit: 'hours' },
    { ...point('other', 'other category', 1), unit: 'hours' },
  ] }]} />);
  const chart = screen.getByRole('img');
  expect(chart.querySelectorAll('circle')).toHaveLength(1);
  expect(chart.querySelector('rect')).toHaveAttribute('width', '0');
  expect(chart).toHaveAccessibleDescription(new RegExp(`${value.replace(/[+.*]/g, '\\$&')} \\(unit: hours\\)`));
});

it('charts numeric-text percentages with unchanged two-decimal presentation and exact alternatives', () => {
  render(<TransformationTrends series={[{ label: 'Adoption', availability: 'available', points: [
    point('one', 'later', '-1.005'), point('two', 'earlier', '+6.54321e1'),
  ] }]} />);
  expect(screen.getByText('later · -1.01%')).toBeInTheDocument();
  expect(screen.getByText('earlier · 65.43%')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAccessibleDescription(/-1\.005 \(unit: %\).*\+6\.54321e1 \(unit: %\)/);
});
