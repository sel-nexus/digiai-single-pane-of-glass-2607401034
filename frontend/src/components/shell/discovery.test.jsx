/** Verify discovery controls, safe rendering and context-preserving navigation. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import { AppShell } from './AppShell';
import { GlobalSearch } from './GlobalSearch';
import { GlobalFilters, filterLabels } from './GlobalFilters';
import { HierarchyExplorer } from './HierarchyExplorer';
import PortfolioExplorer from '../../pages/portfolio/PortfolioExplorer';
import ApplicationProfile, { APPLICATION_CATEGORIES } from '../../pages/portfolio/ApplicationProfile';

const entity = { id: 'app-1', label: '<img src=x onerror=alert(1)>', type: 'application',
  parentId: 'service-1', source: 'sample', sourceRef: 'sample-1', distinguishingInfo: 'app-1 · service-1' };
const options = Object.fromEntries(Object.keys(filterLabels).map((key) => [key, [{ id: `${key}-1`, label: `${key} option` }]]));

const evidenceValues = {
  ownership: { id: 'owner-1', label: 'Member platform team', type: 'owner' },
  domainPortfolio: { id: 'domain-1', label: 'Member experience', type: 'domain' },
  criticality: 'high',
  health: 'Supplied healthy',
  incidents: { id: 'incident-1', severity: 'Sev1', note: entity.label },
  releaseHistory: { id: 'release-1', version: '1.2.0', applicationId: entity.id },
  defects: { id: 'defect-1', openCount: 0 },
  securityPosture: { id: 'finding-1', resolved: false },
  dependencies: { id: 'api-1', label: 'Enrollment API', type: 'api' },
  automationMaturity: 72,
  observabilityCoverage: 95,
};
const profile = { id: entity.id, label: entity.label, source: entity.source, sourceRef: entity.sourceRef,
  categories: Object.fromEntries(Object.entries(evidenceValues).map(([key, value]) => [key, {
    availability: 'available', value: [{ id: `evidence-${key}`, label: `Supplied ${key}`, value,
      source: 'sample', sourceRef: `sample-${key}`, association: `entity:${entity.id}.${key}`,
      unit: ['automationMaturity', 'observabilityCoverage'].includes(key) ? '%' : null,
      period: ['automationMaturity', 'observabilityCoverage'].includes(key) ? '2025-01' : null,
    }],
  }])),
};

/** Expose current URL and explicit persona setup without mocking shared context. */
function Harness() {
  const { setPersona } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('executive')}>Select persona</button>
      <output aria-label="URL">{location.pathname}{location.search}</output>
      <GlobalSearch />
      <GlobalFilters />
      <Routes>
        <Route path="/applications/:applicationId" element={<ApplicationProfile />} />
        <Route path="/portfolio" element={<PortfolioExplorer />} />
        <Route path="*" element={<HierarchyExplorer />} />
      </Routes>
    </div>
  );
}

/** Render real provider and router for observable user interactions. */
function mount(entry = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SharedContextProvider>
        <Harness />
      </SharedContextProvider>
    </MemoryRouter>,
  );
}

/** Return a valid qualified API response for component network boundaries. */
function response(data, extra = {}) {
  return { ok: true, json: async () => ({ data, availability: 'available', page: { total: data.length || 0 }, ...extra }) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url.includes('/filters/options')) return response(options);
    if (url.includes('/applications/app-1')) return response(profile);
    if (url.includes('/entities')) return response([entity]);
    return response([], { ancestry: [] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('requires explicit search submit, renders XSS as text, opens actual application profile and returns', async () => {
  const user = userEvent.setup();
  const origin = '/dashboard?domain=domain-1&hierarchyNodeId=service-1';
  mount(origin);
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.type(screen.getByLabelText('Search names or IDs'), 'portal');
  expect(fetch.mock.calls.some(([url]) => url.includes('/entities'))).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  const result = await screen.findByRole('link', { name: entity.label });
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText(/application · app-1/)).toBeInTheDocument();
  await user.click(result);
  expect(await screen.findByRole('heading', { name: entity.label })).toBeInTheDocument();
  expect(screen.getByText('Application 360')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Portfolio explorer' })).not.toBeInTheDocument();
  expect(Object.keys(profile.categories)).toHaveLength(11);
  for (const [key, title] of Object.entries(APPLICATION_CATEGORIES)) {
    const panel = within(screen.getByRole('region', { name: title, exact: true }));
    expect(panel.getByRole('heading', { name: `Supplied ${key}` })).toBeInTheDocument();
    expect(panel.getByText(`Source: sample · sample-${key}`)).toBeInTheDocument();
    expect(panel.getByText(`Association: entity:app-1.${key}`)).toBeInTheDocument();
  }
  expect(within(screen.getByRole('region', { name: 'Incidents', exact: true })).getByText(entity.label)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Defects', exact: true })).getByText('0')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Security posture', exact: true })).getByText('false')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByLabelText('URL').textContent.split('?')[0]).toBe('/applications/app-1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=domain-1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=service-1');
  const profileRequest = fetch.mock.calls.find(([url]) => url.includes('/applications/app-1'));
  expect(profileRequest).toBeDefined();
  const scope = new URL(profileRequest[0], 'http://localhost').searchParams;
  expect(scope.get('domain')).toBe('domain-1');
  expect(scope.get('hierarchyNodeId')).toBe('service-1');
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(screen.getByLabelText('URL').textContent).toBe(origin);
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.queryByText(/Results for/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Search names or IDs')).toHaveValue('');
});

it('selects all eight dimensions, clears one and all while preserving selected route', async () => {
  const user = userEvent.setup();
  mount('/dashboard?entityId=app-1');
  await user.click(screen.getByText('Shared filters (0 selected)'));
  for (const [key, label] of Object.entries(filterLabels)) {
    await user.selectOptions(await screen.findByLabelText(label), `${key}-1`);
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent(`${key}=${key}-1`));
  }
  expect(screen.getByLabelText('URL')).toHaveTextContent('entityId=app-1');
  await user.click(screen.getByRole('button', { name: 'Clear Domain' }));
  expect(screen.getByLabelText('Domain')).toHaveValue([]);
  expect(screen.getByLabelText('Portfolio')).toHaveValue(['portfolio-1']);
  await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
  for (const label of Object.values(filterLabels)) expect(screen.getByLabelText(label)).toHaveValue([]);
});

it('shows search loading, actionable failure retry, empty and unsupported scope', async () => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation((url) => url.includes('/entities')
    ? new Promise((done) => { resolve = done; }) : Promise.resolve(response([])));
  mount();
  await user.type(screen.getByLabelText('Search names or IDs'), 'missing');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  resolve({ ok: false, json: async () => ({ error: { code: 'FAILED', message: 'Storage offline' } }) });
  expect(await screen.findByText('Storage offline')).toBeInTheDocument();
  fetch.mockImplementation(async () => response([], { unavailableDimensions: ['dateRange'] }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No matching entities. Selected filters are retained.')).toBeInTheDocument();
  expect(screen.getByText('Unavailable dimensions: dateRange')).toBeInTheDocument();
});

it('retains selected unavailable facet values and exposes options errors', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => url.includes('/filters/options')
    ? response({}, { unavailableDimensions: ['dateRange'] }) : response([]));
  mount('/dashboard?dateRange=unknown');
  await user.click(screen.getByText('Shared filters (1 selected)'));
  expect(await screen.findByText('unknown (selected; not in current options)')).toBeInTheDocument();
  expect(screen.getByLabelText('Date range')).toHaveValue(['unknown']);
  expect(screen.getAllByText('No represented options')).toHaveLength(8);
  fetch.mockRejectedValue(new Error('network'));
  await user.click(screen.getByRole('button', { name: 'Clear Date range' }));
  expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Cannot reach prototype service');
});

it('selects only current-parent children, shows ancestry, returns and reports empty leaves', async () => {
  const user = userEvent.setup();
  const root = { ...entity, id: 'd1', label: 'Member domain', type: 'domain', level: 'domain',
    parentId: null, hasRepresentedChildren: true };
  fetch.mockImplementation(async (url) => {
    if (url.includes('/filters/options')) return response(options);
    if (url.includes('parentId=d1')) return response([], { ancestry: [root] });
    return response([root], { ancestry: [] });
  });
  mount();
  await user.click(await screen.findByRole('button', { name: 'Member domain' }));
  expect(await screen.findByText('No represented children in this scope. Filters are retained.')).toBeInTheDocument();
  const ancestry = screen.getByRole('navigation', { name: 'Hierarchy ancestors' });
  expect(within(ancestry).getByRole('button', { name: 'Member domain' })).toHaveAttribute('aria-current', 'location');
  await user.click(within(ancestry).getByRole('button', { name: 'All domains' }));
  expect(await screen.findByRole('button', { name: 'Member domain' })).toBeInTheDocument();
});

it('pages search and hierarchy results and rejects a stale child', async () => {
  const user = userEvent.setup();
  const stale = { ...entity, label: 'Wrong-parent child', level: 'application', hasRepresentedChildren: false };
  fetch.mockImplementation(async (url) => {
    if (url.includes('/filters/options')) return response(options);
    if (url.includes('/entities')) return response([entity], { page: { total: 2, nextCursor: url.includes('cursor=1') ? null : '1' } });
    return response([stale], { ancestry: [], page: { total: 2, nextCursor: url.includes('cursor=1') ? null : '1' } });
  });
  mount();
  await user.click(await screen.findByRole('button', { name: 'Wrong-parent child' }));
  expect(screen.getByLabelText('URL')).not.toHaveTextContent('hierarchyNodeId');
  await user.click(screen.getByRole('button', { name: 'Next children' }));
  expect(await screen.findByRole('button', { name: 'First children' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'First children' }));
  await user.type(screen.getByLabelText('Search names or IDs'), 'portal');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await user.click(await screen.findByRole('button', { name: 'Next search results' }));
  expect(await screen.findByRole('button', { name: 'First search results' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'First search results' }));
  expect(await screen.findByRole('button', { name: 'Next search results' })).toBeInTheDocument();
});

it('discards late search responses when cleared', async () => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation((url) => url.includes('/entities')
    ? new Promise((done) => { resolve = done; }) : Promise.resolve(response([])));
  mount();
  await user.type(screen.getByLabelText('Search names or IDs'), 'portal');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  resolve(response([entity]));
  await waitFor(() => expect(screen.queryByRole('link', { name: entity.label })).not.toBeInTheDocument());
});

/** Expose shared route context while exercising the actual shell navigation. */
function ShellDestination() {
  const { setPersona } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('executive')}>Select shell persona</button>
      <output aria-label="Shell URL">{location.pathname}{location.search}</output>
    </div>
  );
}

/** Mount shell destinations without replacing the router or shared context behavior. */
function mountShell(entry = '/portfolio?domain=domain-1&hierarchyNodeId=service-1') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SharedContextProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<ShellDestination />} />
          </Route>
        </Routes>
      </SharedContextProvider>
    </MemoryRouter>,
  );
}

it.each([
  ['Dashboard', '/dashboard'], ['Portfolio', '/portfolio'], ['Journeys', '/journeys'],
  ['Operations', '/operations'], ['Reliability', '/operations/reliability'],
  ['Readiness', '/readiness'], ['Insights', '/insights'],
  ['Administration', '/admin'], ['Uploads', '/admin/uploads'],
])('closes expanded navigation on %s, retaining filters and active destination', async (name, path) => {
  const user = userEvent.setup();
  mountShell();
  await user.click(screen.getByRole('button', { name: 'Select shell persona' }));
  const toggle = screen.getByRole('button', { name: 'Navigation', exact: true });
  const navigation = screen.getByRole('navigation', { name: 'Primary', exact: true });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(navigation).toHaveClass('expanded');
  const link = within(navigation).getByRole('link', { name, exact: true });
  await user.click(link);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(navigation).not.toHaveClass('expanded');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(screen.getByLabelText('Shell URL')).toHaveTextContent(`${path}?domain=domain-1&hierarchyNodeId=service-1`);
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

it('keeps anonymous selection free of navigation and preserves brand and provenance', () => {
  mountShell('/');
  expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Navigation', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'DigiAI / Single pane of glass' })).toHaveAttribute('href', '/');
  expect(document.querySelector('.brand-mark')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText(/Read-only synthetic evidence/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
});

it('closes navigation with Escape and returns focus to its trigger', async () => {
  const user = userEvent.setup();
  mountShell();
  await user.click(screen.getByRole('button', { name: 'Select shell persona' }));
  const toggle = screen.getByRole('button', { name: 'Navigation', exact: true });
  await user.click(toggle);
  const dashboard = screen.getByRole('link', { name: 'Dashboard', exact: true });
  dashboard.focus();
  await user.keyboard('{Escape}');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveFocus();
});

it('changes theme without changing the current scope', async () => {
  const user = userEvent.setup();
  document.documentElement.dataset.theme = 'light';
  mountShell();
  await user.click(screen.getByRole('button', { name: 'Select shell persona' }));
  await user.click(screen.getByRole('button', { name: 'Use dark theme' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  expect(screen.getByLabelText('Shell URL')).toHaveTextContent('/portfolio?domain=domain-1&hierarchyNodeId=service-1');
  await user.click(screen.getByRole('button', { name: 'Use light theme' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  localStorage.removeItem('digiai-theme');
});

it('supports keyboard Dashboard selection and closes navigation without losing context', async () => {
  const user = userEvent.setup();
  mountShell();
  await user.click(screen.getByRole('button', { name: 'Select shell persona' }));
  const toggle = screen.getByRole('button', { name: 'Navigation', exact: true });
  toggle.focus();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(screen.getByRole('link', { name: 'Dashboard', exact: true })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('main')).toHaveFocus();
  expect(screen.getByLabelText('Shell URL')).toHaveTextContent('/dashboard?domain=domain-1&hierarchyNodeId=service-1');
});
