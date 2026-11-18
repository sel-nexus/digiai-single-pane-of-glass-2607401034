/** Review actual persisted events with bounded exact-match filters. */
import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSharedContext } from '../../context/SharedContextProvider';
import { DataState } from '../../components/shared/DataState';

/** Apply filters only on explicit review, never claim a defined export format. */
export default function AuditLog() {
  const { context } = useSharedContext();
  const [draft, setDraft] = useState({ eventType: '', target: '', persona: '' });
  const [filters, setFilters] = useState({ limit: 50, offset: 0 });
  const audit = useApi('/admin/audit', { configRevision: context.configRevision }, filters);
  return (
    <section className="section-stack" aria-label="Audit log">
      <h2>Audit log</h2>
      <p>Engineering-defined filters: exact eventType, target ID and actor persona, combined with AND. Pages contain at most 50 events.</p>
      <form onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft, limit: 50, offset: 0 }); }}>
        <div className="filter-grid">
          <div>
            <label htmlFor="audit-type">Audit event type</label>
            <select id="audit-type" value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}>
              <option value="">All event types</option>
              {['edit', 'override', 'annotation', 'uploaded_data_version'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="audit-target">Audit target ID</label>
            <input id="audit-target" value={draft.target} maxLength={100} onChange={(event) => setDraft({ ...draft, target: event.target.value })} />
          </div>
          <div>
            <label htmlFor="audit-persona">Audit actor persona</label>
            <input id="audit-persona" value={draft.persona} maxLength={100} onChange={(event) => setDraft({ ...draft, persona: event.target.value })} />
          </div>
        </div>
        <button type="submit">Apply audit filters</button>
      </form>
      <DataState loading={audit.loading} error={audit.error} onRetry={audit.refetch}>
        {!audit.data?.length && <p role="status">No matching audit events.</p>}
        <ul className="entity-list">
          {audit.data?.map((event) => (
            <li key={event.id}>
              <h3>{event.summary}</h3>
              <p>{event.eventType} · {event.targetType} · {event.targetId}</p>
              <p className="muted">{event.occurredAt} · Mock actor: {event.actor?.personaId || 'Unavailable'} · {event.actor?.userId || 'Unavailable'}</p>
              {event.details?.config?.label && <p>Saved label: {event.details.config.label}</p>}
              <p className="source-ref">Event ID: {event.id}</p>
            </li>
          ))}
        </ul>
        <p>{audit.envelope?.total || 0} matching events</p>
        <button disabled={!filters.offset} onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - 50) })}>Previous audit page</button>
        <button disabled={(filters.offset + 50) >= (audit.envelope?.total || 0) || filters.offset >= 10000} onClick={() => setFilters({ ...filters, offset: filters.offset + 50 })}>Next audit page</button>
      </DataState>
      <button disabled aria-describedby="audit-export-block">Export audit unavailable</button>
      <p id="audit-export-block">Dependency unavailable: ask the product owner to approve audit export format and contents. No file is generated.</p>
    </section>
  );
}
