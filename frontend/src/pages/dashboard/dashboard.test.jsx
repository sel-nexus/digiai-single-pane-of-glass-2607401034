/** Exercise explicit persona selection, cancellation and meaningful read states. */
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { formatMetric } from './KpiBoard';

const personas = [{ id: 'executive', label: 'Executive', description: 'Enterprise outcomes' }, { id: 'engineering', label: 'Engineering', description: 'Engineering evidence' }];
const metric = { id: 'availability', label: 'Availability %', family: 'enterprise', value: 99.23456, unit: '%', period: 'month', availability: 'available', source: 'sample', sourceRef: 'test-source' };

/** Mock only the network boundary while exercising the real client and components. */
function respond(url) {
  const parsed = new URL(url, 'http://test');
  let data;
  if (parsed.pathname.endsWith('/personas')) data = personas;
  else if (parsed.pathname.endsWith('/dashboard')) {
    const persona = personas.find((p) => p.id === parsed.searchParams.get('personaId'));
    const m = persona.id === 'engineering' ? { ...metric, id: 'pipeline', label: 'Pipeline success', value: 97.1234 } : metric;
    data = { persona, widgets: [{ id: m.id, title: m.label, metric: m }], scenarios: [{ id: 'scenario', label: 'Enrollment context', description: 'Supplied journey', destination: '/journeys/journey-enrollment' }] };
  } else if (parsed.pathname.endsWith('/journeys/journey-enrollment')) {
    data = {
      id: 'journey-enrollment', label: 'Enrollment', type: 'journey',
      description: 'Supplied enrollment journey', source: 'sample', sourceRef: 'journey-map',
      relationships: [],
      dependency: { availability: 'unavailable', value: [] },
      impactOverlay: { availability: 'unavailable', value: [] },
      impact: { availability: 'unavailable', value: null },
    };
  } else data = [{ ...metric, value: parsed.searchParams.get('period') === 'week' ? null : metric.value, availability: parsed.searchParams.get('period') === 'week' ? 'unavailable' : 'available' }];
  return Promise.resolve(new Response(JSON.stringify({ data, availability: 'available' })));
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  document.documentElement.dataset.theme = 'light';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal('fetch', vi.fn(respond));
});

it('starts unselected even with persona in URL and selects only after click', async () => {
  window.history.replaceState({}, '', '/?personaId=executive');
  render(<App />);
  expect(screen.queryByRole('heading', { name: 'Executive perspective' })).not.toBeInTheDocument();
  await userEvent.setup().click(await screen.findByRole('button', { name: /Executive/ }));
  expect(await screen.findByRole('heading', { name: 'Executive perspective' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Persona widgets' })).getByText('99.23%')).toBeInTheDocument();
});

it('cancel preserves persona and confirm switches to isolated widget evidence', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /Executive/ }));
  await screen.findByRole('heading', { name: 'Executive perspective' });
  await user.click(screen.getByRole('button', { name: 'Switch persona' }));
  await user.selectOptions(await screen.findByLabelText('New persona'), 'engineering');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Executive perspective' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Switch persona' }));
  expect(screen.getByRole('button', { name: 'Confirm switch' })).toBeDisabled();
  await user.selectOptions(await screen.findByLabelText('New persona'), 'engineering');
  await user.click(screen.getByRole('button', { name: 'Confirm switch' }));
  await screen.findByRole('heading', { name: 'Engineering perspective' });
  const overview = screen.getByRole('region', { name: 'Persona widgets' });
  expect(within(overview).getByText('97.12%')).toBeInTheDocument();
  expect(within(overview).queryByText('99.23%')).not.toBeInTheDocument();
});

it('changes exact period and follows supplied scenario then returns through links', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /Executive/ }));
  await user.selectOptions(await screen.findByLabelText('Reporting period'), 'week');
  expect(await within(screen.getByRole('region', { name: 'KPI evidence' })).findByText('Unavailable')).toBeInTheDocument();
  expect(window.location.search).toContain('period=week');
  await user.click(screen.getByRole('link', { name: 'View journey context →' }));
  expect(await screen.findByRole('heading', { name: 'Enrollment', exact: true })).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Return to previous view' }));
  expect(await screen.findByRole('heading', { name: 'Executive perspective' })).toBeInTheDocument();
  expect(screen.getByLabelText('Reporting period')).toHaveValue('week');
});

it('shows loading instead of auto selection while catalog is pending', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  render(<App />);
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Executive/ })).not.toBeInTheDocument();
});

it('shows empty catalog and no fabricated persona', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], availability: 'unavailable' }))));
  render(<App />);
  expect(await screen.findByText('No configured evidence for this view.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Executive/ })).not.toBeInTheDocument();
});

it('shows read failure and recovers only after explicit retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementation(respond));
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach prototype service');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: /Executive/ })).toBeInTheDocument();
});

it('keeps theme independent of persona and formats zero and missing values faithfully', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Use dark theme' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('digiai-theme')).toBe('dark');
  expect(formatMetric({ ...metric, value: 0 })).toBe('0.00%');
  expect(formatMetric({ ...metric, value: null })).toBe('Unavailable');
  expect(formatMetric({ ...metric, value: 12.345, unit: 'hours' })).toBe('12.345 hours');
});

it('renders distinct same-name text evidence with separate source references', async () => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (new URL(url, 'http://test').pathname.endsWith('/kpis')) {
      return Promise.resolve(new Response(JSON.stringify({ data: [
        { ...metric, id: 'app-a', value: '99.2345600000000000001', source: 'uploaded', sourceRef: 'csv-source-a' },
        { ...metric, id: 'app-b', value: '87.9950000000000000001', source: 'local', sourceRef: 'xlsx-source-b' },
      ], availability: 'available' })));
    }
    return respond(url);
  }));
  render(<App />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Executive/ }));
  const board = within(await screen.findByRole('region', { name: 'KPI evidence' }));
  expect(await board.findByText('88.00%')).toBeInTheDocument();
  expect(board.getByText('99.23%')).toBeInTheDocument();
  expect(board.getByText('Source: csv-source-a')).toBeInTheDocument();
  expect(board.getByText('Source: xlsx-source-b')).toBeInTheDocument();
  expect(board.getAllByRole('article', { name: 'Availability %' })).toHaveLength(2);
});

it('keeps supplied widget provenance and qualified gauge in the persona overview', async () => {
  render(<App />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Executive/ }));
  const overview = within(await screen.findByRole('region', { name: 'Persona widgets' }));
  const card = within(overview.getByRole('article', { name: 'Availability %' }));
  expect(card.getByText('99.23%')).toBeInTheDocument();
  expect(card.getByText('Supplied value: 99.23456%')).toBeInTheDocument();
  expect(card.getByText('month · sample')).toBeInTheDocument();
  expect(card.getByText('Source: test-source')).toBeInTheDocument();
  expect(card.getByRole('img', { name: /supplied 99.23456% on a 0–100% scale/ })).toHaveAccessibleDescription(/not a score, target, trend or inferred health/);
});

it('shows an empty overview and unavailable scope without inventing widgets or scenarios', async () => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (new URL(url, 'http://test').pathname.endsWith('/dashboard')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { persona: personas[0], widgets: [], scenarios: [] },
        availability: 'available', unavailableDimensions: ['domain'],
      })));
    }
    return respond(url);
  }));
  render(<App />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Executive/ }));
  const overview = within(await screen.findByRole('region', { name: 'Persona widgets' }));
  expect(overview.getByText('Selected scope unavailable for supplied KPIs: domain')).toBeInTheDocument();
  expect(overview.getByText('No visible widgets configured for this persona.')).toBeInTheDocument();
  expect(overview.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByText('No scenarios configured.')).toBeInTheDocument();
});

it('holds dashboard evidence while loading and recovers from a dashboard read failure', async () => {
  let rejectDashboard;
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (new URL(url, 'http://test').pathname.endsWith('/dashboard') && attempts++ === 0) {
      return new Promise((resolve, reject) => { rejectDashboard = reject; });
    }
    return respond(url);
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /Executive/ }));
  expect(screen.getByText('Loading prototype evidence…')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Persona widgets' })).not.toBeInTheDocument();
  rejectDashboard(new TypeError('offline'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach prototype service');
  expect(screen.queryByRole('region', { name: 'Persona widgets' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  const overview = within(await screen.findByRole('region', { name: 'Persona widgets' }));
  expect(overview.getByText('99.23%')).toBeInTheDocument();
  expect(overview.getByText('Source: test-source')).toBeInTheDocument();
});
