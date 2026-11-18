/** Own cancellable reads and suppress all prior-generation results. */
import { useEffect, useRef, useState } from 'react';
import { getJson } from '../services/apiClient';

/** Clear data immediately on key changes, even before the new effect runs. */
export function useApi(path, context = {}, extra = {}) {
  const key = JSON.stringify([path, context, extra]);
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ key: null, data: null, loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setState({ key, data: null, loading: Boolean(path), error: null });
    if (path) {
      getJson(path, context, extra, controller.signal).then((response) => {
        if (!controller.signal.aborted && current === generation.current) setState({ key, data: response.data, envelope: response, loading: false, error: null });
      }).catch((error) => {
        if (!controller.signal.aborted && current === generation.current) setState({ key, data: null, loading: false, error });
      });
    }
    return () => controller.abort();
  }, [key, retry]);
  const visible = state.key === key ? state : { data: null, loading: Boolean(path), error: null };
  return { ...visible, refetch: () => setRetry((value) => value + 1) };
}
