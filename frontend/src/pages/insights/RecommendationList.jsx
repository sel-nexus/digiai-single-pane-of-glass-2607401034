/** Present source-only mock explanations and reusable application-specific recommendations. */
import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';

/** Render only backend-supported destinations with a saved return-scope snapshot. */
export function InsightLinks({
  associations = []
}) {
  const {
    context
  } = useSharedContext();
  const location = useLocation();
  const origin = `${location.pathname}${location.search}`;
  const links = associations.filter(link => link.sourceRef && (
    link.entityType === 'application' &&
      link.destination === `/applications/${encodeURIComponent(link.entityId)}` ||
    link.entityType === 'journey' &&
      link.destination === `/journeys/${encodeURIComponent(link.entityId)}` ||
    link.entityType === 'portfolio' &&
      link.destination === `/portfolio?${new URLSearchParams({
        entityId: link.entityId
      })}`
  ));
  if (!links.length) return <p
    className="muted"
  >
    Related destinations unavailable.
  </p>;
  return <ul
    className="ancestor-links"
    aria-label="Explicit destinations"
  >
    {links.map(link => <li
      key={link.id}
    >
      <Link
        to={`${link.destination}${link.destination.includes('?') ? '&' : '?'}${serializeContext(context, {
          returnTo: origin
        })}`}
        state={{
          origin,
          originState: location.state
        }}
      >
        Open
        {' '}
        {link.entityType}
        {' '}
        ·
        {' '}
        {link.label}
      </Link>
      <p
        className="source-ref"
      >
        Association:
        {' '}
        {link.id}
        {' '}
        ·
        {' '}
        {link.source}
        {' '}
        ·
        {' '}
        {link.sourceRef}
      </p>
    </li>)}
  </ul>;
}
InsightLinks.propTypes = {
  associations: PropTypes.arrayOf(PropTypes.object)
};

/** Fetch only records explicitly associated with the supplied application on detail pages. */
export function ContextualRecommendations({
  applicationId
}) {
  return <RecommendationList
    applicationId={applicationId}
    contextual
  />;
}
ContextualRecommendations.propTypes = {
  applicationId: PropTypes.string.isRequired
};

/** Keep reason/confidence and incomplete state tied to stable individual record IDs. */
export default function RecommendationList({
  applicationId = null,
  contextual = false
}) {
  const {
    context
  } = useSharedContext();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const cursor = contextual ? null : query.get('cursor');
  const app = applicationId || (contextual ? null : query.get('applicationId'));
  const state = useApi(context.personaId && (!contextual || app) ? '/recommendations' : null, context, {
    applicationId: app,
    limit: 20,
    cursor
  });
  if (!context.personaId) return contextual ? null : <PersonaSelector />;
  const items = Array.isArray(state.data)
    ? state.data.filter(item => !contextual || item.associations?.some(
      link => link.entityType === 'application' && link.entityId === app && link.sourceRef
    ))
    : [];
  return <section
    className="section-stack"
    aria-label={contextual ? 'Contextual recommendations' : 'Recommendations'}
  >
    <header>
      {contextual ? <h2>
        Contextual mock recommendations
      </h2> : <h1>
        Mock recommendations
      </h1>}
      <p
        className="muted"
      >
        Supplied sample/local/uploaded explanations only. No live AI, confidence scale, or remediation execution.
      </p>
      {!contextual && <Link
        to={`/insights/transformation?${serializeContext(context)}`}
      >
        Transformation evidence
      </Link>}
    </header>
    <DataState
      loading={state.loading}
      error={state.error}
      onRetry={state.refetch}
    >
      {!!state.envelope?.unavailableDimensions?.length && <p
        role="status"
      >
        Unavailable dimensions:
        {' '}
        {state.envelope.unavailableDimensions.join(', ')}
      </p>}
      {!items.length && <p
        role="status"
      >
        No associated recommendations in this scope. Filters are retained.
      </p>}
      <ul
        className="entity-list"
        aria-label="Recommendation records"
      >
        {items.map(item => {
          const reason = typeof item.reason === 'string' && item.reason.trim() ? item.reason : null;
          const confidence =
            typeof item.confidence === 'string' && item.confidence.trim() ||
            typeof item.confidence === 'number' && Number.isFinite(item.confidence);
          const complete = item.complete && item.availability === 'available' && reason && confidence;
          return <li
            key={item.id}
          >
            <article
              aria-label={item.label}
            >
              <h3>
                {item.label}
              </h3>
              <p
                role="status"
              >
                {complete ? 'Complete mock recommendation' : 'Incomplete · unavailable'}
              </p>
              <p>
                Reason:
                {' '}
                {reason || 'Unavailable'}
              </p>
              <p>
                Confidence:
                {' '}
                {confidence ? item.confidence : 'Unavailable'}
              </p>
              <p
                className="source-ref"
              >
                {item.id}
                {' '}
                · Source:
                {' '}
                {item.source}
                {' '}
                ·
                {' '}
                {item.sourceRef || 'Reference unavailable'}
              </p>
              <InsightLinks
                associations={item.associations}
              />
            </article>
          </li>;
        })}
      </ul>
      {state.envelope?.page?.nextCursor && <Link
        to={contextual ? `/insights?${serializeContext(context, {
          applicationId: app
        })}` : {
          search: serializeContext(context, {
            applicationId: app,
            cursor: state.envelope.page.nextCursor
          })
        }}
      >
        {contextual ? 'All recommendations for this application' : 'Next recommendations'}
      </Link>}
      {cursor && <Link
        to={{
          search: serializeContext(context, {
            applicationId: app
          })
        }}
      >
        First recommendations
      </Link>}
    </DataState>
  </section>;
}
RecommendationList.propTypes = {
  applicationId: PropTypes.string,
  contextual: PropTypes.bool
};
