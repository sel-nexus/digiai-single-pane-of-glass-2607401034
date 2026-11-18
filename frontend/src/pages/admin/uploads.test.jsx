/** Verify explicit uploads using real mapping and network-envelope adapters. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SharedContextProvider, useSharedContext } from '../../context/SharedContextProvider';
import UploadForm, { DATASET_CLASSES } from './UploadForm';
import { buildMapping } from './MappingEditor';

function Harness() {
  const { setPersona, context } = useSharedContext();
  return (
    <>
      <button onClick={() => setPersona('administrator')}>Select test persona</button>
      {context.personaId && <UploadForm />}
    </>
  );
}
const accepted = { data: { outcome: 'success', acceptedRows: 1, datasetVersion: 'up-123', reflection: { status: 'confirmed', views: ['applications'] } }, availability: 'available' };
function response(status, body) { return { ok: status < 400, status, json: async () => body }; }
async function mount() {
  render(
    <MemoryRouter initialEntries={['/admin/uploads']}>
      <SharedContextProvider>
        <Harness />
      </SharedContextProvider>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Select test persona' }));
}
async function draft(datasetClass = 'master') {
  await userEvent.selectOptions(screen.getByLabelText('Dataset class *'), datasetClass);
  await userEvent.upload(screen.getByLabelText('CSV or XLSX file *'), new File(['Identifier,Name,Kind\na,A,application'], 'demo.csv', { type: 'text/csv' }));
  for (const [field, header] of [['id', 'Identifier'], ['type', 'Kind'], ['label', 'Name']]) await userEvent.type(screen.getByLabelText(`Source column for ${field} *`), header);
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => response(201, accepted))));
afterEach(() => vi.unstubAllGlobals());

it('renders eleven exact choices without selection or automatic upload', async () => {
  await mount();
  expect(screen.getByLabelText('Dataset class *')).toHaveValue('');
  expect(screen.getAllByRole('option').map((node) => node.value)).toEqual(expect.arrayContaining(DATASET_CLASSES));
  expect(fetch).not.toHaveBeenCalled();
});
it.each(DATASET_CLASSES)('explicitly submits %s with dynamic headers and actor', async (datasetClass) => {
  await mount();
  await draft(datasetClass);
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(await screen.findByRole('heading', { name: 'Upload confirmed' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('up-123');
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/v1/admin/uploads');
  expect(options.headers).toBeUndefined();
  expect(options.body.get('datasetClass')).toBe(datasetClass);
  expect(JSON.parse(options.body.get('mapping'))).toEqual({ recordKind: 'entity', columns: { Identifier: 'id', Kind: 'type', Name: 'label' } });
  expect(JSON.parse(options.body.get('actor'))).toEqual({ personaId: 'administrator' });
});
it('blocks missing choices/mapping and duplicate assignments before request', async () => {
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a dataset class');
  await userEvent.selectOptions(screen.getByLabelText('Dataset class *'), 'master');
  await userEvent.upload(screen.getByLabelText('CSV or XLSX file *'), new File(['data'], 'a.csv', { type: 'text/csv' }));
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Assign every required field');
  expect(fetch).not.toHaveBeenCalled();
  expect(() => buildMapping('entity', { id: 'same', type: 'same', label: 'Name' })).toThrow('different source column');
});
it('changes record kind to relationship and metric fields', async () => {
  await mount();
  await userEvent.selectOptions(screen.getByLabelText('Mapped record kind'), 'relationship');
  expect(screen.getByLabelText('Source column for sourceEntityId *')).toBeInTheDocument();
  expect(screen.queryByLabelText('Source column for label *')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Mapped record kind'), 'metric');
  expect(screen.getByLabelText('Source column for family *')).toBeInTheDocument();
  expect(screen.getByLabelText('Source column for value')).toBeInTheDocument();
});
it('shows pending validation and disables double submission', async () => {
  let resolve;
  fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await mount(); await draft();
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(screen.getByRole('button', { name: 'Validating and committing…' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Validating the full batch');
  resolve(response(201, accepted));
  await screen.findByRole('heading', { name: 'Upload confirmed' });
});
it.each([400, 413, 415, 422])('renders actionable %s errors as safe text', async (status) => {
  fetch.mockResolvedValue(response(status, { error: { code: 'UPLOAD_REJECTED', message: 'Correct file', details: { issues: [{ row: 2, field: 'id', message: '<script>Duplicate</script>' }] } } }));
  await mount(); await draft();
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Row 2 · id: <script>Duplicate</script>');
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByRole('button', { name: 'Validate and upload' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('distinguishes a known not-committed 503', async () => {
  fetch.mockResolvedValue(response(503, { error: { code: 'STORAGE_UNAVAILABLE', message: 'Nothing accepted', details: { commitStatus: 'not_committed' } } }));
  await mount(); await draft();
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing accepted');
  expect(screen.queryByText('Upload completion unconfirmed')).not.toBeInTheDocument();
});
it.each(['network', '503', 'invalid-json', 'bad-confirmation'])('locks %s ambiguity without retries', async (mode) => {
  if (mode === 'network') fetch.mockRejectedValue(new TypeError('offline'));
  if (mode === '503') fetch.mockResolvedValue(response(503, { data: { outcome: 'unconfirmed' }, availability: 'unavailable' }));
  if (mode === 'invalid-json') fetch.mockResolvedValue({ ok: true, status: 201, json: async () => { throw new SyntaxError(); } });
  if (mode === 'bad-confirmation') fetch.mockResolvedValue(response(201, { data: {}, availability: 'available' }));
  await mount(); await draft();
  await userEvent.click(screen.getByRole('button', { name: 'Validate and upload' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume rollback');
  expect(screen.getByRole('button', { name: 'Validate and upload' })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'I checked the outcome; unlock a new attempt' }));
  expect(screen.getByRole('button', { name: 'Validate and upload' })).toBeEnabled();
});
