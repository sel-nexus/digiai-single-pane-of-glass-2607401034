/** Present implemented hierarchy and exact selected search-record information. */
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { HierarchyExplorer } from '../../components/shell/HierarchyExplorer';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { DataState } from '../../components/shared/DataState';
import { serializeContext } from '../../services/apiClient';

/** Display exact source identity and link represented application profiles. */
function SelectedEntity() {
  const { context } = useSharedContext();
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('entityId') || context.hierarchyNodeId;
  const state = useApi(id ? '/entities' : null, context, { q: id, limit: 100 });
  if (!id) return null;
  const entity = state.data?.find((item) => item.id === id);
  return (
    <section className="selected-entity" aria-label="Selected entity">
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {entity ? (
          <div>
            <h2>{entity.label}</h2>
            <p>{entity.type} · {entity.id}</p>
            <p className="muted">{entity.distinguishingInfo} · Source: {entity.source} · {entity.sourceRef}</p>
            {entity.type === 'application' ? (
              <Link to={`/applications/${encodeURIComponent(entity.id)}?${serializeContext(context, { returnTo: `${location.pathname}${location.search}` })}`}
                state={{ origin: `${location.pathname}${location.search}` }}>
                Open Application 360 · {entity.label}
              </Link>
            ) : <p>Source identity only. No dedicated profile for this entity type.</p>}
          </div>
        ) : <p role="status">Selected entity unavailable in this scope. No unfiltered details are shown.</p>}
      </DataState>
      {location.state?.origin && <Link to={location.state.origin}>Return to previous view</Link>}
    </section>
  );
}

/** Require explicit persona selection before displaying enterprise discovery. */
export default function PortfolioExplorer() {
  const { context } = useSharedContext();
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="portfolio-explorer">
      <h1>Portfolio explorer</h1>
      <SelectedEntity />
      <HierarchyExplorer />
    </div>
  );
}
