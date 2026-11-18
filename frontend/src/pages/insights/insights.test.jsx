/** Verify safe per-item explanations, contextual isolation and supplied-only trends. */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import RecommendationList, { ContextualRecommendations } from './RecommendationList';
import TransformationBoard from './TransformationBoard';
import TransformationTrends from './TransformationTrends';
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
