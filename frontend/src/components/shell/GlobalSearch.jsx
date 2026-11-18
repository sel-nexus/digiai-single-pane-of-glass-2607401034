/** Search exact source entities only after explicit submission. */
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../shared/DataState';

/** Offer the nearest implemented destination without fabricating profiles. */
export function GlobalSearch() {
  const { context } = useSharedContext();
  const location = useLocation();
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const [cursor, setCursor] = useState(null);
  const state = useApi(submitted === null ? null : '/entities', context, { q: submitted, limit: 20, cursor });
  return (
    <section className="global-search" aria-label="Enterprise search">
      <form role="search" onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) { setSubmitted(draft.trim()); setCursor(null); }
      }}>
        <label htmlFor="enterprise-search">Search names or IDs</label>
        <div className="search-controls">
          <input id="enterprise-search" value={draft} maxLength={200}
            onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={!draft.trim()}>Search</button>
          <button type="button" onClick={() => { setDraft(''); setSubmitted(null); setCursor(null); }}>Clear search</button>
        </div>
      </form>
      {submitted !== null && (
        <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
          <div aria-live="polite">
            <p>Results for “{submitted}” ({state.envelope?.page?.total ?? 0})</p>
            {!!state.envelope?.unavailableDimensions?.length && (
              <p>Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
            )}
            {!state.data?.length && <p>No matching entities. Selected filters are retained.</p>}
            <ul className="entity-list">
              {(state.data || []).map((entity) => (
                <li key={entity.id}>
                  <Link to={`/portfolio?${serializeContext(context, { entityId: entity.id, q: entity.id })}`}
                    state={{ origin: `${location.pathname}${location.search}` }}>
                    {entity.label}
                  </Link>
                  <span className="muted"> {entity.type} · {entity.distinguishingInfo} · {entity.source}</span>
                </li>
              ))}
            </ul>
            {state.envelope?.page?.nextCursor && (
              <button onClick={() => setCursor(state.envelope.page.nextCursor)}>Next search results</button>
            )}
            {cursor && <button onClick={() => setCursor(null)}>First search results</button>}
          </div>
        </DataState>
      )}
    </section>
  );
}
