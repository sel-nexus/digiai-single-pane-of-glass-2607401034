/** Verify explicit admin interactions using the real client and network-boundary stubs. */
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import DashboardPage from '../dashboard/DashboardPage';
import KpiConfig from './KpiConfig';

const personas = [{ id: 'executive', label: 'Executive' }, { id: 'operations', label: 'Operations' }, { id: 'administrator', label: 'Administrator' }];
let catalog, writes, behavior, events;
const metric = { id: 'availability', label: 'Availability %', family: 'enterprise', value: 99.23456, unit: '%', period: 'month', availability: 'available', source: 'sample', sourceRef: 'sample' };
function json(data, extra = {}) {
  return new Response(JSON.stringify({ data, availability: 'available', ...extra }));
}
async function respond(url, options = {}) {
  const parsed = new URL(url, 'http://test');
  const path = parsed.pathname;
  if (options.method) {
    const body = JSON.parse(options.body);
    writes.push({ path, method: options.method, body });
    if (behavior === 'network') throw new TypeError('offline');
    if (behavior === 'unconfirmed') return json({ outcome: 'unconfirmed', saved: false, effectiveStatus: 'unconfirmed' });
    if (behavior === 'reject') return new Response(JSON.stringify({ error: { code: 'INVALID_CONFIG', message: 'Unknown supplied metric.', details: { issues: [{ field: 'metricId', message: 'Choose a known metric.' }] } } }), { status: 422 });
    if (path.endsWith('/kpis')) {
      catalog.metrics[0].label = body.label;
      catalog.widgets.forEach((widget) => { if (widget.id === body.metricId) widget.title = body.title; });
    } else if (path.endsWith('/scenarios')) catalog.scenarios[0] = { id: body.scenarioId, label: body.label, description: body.description, destination: body.destination };
    else if (options.method === 'PUT') {
      const segments = path.split('/');
      catalog.widgets.find((widget) => widget.personaId === segments.at(-3) && widget.id === segments.at(-1)).visible = body.visible;
    }
    events.push({ id: `event-${writes.length}`, eventType: options.method === 'PUT' ? 'override' : 'edit', targetType: 'config', targetId: 'demo-config', summary: 'Saved demo configuration', occurredAt: '2025-01-01T00:00:00+00:00', actor: body.actor, details: { config: body } });
    return json({ saved: true, outcome: 'success', effectiveStatus: 'confirmed' });
  }
  if (path.endsWith('/personas')) return json(personas);
  if (path.endsWith('/admin/config')) return json(catalog);
  if (path.endsWith('/admin/audit')) return json(events, { total: events.length });
  if (path.endsWith('/dashboard')) {
    const personaId = parsed.searchParams.get('personaId');
    return json({ persona: personas.find((p) => p.id === personaId), widgets: catalog.widgets.filter((w) => w.personaId === personaId && w.visible).map((w) => ({ ...w, metric: { ...metric, label: catalog.metrics[0].label } })), scenarios: catalog.scenarios });
  }
  if (path.endsWith('/filters/options')) return json({});
  return json([]);
}
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  writes = []; events = []; behavior = 'success';
  catalog = { personas, metrics: [{ metricId: 'availability', label: 'Availability %' }], widgets: [{ personaId: 'executive', id: 'availability', title: 'Availability %', visible: true }, { personaId: 'operations', id: 'availability', title: 'Availability %', visible: true }, { personaId: 'administrator', id: 'sdlc', title: 'SDLC', visible: true }], scenarios: [{ id: 'enrollment', label: 'Enrollment', description: 'Supplied context', destination: '/journeys/journey-enrollment' }], destinations: ['/operations', '/journeys/journey-enrollment'], relationships: [{ relationshipId: 'rel-0', sourceEntityId: 'journey-enrollment', targetEntityId: 'app-0001', type: 'depends_on' }] };
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal('fetch', vi.fn(respond));
});
async function enterAdmin(user) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /Administrator/ }));
  await user.click(await screen.findByRole('link', { name: 'Administration', exact: true }));
  await screen.findByLabelText('Supplied metric');
}
async function fillKpi(user) {
  await user.selectOptions(screen.getByLabelText('Supplied metric'), 'availability');
  await user.type(screen.getByLabelText('Metric display label'), 'Supplied uptime');
  await user.type(screen.getByLabelText('Overview display title'), 'Uptime overview');
}
it('renders inert forms and blocked controls, validates each field before save', async () => {
  const user = userEvent.setup();
  await enterAdmin(user);
  expect(writes).toEqual([]);
  for (const name of ['Snapshot export unavailable', 'Annotations unavailable', 'Export audit unavailable']) expect(screen.getByRole('button', { name })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(screen.getByLabelText('Supplied metric')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Metric display label')).toHaveAttribute('aria-describedby', 'label-error');
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('link', { name: 'Open dataset uploads and column mapping' }));
  expect(await screen.findByRole('heading', { name: 'Upload & mapping' })).toBeVisible();
});
it('confirmed KPI save survives catalog refetch, updates audit and persists on navigation', async () => {
  const user = userEvent.setup();
  await enterAdmin(user);
  await fillKpi(user);
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(await screen.findByText('KPI definition saved and confirmed.')).toBeVisible();
  expect(await screen.findByText('Saved label: Supplied uptime')).toBeVisible();
  expect(writes[0].body.actor.personaId).toBe('administrator');
  await user.click(screen.getByRole('link', { name: 'Dashboard', exact: true }));
  await screen.findByRole('heading', { name: 'Administrator perspective' });
  await user.click(screen.getByRole('link', { name: 'Administration', exact: true }));
  expect(await screen.findByRole('option', { name: 'Supplied uptime · availability' })).toBeVisible();
});
it('persona selection resets widget and saves only chosen visibility', async () => {
  const user = userEvent.setup();
  await enterAdmin(user);
  await user.selectOptions(screen.getByLabelText('Widget persona'), 'executive');
  await user.selectOptions(screen.getByLabelText('Existing widget'), 'availability');
  await user.selectOptions(screen.getByLabelText('Widget persona'), 'administrator');
  expect(screen.getByLabelText('Existing widget')).toHaveValue('');
  expect(within(screen.getByLabelText('Existing widget')).queryByRole('option', { name: 'Availability %' })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Widget persona'), 'executive');
  await user.selectOptions(screen.getByLabelText('Existing widget'), 'availability');
  await user.click(screen.getByLabelText('Visible on selected persona dashboard'));
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Save widget visibility' }));
  expect(await screen.findByText('Widget visibility saved and confirmed.')).toBeVisible();
  expect(writes[0].path).toBe('/api/v1/admin/personas/executive/widgets/availability');
  expect(catalog.widgets.find((w) => w.personaId === 'executive').visible).toBe(false);
  expect(catalog.widgets.find((w) => w.personaId === 'operations').visible).toBe(true);
});
it('scenario and relationship are explicit actions with bounded destinations', async () => {
  const user = userEvent.setup();
  await enterAdmin(user);
  await user.selectOptions(screen.getByLabelText('Existing scenario'), 'enrollment');
  await user.selectOptions(screen.getByLabelText('Available destination'), '/operations');
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Save scenario' }));
  expect(await screen.findByText('Scenario saved and confirmed.')).toBeVisible();
  await user.selectOptions(screen.getByLabelText('Existing relationship'), 'rel-0');
  await user.clear(screen.getByLabelText('Existing application or API ID'));
  await user.type(screen.getByLabelText('Existing application or API ID'), 'app-0002');
  await user.click(screen.getByRole('button', { name: 'Save explicit mapping' }));
  expect(await screen.findByText('Mapping saved and confirmed.')).toBeVisible();
  expect(writes[1].body.targetEntityId).toBe('app-0002');
});
it('known rejection associates server feedback and does not announce success', async () => {
  const user = userEvent.setup(); behavior = 'reject';
  await enterAdmin(user); await fillKpi(user);
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(await screen.findByText('Choose a known metric.')).toBeVisible();
  expect(screen.getByLabelText('Supplied metric')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('KPI definition saved and confirmed.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save KPI definition' })).toBeEnabled();
});
it.each(['network', 'unconfirmed'])('freezes %s ambiguous completion and never retries', async (failure) => {
  const user = userEvent.setup(); behavior = failure;
  await enterAdmin(user); await fillKpi(user);
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(await screen.findByText(/Do not assume rollback/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save KPI definition' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(writes).toHaveLength(1);
});
/** Keep dashboard mounted to prove immediate revision-driven refetch without navigation. */
function MountedViews() {
  const { context, setPersona } = useSharedContext();
  return (
    <>
      <button onClick={() => setPersona('executive')}>Choose executive</button>
      {context.personaId && <KpiConfig catalog={catalog} onSaved={() => {}} />}
      <DashboardPage />
    </>
  );
}
it('confirmed configuration invalidates an already mounted dashboard immediately', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <SharedContextProvider>
        <MountedViews />
      </SharedContextProvider>
    </MemoryRouter>
  );
  await user.click(screen.getByRole('button', { name: 'Choose executive' }));
  await screen.findByRole('heading', { name: 'Executive perspective' });
  await fillKpi(user);
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(await within(screen.getByRole('region', { name: 'Persona widgets' })).findByRole('heading', { name: 'Uptime overview' })).toBeVisible();
});

it('pending write disables repeat submission and retains visible progress', async () => {
  const user = userEvent.setup();
  await enterAdmin(user); await fillKpi(user);
  const original = respond;
  let resolveWrite;
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => options.method ? new Promise((resolve) => { resolveWrite = resolve; }) : original(url, options)));
  await user.click(screen.getByRole('button', { name: 'Save KPI definition' }));
  expect(await screen.findByText('Saving KPI definition…')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save KPI definition' })).toBeDisabled();
  resolveWrite(json({ saved: true, outcome: 'success', effectiveStatus: 'confirmed' }));
  expect(await screen.findByText('KPI definition saved and confirmed.')).toBeVisible();
});
it('audit filters apply only on explicit click and preserve documented fields', async () => {
  const user = userEvent.setup();
  await enterAdmin(user);
  await user.selectOptions(screen.getByLabelText('Audit event type'), 'override');
  await user.type(screen.getByLabelText('Audit target ID'), 'executive-availability');
  await user.type(screen.getByLabelText('Audit actor persona'), 'administrator');
  expect(fetch.mock.calls.some(([url]) => url.includes('target=executive-availability'))).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Apply audit filters' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('target=executive-availability') && url.includes('eventType=override') && url.includes('persona=administrator'))).toBe(true));
});
