/** Offer bounded represented journeys under retained enterprise scope. */
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';

/** Preserve list pagination, filters, hierarchy and origin through real links. */
export default function JourneyList() {
  const { context } = useSharedContext();
  const location = useLocation();
  const cursor = new URLSearchParams(location.search).get('journeyCursor');
  const state = useApi(context.personaId ? '/journeys' : null, context, { limit: 20, cursor });
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="journey-page">
      <h1>Business journeys</h1>
      <p className="intro muted">Select a represented journey to inspect supplied application and API associations.</p>
      {location.state?.origin && <Link to={location.state.origin}>Return to previous view</Link>}
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        <div aria-live="polite">
          {!!state.envelope?.unavailableDimensions?.length && (
            <p>Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
          )}
          {!state.data?.length && <p>No represented journeys in this scope. Filters are retained.</p>}
          <ul className="entity-list">
            {(state.data || []).map((journey) => (
              <li key={journey.id}>
                <Link to={`/journeys/${encodeURIComponent(journey.id)}?${serializeContext(context, { journeyCursor: cursor })}`}
                  state={{ origin: `${location.pathname}${location.search}`, originState: location.state }}>
                  {journey.label}
                </Link>
                <p className="source-ref">{journey.id} · Source: {journey.source} · {journey.sourceRef || 'Reference unavailable'}</p>
              </li>
            ))}
          </ul>
          <nav className="ancestor-links" aria-label="Journey pages">
            {state.envelope?.page?.nextCursor && (
              <Link to={`/journeys?${serializeContext(context, { journeyCursor: state.envelope.page.nextCursor })}`}
                state={location.state}>Next journeys</Link>
            )}
            {cursor && (
              <Link to={`/journeys?${serializeContext(context)}`} state={location.state}>First journeys</Link>
            )}
          </nav>
        </div>
      </DataState>
    </div>
  );
}
