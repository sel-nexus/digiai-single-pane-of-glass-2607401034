/** Display the exact Application 360 identity and eleven evidence categories. */
import { Link, useLocation, useParams } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import EvidencePanel from './EvidencePanel';

export const APPLICATION_CATEGORIES = {
  ownership: 'Ownership', domainPortfolio: 'Domain / portfolio', criticality: 'Criticality',
  health: 'Health', incidents: 'Incidents', releaseHistory: 'Release history', defects: 'Defects',
  securityPosture: 'Security posture', dependencies: 'Dependencies',
  automationMaturity: 'Automation maturity', observabilityCoverage: 'Observability coverage',
};

/** Reject external or malformed origins while retaining internal URL context.
 * @param {string} origin Previous application-local path and query string.
 * @returns {boolean} Whether the origin is safe for internal return navigation.
 */
function safeOrigin(origin) {
  return typeof origin === 'string' && /^\/(?!\/)[^\\\r\n]*$/.test(origin);
}

/** Fetch only the selected opaque application ID under the shared view scope. */
export default function ApplicationProfile() {
  const { applicationId } = useParams();
  const { context } = useSharedContext();
  const location = useLocation();
  const state = useApi(context.personaId ? `/applications/${encodeURIComponent(applicationId)}` : null, context);
  const origin = location.state?.origin || new URLSearchParams(location.search).get('returnTo');
  const returnTo = safeOrigin(origin) ? origin : `/portfolio?${serializeContext(context)}`;
  if (!context.personaId) return <PersonaSelector />;
  const profile = state.data?.id === applicationId ? state.data : null;
  return (
    <div className="application-profile">
      <p className="eyebrow">Application 360</p>
      <Link to={returnTo}>Return to previous view</Link>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {!!state.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
        )}
        {profile ? (
          <>
            <header className="application-heading">
              <h1>{profile.label}</h1>
              <p>{profile.id}</p>
              <p className="source-ref">Source: {profile.source} · {profile.sourceRef || 'Reference unavailable'}</p>
              <p className="muted">Supplied evidence only. No derived health, readiness gate, or inferred dependencies.</p>
            </header>
            <div className="application-evidence">
              {Object.entries(APPLICATION_CATEGORIES).map(([key, title]) => (
                <EvidencePanel key={key} title={title} category={profile.categories?.[key]} />
              ))}
            </div>
          </>
        ) : (
          <section className="data-state">
            <h1>Application unavailable in this scope</h1>
            <p>No matching profile. Selected filters are retained; no other application is substituted.</p>
          </section>
        )}
      </DataState>
    </div>
  );
}
