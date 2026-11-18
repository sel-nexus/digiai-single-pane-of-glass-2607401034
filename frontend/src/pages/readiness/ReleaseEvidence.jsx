/** Present exact release associations and five independently supplied status categories. */
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { serializeContext } from '../../services/apiClient';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import EvidencePanel from '../portfolio/EvidencePanel';
import { ContextualRecommendations } from '../insights/RecommendationList';

/** Render real readiness destinations while retaining application, release and filter context. */
export function ReadinessNavigation() {
  const location = useLocation();
  const destinations = { '/readiness': 'Release evidence', '/readiness/release': 'DevSecOps metrics',
    '/readiness/qe': 'QE / environment', '/readiness/security': 'Security posture' };
  return (
    <nav className="readiness-navigation" aria-label="Readiness families">
      {Object.entries(destinations).map(([path, label]) => (
        <Link key={path} to={`${path}${location.search}`} aria-current={location.pathname === path ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Show supplied release status without gate calculation or certification. */
export default function ReleaseEvidence() {
  const { context } = useSharedContext();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const applicationId = query.get('applicationId');
  const releaseId = query.get('releaseId');
  const period = query.get('period') || 'month';
  const cursor = query.get('cursor');
  const state = useApi(context.personaId ? '/readiness/evidence' : null, context,
    { applicationId, releaseId, period, cursor, limit: 20 });
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="section-stack">
      <header className="application-heading">
        <p className="eyebrow">Source release evidence</p>
        <h1>Release readiness evidence</h1>
        <p className="muted">Supplied status, period and source only. No computed gate, readiness score or certification.</p>
        <ReadinessNavigation />
      </header>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {!!state.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
        )}
        {!state.data?.length && <p role="status">No associated releases in this scope. Filters are retained; no other application is substituted.</p>}
        <ul className="entity-list" aria-label="Release records">
          {(state.data || []).map((release) => (
            <li key={`${release.id}-${release.application.id}`}>
              <Link to={`/readiness?${serializeContext(context, { applicationId: release.application.id, releaseId: release.id, period })}`}>
                {release.label}
              </Link>
              <p className="source-ref">{release.id} · {release.application.id} · {release.source} · {release.sourceRef || 'Reference unavailable'}</p>
              <Link to={`/applications/${encodeURIComponent(release.application.id)}?${serializeContext(context, { returnTo: `${location.pathname}${location.search}` })}`}
                state={{ origin: `${location.pathname}${location.search}` }}>
                Open application · {release.application.label}
              </Link>
              <div className="application-evidence">
                {['build', 'test', 'security', 'change', 'environment'].map((key) => (
                  <EvidencePanel key={key} title={`${key[0].toUpperCase()}${key.slice(1)} evidence`} category={release.categories[key]} />
                ))}
              </div>
              {releaseId === release.id && <ContextualRecommendations applicationId={release.application.id} />}
            </li>
          ))}
        </ul>
        {state.envelope?.page?.nextCursor && (
          <Link to={{ search: serializeContext(context, { applicationId, releaseId, period, cursor: state.envelope.page.nextCursor }) }}>Next releases</Link>
        )}
        {cursor && <Link to={{ search: serializeContext(context, { applicationId, releaseId, period }) }}>First releases</Link>}
      </DataState>
    </div>
  );
}
