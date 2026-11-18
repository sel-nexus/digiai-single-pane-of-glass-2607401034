/** Verify readiness routes, source rendering, exact periods and unavailable states. */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import ReleaseEvidence from './ReleaseEvidence';
import DevSecOpsMetrics from './DevSecOpsMetrics';
import QeEnvironmentMetrics from './QeEnvironmentMetrics';
import SecurityPosture from './SecurityPosture';
import ApplicationProfile from '../portfolio/ApplicationProfile';

const names = {
  release: ['deployment frequency', 'lead time for change', 'change failure rate', 'rollback rate', 'pipeline success rate'],
  qe: ['test execution success %', 'automation coverage %', 'defect leakage %', 'escaped defects', 'environment readiness %'],
  security: ['critical vulnerabilities', 'aged findings', 'secure SDLC compliance %', 'policy violations'],
};
const absent = { availability: 'unavailable', value: null };
const release = { id: 'r/1', label: 'Uploaded release', application: { id: 'a/1', label: 'Exact application' }, source: 'uploaded', sourceRef: 'release-file', categories: Object.fromEntries(['build', 'test', 'security', 'change', 'environment'].map((key) => [key, key === 'environment' ? absent : { availability: 'available', value: [{ id: 'r/1', label: `Supplied ${key} status`, value: { status: '<img onerror=alert(1)>' }, period: 'month', source: 'uploaded', sourceRef: 'status-file', association: `entity:r/1.${key}` }] }])) };

/** Wrap realistic API data without hiding envelope validation. */
function response(data, extra = {}) {
  return { ok: true, json: async () => ({ data, availability: 'available', ...extra }) };
}

/** Mount real feature pages and expose navigable URL scope. */
function Harness() {
  const { setPersona } = useSharedContext();
  const location = useLocation();
  return (
    <div>
      <button onClick={() => setPersona('engineering')}>Select persona</button>
      <output aria-label="URL">{location.pathname}{location.search}</output>
      <Routes>
        <Route path="/readiness" element={<ReleaseEvidence />} />
        <Route path="/readiness/release" element={<DevSecOpsMetrics />} />
        <Route path="/readiness/qe" element={<QeEnvironmentMetrics />} />
        <Route path="/readiness/security" element={<SecurityPosture />} />
        <Route path="/applications/:applicationId" element={<ApplicationProfile />} />
      </Routes>
    </div>
  );
}

/** Retain the actual shared provider for filters and return navigation. */
function mount(entry = '/readiness?domain=d1&hierarchyNodeId=h1') {
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
    if (url.includes('/applications/')) return response({ id: 'a/1', label: 'Exact application', source: 'uploaded', sourceRef: 'app-file', categories: {} });
    if (url.includes('/readiness/evidence')) return response([release], { page: { total: 1, nextCursor: null } });
    if (url.includes('/readiness/metrics')) {
      const family = query.get('family');
      const period = query.get('period');
      return response(names[family].map((label, index) => ({ id: `${family}-${index}`, label, family, period, value: period === 'week' || label === 'environment readiness %' ? null : 97.1234, unit: '%', availability: period === 'week' || label === 'environment readiness %' ? 'unavailable' : 'available', source: 'uploaded', sourceRef: period === 'week' ? null : 'metrics-file' })));
    }
    return response([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('renders five safe source categories and exact app drilldown with return context', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  await screen.findByRole('link', { name: 'Uploaded release' });
  for (const key of ['Build', 'Test', 'Security', 'Change', 'Environment']) expect(screen.getByRole('region', { name: `${key} evidence` })).toBeInTheDocument();
  const build = within(screen.getByRole('region', { name: 'Build evidence' }));
  expect(build.getByText('Association: entity:r/1.build')).toBeInTheDocument();
  expect(build.getByText('Source: uploaded · status-file')).toBeInTheDocument();
  expect(build.getByText('Period: month')).toBeInTheDocument();
  expect(build.getByText('<img onerror=alert(1)>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Environment evidence' })).getByRole('status')).toHaveTextContent('Unavailable');
  await user.click(screen.getByRole('link', { name: 'Uploaded release' }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('releaseId=r%2F1');
  await user.click(await screen.findByRole('link', { name: 'Open application · Exact application' }));
  expect(await screen.findByRole('heading', { name: 'Exact application', level: 1 })).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  await screen.findByRole('link', { name: 'Uploaded release' });
  expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('hierarchyNodeId=h1');
  expect(screen.getByLabelText('URL')).toHaveTextContent('releaseId=r%2F1');
});

it('navigates separate family pages and preserves exact period and source precision', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  for (const [family, link] of [['release', 'DevSecOps metrics'], ['qe', 'QE / environment'], ['security', 'Security posture']]) {
    await user.click(screen.getByRole('link', { name: link, exact: true }));
    await screen.findByRole('article', { name: names[family][0] });
    expect(screen.getAllByRole('article')).toHaveLength(names[family].length);
    for (const label of names[family]) expect(screen.getByRole('article', { name: label, exact: true })).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: names[family][0], exact: true })).getByText('97.12%')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Reporting period'), 'week');
    await waitFor(() => expect(screen.getAllByText('Unavailable', { exact: true })).toHaveLength(names[family].length));
    expect(screen.getByLabelText('URL')).toHaveTextContent('period=week');
    expect(screen.getByLabelText('URL')).toHaveTextContent('domain=d1');
    await user.selectOptions(screen.getByLabelText('Reporting period'), 'month');
    await screen.findAllByText('97.12%');
  }
});

it('keeps empty unsupported scope empty and displays a retryable evidence error', async () => {
  const user = userEvent.setup();
  fetch.mockImplementation(async () => ({ ok: false, json: async () => ({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Release and application mismatch.' } }) }));
  mount('/readiness?applicationId=a2&releaseId=r1');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Release and application mismatch.');
  fetch.mockImplementation(async () => response([], { availability: 'unavailable', unavailableDimensions: ['toolSource'] }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/No associated releases in this scope/)).toBeInTheDocument();
  expect(screen.getByText('Unavailable dimensions: toolSource')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open application/ })).not.toBeInTheDocument();
});

it('shows metric loading, failure, retry and no-result without fabricated cards', async () => {
  const user = userEvent.setup();
  let resolve;
  fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  mount('/readiness/security');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  resolve({ ok: false, json: async () => ({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Security evidence unavailable.' } }) });
  expect(await screen.findByRole('alert')).toHaveTextContent('Security evidence unavailable.');
  fetch.mockImplementation(async () => response([], { availability: 'unavailable' }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No measures in this scope. Selected filters are retained.')).toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});

it('does not fetch or widen contradictory application context', async () => {
  const user = userEvent.setup();
  mount('/readiness/release?application=a2&applicationId=a1');
  await user.click(screen.getByRole('button', { name: 'Select persona' }));
  expect(await screen.findByText('No measures in this scope. Selected filters are retained.')).toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
