/** Require explicit selection from the backend's approved persona catalog. */
import { useNavigate, useLocation } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useSharedContext } from '../../context/SharedContextProvider';
import { DataState } from '../shared/DataState';

/** Render catalog choices without selecting or persisting a persona on mount. */
export function PersonaSelector() {
  const catalog = useApi('/personas');
  const { setPersona } = useSharedContext();
  const navigate = useNavigate();
  const location = useLocation();
  const select = (id) => { setPersona(id); navigate(`/dashboard${location.search}`); };
  return (
    <section className="selection">
      <p className="eyebrow">Horizon BCBS · Enterprise prototype</p>
      <h1>A clearer view of enterprise evidence.</h1>
      <p className="intro">Choose your perspective to open the command center.</p>
      <p className="muted">Mock personas change the view, not access permissions. All evidence is synthetic; no live telemetry or PHI.</p>
      <DataState loading={catalog.loading} error={catalog.error} empty={!catalog.data?.length} onRetry={catalog.refetch}>
        <div className="persona-grid">
          {catalog.data?.map((persona) => (
            <button key={persona.id} className="persona-card" onClick={() => select(persona.id)}>
              <span className="persona-title">{persona.label}</span>
              <span className="muted">{persona.description}</span>
              <span className="persona-action">Open perspective →</span>
            </button>
          ))}
        </div>
      </DataState>
      <p className="selection-note">Sample / local evidence only · Prototype data is disposable in AWS deployments.</p>
    </section>
  );
}
