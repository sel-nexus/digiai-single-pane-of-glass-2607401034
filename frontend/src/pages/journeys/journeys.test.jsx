/** Verify real journey route interactions at the component network boundary. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import JourneyList from './JourneyList';
import JourneyMap from './JourneyMap';
import RelationshipOverlay from './RelationshipOverlay';
import PortfolioExplorer from '../portfolio/PortfolioExplorer';
import ApplicationProfile from '../portfolio/ApplicationProfile';
import { GlobalSearch } from '../../components/shell/GlobalSearch';

const identity = { id: 'journey-1', label: 'Enrollment', type: 'journey', source: 'sample', sourceRef: 'journey-map' };
const app = { id: 'app-1', label: 'Member Portal', type: 'application', source: 'uploaded', sourceRef: 'asset-file' };
const dependency = { id: 'rel-1', type: 'depends_on', sourceEntityId: 'journey-1', sourceLabel: 'Enrollment',
  source: 'uploaded', sourceRef: 'relationship-file', representedContext: 'Explicit association',
  target: { entityType: 'application', entityId: app.id, label: app.label, source: app.source, sourceRef: app.sourceRef } };
const api = { ...dependency, id: 'rel-api', type: 'impact', target: {
  entityType: 'api', entityId: 'api-1', label: 'Enrollment API', source: 'local', sourceRef: 'api-map',
} };
const detail = { ...identity, description: 'Supplied journey', relationships: [dependency, api],
  dependency: { availability: 'available', value: [dependency] }, impactOverlay: { availability: 'available', value: [api] },
  impact: { availability: 'unavailable', value: null } };

/** Return qualified network responses without replacing app routing or context. */
function response(data, extra = {}) {
  return { ok: true, json: async () => ({ data, availability: 'available', ...extra }) };
}

/** Expose URL state and explicit persona interaction around implemented pages. */
function Harness() {
  const { setPersona } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('executive')}>Select persona</button>
      <output aria-label="URL">{location.pathname}{location.search}</output>
      <GlobalSearch />
      <Routes>
        <Route path="/journeys" element={<JourneyList />} />
        <Route path="/journeys/:journeyId" element={<JourneyMap />} />
        <Route path="/portfolio" element={<PortfolioExplorer />} />
        <Route path="/applications/:applicationId" element={<ApplicationProfile />} />
      </Routes>
    </div>
  );
}

/** Mount the actual provider and router with preserved filters and hierarchy. */
function mount(entry = '/journeys?domain=d1&hierarchyNodeId=s1') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SharedContextProvider>
        <Harness />
      </SharedContextProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url.includes('/personas')) return response([{ id: 'executive', label: 'Executive' }]);
    if (url.includes('/applications/')) return response({ ...app, categories: {
      health: { availability: 'available', value: [{ id: 'health-1', label: 'Supplied health', value: 'Warning (uploaded)',
        source: 'uploaded', sourceRef: 'health-file', association: 'entity:app-1.health' }] },
    } });
    if (url.includes('/journeys/')) return response(detail);
    if (url.includes('/journeys')) return response([identity], { page: { total: 1, nextCursor: null } });
    if (url.includes('/entities')) return response([app]);
    return response([], { ancestry: [] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('selects a journey, switches overlays and opens exact application identity with return scope', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Enrollment', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Enrollment' })).toBeInTheDocument();
  expect(screen.getByText('Business impact unavailable.')).toBeInTheDocument();
  expect(screen.getByText('Relationship source: uploaded · relationship-file')).toBeInTheDocument();
  expect(screen.queryByText('Enrollment API')).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Impact overlay', exact: true }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('overlay=impact');
  await user.click(screen.getByText('Inspect API asset · Enrollment API'));
  expect(screen.getByText(/Represented API asset: api-1/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /Open application/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Dependency overlay', exact: true }));
  await user.click(screen.getByRole('link', { name: 'Open application · Member Portal' }));
  expect(await screen.findByRole('heading', { name: 'Member Portal' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('/applications/app-1');
  expect(screen.getByText('Warning (uploaded)')).toBeInTheDocument();
  expect(screen.getByText('Source: uploaded · asset-file')).toBeInTheDocument();
  expect(screen.getByText('Source: uploaded · health-file')).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=s1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(await screen.findByRole('heading', { name: 'Enrollment' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=s1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('overlay=depends_on');
  await user.click(screen.getByRole('link', { name: 'All journeys' }));
  expect(await screen.findByRole('heading', { name: 'Business journeys' })).toBeInTheDocument();
});

it('keeps missing relationships unavailable and does not borrow another overlay', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => url.includes('/personas') ? response([])
    : response({ ...detail, dependency: { availability: 'unavailable', value: null },
      impactOverlay: { availability: 'unavailable', value: null } }));
  mount('/journeys/journey-1');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByText(/Dependency relationships unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open application/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Impact overlay', exact: true }));
  expect(screen.getByText(/Impact relationships unavailable/)).toBeInTheDocument();
});

it('shows detail failure, retries to scoped unavailable and preserves return navigation', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async () => ({ ok: false, json: async () => ({ error: {
    code: 'RESOURCE_NOT_FOUND', message: 'No represented journey has this identifier.',
  } }) }));
  mount('/journeys/missing?dateRange=absent');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No represented journey');
  fetch.mockImplementation(async () => response(null, { availability: 'unavailable', unavailableDimensions: ['dateRange'] }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Journey unavailable in this scope' })).toBeInTheDocument();
  expect(screen.getByText('Unavailable dimensions: dateRange')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'All journeys' })).toHaveAttribute('href', expect.stringContaining('dateRange=absent'));
});

it('shows list loading, empty unsupported scope, retry and bounded URL pagination', async () => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  resolve(response([], { unavailableDimensions: ['dateRange'] }));
  expect(await screen.findByText(/No represented journeys in this scope/)).toBeInTheDocument();
  expect(screen.getByText('Unavailable dimensions: dateRange')).toBeInTheDocument();
  fetch.mockImplementation(async () => response([identity], { page: { total: 21, nextCursor: '20' } }));
  await user.type(screen.getByLabelText('Search names or IDs'), 'journey');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  // Search journey result uses the implemented detail route, not an unavailable profile.
  const search = screen.getByRole('region', { name: 'Enterprise search' });
  await user.click(await within(search).findByRole('link', { name: 'Enrollment' }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('/journeys/journey-1');
});

it('pages the list through links and retains selected hierarchy', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => response([identity], {
    page: { total: 21, nextCursor: url.includes('cursor=20') ? null : '20' },
  }));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Next journeys' }));
  await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('journeyCursor=20'));
  await user.click(await screen.findByRole('link', { name: 'First journeys' }));
  expect(screen.getByLabelText('URL')).not.toHaveTextContent('journeyCursor');
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=s1');
});

/** Render supplied overlay rows without changing routing or context contracts. */
function mountOverlay(overlay, kind = 'depends_on') {
  return render(
    <MemoryRouter initialEntries={['/journeys/journey-1?domain=d1&overlay=depends_on']}>
      <SharedContextProvider>
        <RelationshipOverlay overlay={overlay} kind={kind} />
      </SharedContextProvider>
    </MemoryRouter>,
  );
}

it('connects only supplied edge identities with accessible source-to-target direction and provenance', () => {
  const second = { ...api, type: 'depends_on', sourceEntityId: app.id, sourceLabel: app.label };
  mountOverlay({ availability: 'available', value: [dependency, second, api] });
  const edges = within(screen.getByRole('list', { name: 'Dependency directed relationships' })).getAllByRole('listitem');
  expect(edges).toHaveLength(2);
  for (const [index, row] of [dependency, second].entries()) {
    expect(edges[index]).toHaveAttribute('data-relationship-id', row.id);
    const pair = within(edges[index]).getByRole('group', {
      name: `${row.sourceLabel} (${row.sourceEntityId}) → ${row.target.label} (${row.target.entityId}): ${row.type}`,
    });
    expect(pair.querySelectorAll('[data-entity-id]')).toHaveLength(2);
    expect(pair.querySelectorAll('[data-entity-id]')[0]).toHaveAttribute('data-entity-id', row.sourceEntityId);
    expect(pair.querySelectorAll('[data-entity-id]')[1]).toHaveAttribute('data-entity-id', row.target.entityId);
    expect(within(pair).getByText(row.type, { exact: true })).toBeInTheDocument();
    expect(within(pair).getByText(row.id, { exact: true })).toBeInTheDocument();
    expect(within(edges[index]).getByText(`Relationship source: ${row.source} · ${row.sourceRef}`)).toBeInTheDocument();
  }
  expect(screen.getByText(/repeated nodes do not add links/)).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: /: impact$/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open application · Member Portal' })).toHaveAttribute('href',
    expect.stringContaining('/applications/app-1?'));
});

it.each([
  ['absent', undefined],
  ['unavailable despite supplied rows', { availability: 'unavailable', value: [dependency] }],
  ['empty', { availability: 'available', value: [] }],
  ['wrong overlay only', { availability: 'available', value: [api] }],
])('discloses %s relationships without drawing nodes or offering drilldown', (_, overlay) => {
  mountOverlay(overlay);
  expect(screen.getByRole('status')).toHaveTextContent('Dependency relationships unavailable. No associated evidence supplied in this scope.');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('keeps API inspection native and exposes missing relationship and asset references', async () => {
  const user = userEvent.setup();
  mountOverlay({ availability: 'available', value: [{ ...api, sourceRef: undefined,
    target: { ...api.target, sourceRef: undefined } }] }, 'impact');
  expect(screen.getByRole('list', { name: 'Impact directed relationships' })).toBeInTheDocument();
  expect(screen.getByText('Relationship source: uploaded · Reference unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('Asset source: local · Reference unavailable')).toHaveLength(2);
  const summary = screen.getByText('Inspect API asset · Enrollment API');
  expect(summary.tagName).toBe('SUMMARY');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  // JSDOM does not implement native summary keyboard activation; Playwright covers Enter.
  await user.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
  expect(screen.getByText(/Represented API asset: api-1/)).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
