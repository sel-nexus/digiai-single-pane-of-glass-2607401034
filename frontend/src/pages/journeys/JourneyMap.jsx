/** Compose exact journey identity and independently qualified overlays. */
import { Link, useLocation, useParams } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import RelationshipOverlay from './RelationshipOverlay';

/** Keep overlay selection shareable and return to the retained origin snapshot. */
export default function JourneyMap() {
  const { journeyId } = useParams();
  const { context } = useSharedContext();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const kind = query.get('overlay') === 'impact' ? 'impact' : 'depends_on';
  const cursor = query.get('journeyCursor');
  const state = useApi(context.personaId ? `/journeys/${encodeURIComponent(journeyId)}` : null, context);
  const journey = state.data;
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="journey-page">
      <nav className="ancestor-links" aria-label="Journey context">
        <Link to={`/journeys?${serializeContext(context, { journeyCursor: cursor })}`}>All journeys</Link>
        {location.state?.origin && (
          <Link to={location.state.origin} state={location.state.originState}>Return to previous view</Link>
        )}
      </nav>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {!journey ? (
          <div role="status">
            <h1>Journey unavailable in this scope</h1>
            <p>No unfiltered identity or relationships are shown. Filters and hierarchy are retained.</p>
            {!!state.envelope?.unavailableDimensions?.length && (
              <p>Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
            )}
          </div>
        ) : (
          <div>
            <h1>{journey.label}</h1>
            {journey.description && <p className="intro">{journey.description}</p>}
            <p className="source-ref">{journey.id} · Source: {journey.source} · {journey.sourceRef || 'Reference unavailable'}</p>
            <section className="journey-impact" aria-label="Business impact">
              <h2>Supplied business impact</h2>
              <p>{journey.impact?.availability === 'available' ? journey.impact.value : 'Business impact unavailable.'}</p>
            </section>
            <nav className="ancestor-links" aria-label="Relationship overlays">
              {['depends_on', 'impact'].map((overlay) => (
                <Link key={overlay}
                  to={`?${serializeContext(context, { overlay, journeyCursor: cursor })}`}
                  state={location.state} aria-current={kind === overlay ? 'page' : undefined}>
                  {overlay === 'depends_on' ? 'Dependency overlay' : 'Impact overlay'}
                </Link>
              ))}
            </nav>
            <RelationshipOverlay kind={kind} overlay={kind === 'depends_on' ? journey.dependency : journey.impactOverlay} />
          </div>
        )}
      </DataState>
    </div>
  );
}
