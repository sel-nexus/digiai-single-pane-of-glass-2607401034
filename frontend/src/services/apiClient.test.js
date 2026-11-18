/** Verify transport envelope validation and ambiguous write classifications. */
import { expect, it, vi } from 'vitest';
import { getJson, postJson, serializeContext } from './apiClient';

it('serializes repeated opaque values without splitting commas', () => {
  const query = new URLSearchParams(serializeContext({ personaId: 'executive', filters: { domain: ['a,b', 'c'] } }));
  expect(query.getAll('domain')).toEqual(['a,b', 'c']);
});
it('returns validated data and retains zero', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [0], availability: 'available' }))));
  expect((await getJson('/kpis')).data).toEqual([0]);
});
it('rejects invalid success envelopes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(getJson('/kpis')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('preserves actionable read problems', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MISSING', message: 'Not represented', details: {} } }), { status: 404 })));
  await expect(getJson('/dashboard')).rejects.toMatchObject({ code: 'MISSING', message: 'Not represented' });
});
it('classifies lost writes as unconfirmed and never retries', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Connection lost'));
  vi.stubGlobal('fetch', fetch);
  await expect(postJson('/admin/kpis', {})).rejects.toMatchObject({ code: 'UNCONFIRMED' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('classifies invalid write JSON and server errors as unconfirmed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('invalid')).mockResolvedValueOnce(new Response('{}', { status: 503 })));
  await expect(postJson('/admin/kpis', {})).rejects.toMatchObject({ code: 'UNCONFIRMED' });
  await expect(postJson('/admin/kpis', {})).rejects.toMatchObject({ code: 'UNCONFIRMED' });
});
it('preserves cancellation and classifies read network loss', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new DOMException('Aborted', 'AbortError')).mockRejectedValueOnce(new TypeError('Offline')));
  await expect(getJson('/personas')).rejects.toMatchObject({ name: 'AbortError' });
  await expect(getJson('/personas')).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
});
