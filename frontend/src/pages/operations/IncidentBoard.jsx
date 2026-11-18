/** Select distinct supplied operational records and explicit business context. */
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { serializeContext } from '../../services/apiClient';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import EvidencePanel from '../portfolio/EvidencePanel';
import CorrelationView from './CorrelationView';

/** Keep selection, type and pagination shareable while retaining all shared filters. */
export default function IncidentBoard() {
  const { context } = useSharedContext();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const incidentId = query.get('incidentId');
  const recordType = query.get('recordType') || '';
  const cursor = query.get('cursor');
  const state = useApi(context.personaId ? '/operations/incidents' : null, context, { recordType, limit: 20, cursor });
  const detail = useApi(context.personaId && incidentId ? '/operations/incidents' : null, context, { incidentId });
  const selected = detail.data?.find((record) => record.id === incidentId);
  const changeType = (value) => {
    const next = new URLSearchParams(location.search);
    next.delete('cursor');
    next.delete('incidentId');
    if (value) next.set('recordType', value); else next.delete('recordType');
    navigate({ search: next.toString() });
  };
  if (!context.personaId) return <PersonaSelector />;
  const targets = [...new Map((selected?.businessContext?.value || []).map((item) => [item.value.id, item.value])).values()];
  return (
    <div className="section-stack">
      <header>
        <p className="eyebrow">Operations evidence</p>
        <h1>Incident command center</h1>
        <p className="muted">Incident, problem/RCA and major incident records are distinct. Co-presentation does not imply linkage.</p>
        <Link to={`/operations/reliability?${serializeContext(context)}`}>Review reliability</Link>
      </header>
      <div>
        <label htmlFor="record-type">Record type</label>
        <select id="record-type" value={recordType} onChange={(event) => changeType(event.target.value)}>
          <option value="">All operational records</option>
          <option value="incident">Incident</option>
          <option value="problem_rca">Problem / RCA</option>
          <option value="major_incident">Major incident</option>
        </select>
      </div>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {!!state.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
        )}
        {!state.data?.length && <p role="status">No operational records in this scope. Filters are retained.</p>}
        <ul className="entity-list" aria-label="Operational records">
          {(state.data || []).map((record) => {
            const next = new URLSearchParams(location.search);
            next.set('incidentId', record.id);
            return (
              <li key={record.id}>
                <Link to={{ search: next.toString() }} aria-current={incidentId === record.id ? 'true' : undefined}>{record.label}</Link>
                <p>{record.recordType} · {record.id}</p>
                <p className="source-ref">Source: {record.source} · {record.sourceRef || 'Reference unavailable'}</p>
              </li>
            );
          })}
        </ul>
        {state.envelope?.page?.nextCursor && (
          <Link to={{ search: serializeContext(context, { recordType, cursor: state.envelope.page.nextCursor }) }}>Next records</Link>
        )}
        {cursor && <Link to={{ search: serializeContext(context, { recordType }) }}>First records</Link>}
      </DataState>
      {incidentId && (
        <DataState loading={detail.loading} error={detail.error} onRetry={detail.refetch}>
          {selected ? (
            <section className="section-stack" aria-label="Selected record">
              <h2>{selected.label}</h2>
              <p>{selected.recordType}</p>
              <EvidencePanel title="Supplied record fields" category={selected.evidence} />
              <EvidencePanel title="Business impact context" category={selected.businessContext} />
              <p className="muted">Only explicit application, API, journey and dependency references are shown. No impact is inferred.</p>
              {targets.filter((target) => ['application', 'journey'].includes(target.type)).map((target) => (
                <Link key={target.id} to={`/${target.type === 'application' ? 'applications' : 'journeys'}/${encodeURIComponent(target.id)}?${serializeContext(context, { returnTo: `${location.pathname}${location.search}` })}`}
                  state={{ origin: `${location.pathname}${location.search}` }}>
                  Open {target.type} · {target.label}
                </Link>
              ))}
              <CorrelationView key={incidentId} incidentId={incidentId} context={context} />
            </section>
          ) : <p role="status">Selected record unavailable in this scope.</p>}
        </DataState>
      )}
    </div>
  );
}
