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
