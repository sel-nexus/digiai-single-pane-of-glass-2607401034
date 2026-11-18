/** Verify stale-response suppression and clearing of prior persona evidence. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useApi } from './useApi';

it('discards late old requests even when the transport ignores abort', async () => {
  let resolveOld;
  let oldSignal;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce((url, options) => {
    oldSignal = options.signal;
    return new Promise((resolve) => { resolveOld = resolve; });
  }).mockResolvedValueOnce(new Response(JSON.stringify({ data: ['engineering'], availability: 'available' }))));
  const { result, rerender } = renderHook(({ personaId }) => useApi('/dashboard', { personaId }), { initialProps: { personaId: 'executive' } });
  rerender({ personaId: 'engineering' });
  expect(result.current.data).toBeNull();
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(result.current.data).toEqual(['engineering']));
  await act(async () => resolveOld(new Response(JSON.stringify({ data: ['executive'], availability: 'available' }))));
  expect(result.current.data).toEqual(['engineering']);
});
it('clears prior data on failed next context and supports explicit read retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: ['old'], availability: 'available' }))).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ data: ['new'], availability: 'available' }))));
  const { result, rerender } = renderHook(({ id }) => useApi('/dashboard', { personaId: id }), { initialProps: { id: 'executive' } });
  await waitFor(() => expect(result.current.data).toEqual(['old']));
  rerender({ id: 'engineering' });
  expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.error.code).toBe('READ_UNAVAILABLE'));
  expect(result.current.data).toBeNull();
  act(() => result.current.refetch());
  await waitFor(() => expect(result.current.data).toEqual(['new']));
});
