/** Verify operational selection, safe evidence, unavailable states and exact metrics. */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import IncidentBoard from './IncidentBoard';
import ReliabilityBoard from './ReliabilityBoard';
import { GlobalSearch } from '../../components/shell/GlobalSearch';

const absent = { availability: 'unavailable', value: null };
const evidence = { id: 'ticket-1', label: 'Supplied fields', value: { severity: 'Sev1', status: 'Review', note: '<img onerror=alert(1)>', signal: [0, false] }, source: 'uploaded', sourceRef: 'incident-file', association: 'entity:ticket-1' };
const records = [
  { id: 'ticket-1', label: 'Enrollment incident', recordType: 'incident', source: 'uploaded', sourceRef: 'incident-file', evidence: { availability: 'available', value: [evidence] }, businessContext: { availability: 'available', value: [{ ...evidence, label: 'Member Portal', value: { id: 'app-1', label: 'Member Portal', type: 'application' }, association: 'entity:ticket-1.applicationId' }] } },
  { id: 'ticket-2', label: 'Unlinked incident', recordType: 'incident', source: 'sample', sourceRef: 'sample-file', evidence: absent, businessContext: absent },
];
const labels = ['Availability %', 'SLA compliance %', 'Sev1 count', 'Sev2 count', 'MTTD', 'MTTR', 'repeat incident rate', 'alert noise reduction %', 'observability coverage'];

/** Qualify fetch data with the actual API envelope. */
function response(data, extra = {}) {
  return { ok: true, json: async () => ({ data, availability: 'available', ...extra }) };
}

/** Mount actual routes and shared context while exposing retained URL state. */
function Harness() {
  const { context, setPersona, setScope } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('operations')}>Select persona</button>
      <button onClick={() => setScope({ filters: { domain: ['d2'] }, hierarchyNodeId: 'node-2' })}>Narrow scope</button>
      <output aria-label="URL">{location.pathname}{location.search}</output>
      <output aria-label="Scope">{JSON.stringify(context)}</output>
      <Routes>
        <Route path="/portfolio" element={<GlobalSearch />} />
        <Route path="/operations" element={<IncidentBoard />} />
        <Route path="/operations/reliability" element={<ReliabilityBoard />} />
        <Route path="/applications/:applicationId" element={<h1>Exact application destination</h1>} />
      </Routes>
    </div>
  );
}

/** Preserve the real provider and router during user interactions. */
function mount(entry = '/operations?domain=d1') {
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
    const query = new URL(url, 'http://test').searchParams;
    if (url.includes('/personas')) return response([]);
    if (url.includes('/operations/incidents')) {
      const id = query.get('incidentId');
      return response(id ? records.filter((row) => row.id === id) : records, { page: { total: 2, limit: 20, nextCursor: null } });
    }
    if (url.includes('/operations/correlations')) {
      const id = query.get('incidentId');
      return response(id === 'ticket-1' ? [{ id: 'link-1', sourceEntityId: 'ticket-1', targetEntityId: 'event-1', relationshipLabel: 'represented correlation', evidence: { ...evidence, label: 'Latency event', association: 'relationship:link-1', sourceRef: 'event-file' } }] : [], { incidentId: id, page: { total: id === 'ticket-1' ? 1 : 0 } });
    }
    if (url.includes('/operations/metrics')) {
      const period = query.get('period');
      return response(labels.map((label, index) => ({ id: `m-${index}`, label, family: 'reliability', value: period === 'week' || label === 'MTTR' ? null : 99.23456, unit: '%', period, availability: period === 'week' || label === 'MTTR' ? 'unavailable' : 'available', source: 'uploaded', sourceRef: 'metrics-file' })));
    }
    return response([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('selects exact incident correlations and safe structured business context', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Enrollment incident' }));
  expect(await screen.findByRole('heading', { name: 'Latency event', level: 2 })).toBeInTheDocument();
  expect(screen.getByText('represented correlation · ticket-1 → event-1')).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('incidentId=ticket-1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
  const panel = within(screen.getByRole('region', { name: 'Business impact context' }));
  expect(panel.getByText('Association: entity:ticket-1.applicationId')).toBeInTheDocument();
  expect(panel.getByText('Source: uploaded · incident-file')).toBeInTheDocument();
  expect(screen.getAllByText('<img onerror=alert(1)>').length).toBeGreaterThan(0);
  expect(document.querySelector('img')).toBeNull();
  await user.click(screen.getByRole('link', { name: 'Open application · Member Portal' }));
  expect(await screen.findByRole('heading', { name: 'Exact application destination' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('/applications/app-1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('returnTo=');
});

it('switches to a missing-evidence incident without leaking previous correlations', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Enrollment incident' }));
  await screen.findByRole('heading', { name: 'Latency event', level: 2 });
  await user.click(screen.getByRole('link', { name: 'Unlinked incident' }));
  expect(await screen.findByText('Unavailable — no represented correlation supplied.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Latency event', level: 2 })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Business impact context' })).getByRole('status')).toHaveTextContent('Unavailable');
  expect(screen.queryByRole('link', { name: 'Open application · Member Portal' })).not.toBeInTheDocument();
});

it('discloses an unknown incident error and retry without substituting records', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => url.includes('incidentId=unknown')
    ? { ok: false, json: async () => ({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Unknown operational record.' } }) }
    : response(records));
  mount('/operations?incidentId=unknown');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unknown operational record.');
  fetch.mockImplementation(async () => response([], { unavailableDimensions: ['dateRange'], availability: 'unavailable' }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Selected record unavailable in this scope.')).toBeInTheDocument();
});

it('renders all nine named metrics and changes exact period through user input', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(screen.getByRole('link', { name: 'Review reliability' }));
  await screen.findByRole('heading', { name: 'MTTR' });
  expect(screen.getAllByRole('article')).toHaveLength(9);
  for (const label of labels) expect(screen.getByRole('heading', { name: label, exact: true })).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Availability %' })).getByText('99.23%')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'MTTR' })).getByText('Unavailable')).toBeInTheDocument();
  expect(await screen.findByText('Unavailable — no summary signals supplied.')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Reporting period'), 'week');
  await waitFor(() => expect(screen.getAllByText('Unavailable', { exact: true })).toHaveLength(9));
  expect(screen.getByLabelText('URL')).toHaveTextContent('period=week');
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
});

it('handles metric errors with retry and shows supplied summary app/service context', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => url.includes('/metrics')
    ? { ok: false, json: async () => ({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Metrics storage unavailable.' } }) }
    : response([]));
  mount('/operations/reliability');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Metrics storage unavailable.');
  fetch.mockImplementation(async (url) => url.includes('/metrics') ? response([]) : response([{ id: 's1', label: 'Supplied summary', evidence: { availability: 'available', value: [evidence] }, businessContext: { availability: 'available', value: [{ ...evidence, value: { applicationId: 'app-1', serviceId: 'service-1' } }] } }]));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await user.selectOptions(screen.getByLabelText('Reporting period'), 'day');
  // Signals have their own independent request and retry state.
  await user.click(screen.getByRole('link', { name: 'Return to incidents' }));
  await user.click(screen.getByRole('link', { name: 'Review reliability' }));
  const panel = within(await screen.findByRole('region', { name: 'Application / service context · Supplied summary' }));
  expect(panel.getByText('app-1')).toBeInTheDocument();
  expect(panel.getByText('service-1')).toBeInTheDocument();
});

it('shows correlation loading and failure, then retries without stale evidence', async () => {
  const user = userEvent.setup();
  let resolve;
  const original = fetch.getMockImplementation();
  fetch.mockImplementation((url) => url.includes('/correlations')
    ? new Promise((done) => { resolve = done; }) : original(url));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Enrollment incident' }));
  const panel = within(await screen.findByRole('region', { name: 'Correlations', exact: true }));
  expect(panel.getByText('Loading prototype evidence…')).toBeInTheDocument();
  resolve({ ok: false, json: async () => ({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Correlation source unavailable.' } }) });
  expect(await panel.findByRole('alert')).toHaveTextContent('Correlation source unavailable.');
  fetch.mockImplementation(async (url) => url.includes('/correlations')
    ? response([], { incidentId: 'ticket-1', availability: 'unavailable' }) : original(url));
  await user.click(panel.getByRole('button', { name: 'Try again' }));
  expect(await panel.findByText('Unavailable — no represented correlation supplied.')).toBeInTheDocument();
});

it('preserves type filtering and shows unsupported dimensions rather than unfiltered rows', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async () => response([], { availability: 'unavailable', unavailableDimensions: ['toolSource'] }));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.selectOptions(screen.getByLabelText('Record type'), 'major_incident');
  expect(await screen.findByText('Unavailable dimensions: toolSource')).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('recordType=major_incident');
  expect(screen.getByText('No operational records in this scope. Filters are retained.')).toBeInTheDocument();
});

it('returns from a searched operational ticket to the exact originating URL and scope after local navigation', async () => {
  const user = userEvent.setup();
  const origin = '/portfolio?domain=d1&domain=d3&environment=prod&hierarchyNodeId=node-1&q=Enrollment%20incident&cursor=origin-page';
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (url) => {
    if (url.includes('/entities')) return response([{ id: 'ticket-1', label: 'Search enrollment ticket', type: 'ticket', distinguishingInfo: 'incident', source: 'uploaded' }]);
    if (url.includes('/operations/incidents') && !new URL(url, 'http://test').searchParams.has('incidentId')) {
      return response(records, { page: { total: 22, limit: 20, nextCursor: 'records-page-2' } });
    }
    return original(url);
  });
  mount(origin);
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.type(screen.getByRole('textbox', { name: 'Search names or IDs' }), 'Enrollment');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await user.click(await screen.findByRole('link', { name: 'Search enrollment ticket' }));
  expect(await screen.findByRole('region', { name: 'Selected record' })).toHaveTextContent('Enrollment incident');
  expect(screen.getByRole('link', { name: 'Return to previous view' })).toHaveAttribute('href', origin);

  await user.click(screen.getByRole('button', { name: 'Narrow scope' }));
  await user.selectOptions(screen.getByLabelText('Record type'), 'major_incident');
  await user.click(await screen.findByRole('link', { name: 'Next records' }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('cursor=records-page-2');
  await user.click(screen.getByRole('link', { name: 'First records' }));
  expect(screen.getByLabelText('URL').textContent).not.toContain('cursor=');
  await user.click(await screen.findByRole('link', { name: 'Unlinked incident' }));
  expect(screen.getByRole('link', { name: 'Return to previous view' })).toHaveAttribute('href', origin);
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(screen.getByLabelText('URL').textContent).toBe(origin);
  await waitFor(() => expect(JSON.parse(screen.getByLabelText('Scope').textContent)).toMatchObject({
    personaId: 'operations', filters: { domain: ['d1', 'd3'], environment: ['prod'] }, hierarchyNodeId: 'node-1',
  }));
});

it('retains query-based return context, repeated filters and hierarchy through pagination and type changes', async () => {
  const user = userEvent.setup();
  const origin = '/portfolio?domain=d1&hierarchyNodeId=node-1&q=original%20search';
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (url) => url.includes('/operations/incidents')
    ? response(records, { page: { nextCursor: 'next-page' } }) : original(url));
  mount(`/operations?domain=d1&domain=d3&hierarchyNodeId=node-1&q=retained&returnTo=${encodeURIComponent(origin)}`);
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Next records' }));
  await user.click(screen.getByRole('link', { name: 'First records' }));
  await user.selectOptions(screen.getByLabelText('Record type'), 'problem_rca');
  const query = new URLSearchParams(screen.getByLabelText('URL').textContent.split('?')[1]);
  expect(query.getAll('domain')).toEqual(['d1', 'd3']);
  expect(query.get('hierarchyNodeId')).toBe('node-1');
  expect(query.get('q')).toBe('retained');
  expect(query.get('returnTo')).toBe(origin);
  expect(query.get('recordType')).toBe('problem_rca');
  expect(screen.getByRole('link', { name: 'Return to previous view' })).toHaveAttribute('href', origin);
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(screen.getByLabelText('URL').textContent).toBe(origin);
});

it.each(['https://outside.test/path', '//outside.test/path', '/\\outside.test', '/portfolio\nunsafe', '/portfolio\runsafe', null])(
  'falls back to a scope-preserving internal return for unsafe or absent origin %s', async (origin) => {
    const user = userEvent.setup();
    mount({ pathname: '/operations', search: '?domain=d1&domain=d3&hierarchyNodeId=node-1', state: { origin } });
    await user.click(screen.getByRole('button', { name: 'Select persona' }));
    const link = screen.getByRole('link', { name: 'Return to previous view' });
    expect(link).toHaveAttribute('href', '/portfolio?personaId=operations&hierarchyNodeId=node-1&domain=d1&domain=d3');
    await user.click(link);
    expect(screen.getByLabelText('URL').textContent).toBe('/portfolio?personaId=operations&hierarchyNodeId=node-1&domain=d1&domain=d3');
  },
);
