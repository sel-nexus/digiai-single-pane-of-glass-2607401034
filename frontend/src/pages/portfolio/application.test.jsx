/** Verify exact profile routing, safe evidence and contextual return interactions. */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import { GlobalSearch } from '../../components/shell/GlobalSearch';
import ApplicationProfile, { APPLICATION_CATEGORIES } from './ApplicationProfile';
import PortfolioExplorer from './PortfolioExplorer';

const absent = Object.fromEntries(Object.keys(APPLICATION_CATEGORIES).map((key) => [key, { availability: 'unavailable', value: null }]));
const profile = { id: 'app-1', label: 'Member Portal', source: 'uploaded', sourceRef: 'app-file', categories: absent };

/** Qualify network data consistently with the backend contract. */
function response(data, extra = {}) {
  return { ok: true, json: async () => ({ data, availability: 'available', ...extra }) };
}

/** Preserve real route and provider semantics while exposing the URL. */
function Harness() {
  const { setPersona } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('executive')}>Select persona</button>
      <output aria-label="URL">{location.pathname}{location.search}</output>
      <GlobalSearch />
      <Routes>
        <Route path="/applications/:applicationId" element={<ApplicationProfile />} />
        <Route path="/portfolio" element={<PortfolioExplorer />} />
      </Routes>
    </div>
  );
}

/** Mount preserved scope and optional origin through the real router. */
function mount(entry = '/applications/app-1?domain=d1&hierarchyNodeId=s1') {
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
    if (url.includes('/personas')) return response([]);
    if (url.includes('/applications/')) return response(profile);
    if (url.includes('/entities')) return response([{ ...profile, type: 'application', distinguishingInfo: 'app-1' }]);
    return response([], { ancestry: [] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('shows all eleven absent categories and retains scope on return', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('heading', { name: 'Member Portal' })).toBeInTheDocument();
  for (const title of Object.values(APPLICATION_CATEGORIES)) {
    expect(within(screen.getByRole('region', { name: title, exact: true })).getByRole('status')).toHaveTextContent('Unavailable');
  }
  expect(fetch.mock.calls.some(([url]) => url.includes('/applications/app-1') && url.includes('domain=d1') && url.includes('hierarchyNodeId=s1'))).toBe(true);
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(await screen.findByRole('heading', { name: 'Portfolio explorer' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=s1');
});

it('renders all eleven available categories with safe structured values and sources', async () => {
  const user = userEvent.setup();
  const categories = Object.fromEntries(Object.keys(absent).map((key) => [key, { availability: 'available', value: [{
    id: key, label: `Supplied ${key}`, value: { note: '<img src=x onerror=alert(1)>', values: [0, false, { status: 'Supplied' }] },
    source: 'uploaded', sourceRef: `file-${key}`, association: `entity:app-1.${key}`, unit: '%', period: 'month',
  }] }]));
  fetch.mockImplementation(async (url) => url.includes('/personas') ? response([]) : response({ ...profile, categories }));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await screen.findByRole('heading', { name: 'Member Portal' });
  for (const [key, title] of Object.entries(APPLICATION_CATEGORIES)) {
    const panel = within(screen.getByRole('region', { name: title, exact: true }));
    expect(panel.getByText(`Source: uploaded · file-${key}`)).toBeInTheDocument();
    expect(panel.getByText(`Association: entity:app-1.${key}`)).toBeInTheDocument();
    expect(panel.getByText('0')).toBeInTheDocument();
    expect(panel.getByText('false')).toBeInTheDocument();
    expect(panel.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  }
  expect(document.querySelector('img')).toBeNull();
});

it('shows loading then error and retries to scoped unavailable without fallback', async () => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  resolve({ ok: false, json: async () => ({ error: { code: 'RESOURCE_NOT_FOUND', message: 'No represented application.' } }) });
  expect(await screen.findByRole('alert')).toHaveTextContent('No represented application.');
  expect(screen.queryByRole('heading', { name: 'Member Portal' })).not.toBeInTheDocument();
  fetch.mockImplementation(async () => response(null, { availability: 'unavailable', unavailableDimensions: ['dateRange'] }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Application unavailable in this scope' })).toBeInTheDocument();
  expect(screen.getByText('Unavailable dimensions: dateRange')).toBeInTheDocument();
});

it('opens the exact search application and returns to the original portfolio URL', async () => {
  const user = userEvent.setup();
  mount('/portfolio?domain=d1&hierarchyNodeId=s1');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.type(screen.getByLabelText('Search names or IDs'), 'app-1');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  const search = within(screen.getByRole('region', { name: 'Enterprise search' }));
  await user.click(await search.findByRole('link', { name: 'Member Portal' }));
  expect(await screen.findByRole('heading', { name: 'Member Portal' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('/applications/app-1');
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(await screen.findByRole('heading', { name: 'Portfolio explorer' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('/portfolio?domain=d1&hierarchyNodeId=s1');
});

it('opens an application selected through represented portfolio hierarchy', async () => {
  const user = userEvent.setup();
  mount('/portfolio?hierarchyNodeId=app-1');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await user.click(await screen.findByRole('link', { name: 'Open Application 360 · Member Portal' }));
  expect(await screen.findByRole('heading', { name: 'Member Portal' })).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=app-1');
});

it('refuses mismatched response identity and unsafe return origins', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async (url) => url.includes('/personas') ? response([]) : response({ ...profile, id: 'other-app' }));
  mount('/applications/app-1?returnTo=https%3A%2F%2Fevil.example');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('heading', { name: 'Application unavailable in this scope' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Return to previous view' })).toHaveAttribute('href', expect.stringContaining('/portfolio?'));
  expect(screen.queryByRole('heading', { name: 'Member Portal' })).not.toBeInTheDocument();
});

it('encodes opaque IDs and discards stale profile responses after navigation', async () => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation((url) => url.includes('/applications/') ? new Promise((done) => { resolve = done; })
    : Promise.resolve(response([{ ...profile, id: 'app-2', type: 'application' }])));
  mount('/applications/%3Cscript%3E');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('/applications/%3Cscript%3E'))).toBe(true));
  const oldResolve = resolve;
  await user.type(screen.getByLabelText('Search names or IDs'), 'app-2');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await user.click(await within(screen.getByRole('region', { name: 'Enterprise search' })).findByRole('link', { name: 'Member Portal' }));
  await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/applications/app-2'));
  oldResolve(response({ ...profile, id: '<script>' }));
  resolve(response({ ...profile, id: 'app-2', label: 'Exact second application' }));
  expect(await screen.findByRole('heading', { name: 'Exact second application' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Member Portal' })).not.toBeInTheDocument();
});
