/** Present direct represented correlations, never a causal diagnosis. */
import PropTypes from 'prop-types';
import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import EvidencePanel from '../portfolio/EvidencePanel';

/** Fetch only the selected incident and discard stale responses through the shared hook. */
export default function CorrelationView({ incidentId, context }) {
  const [cursor, setCursor] = useState(null);
  const state = useApi(incidentId ? '/operations/correlations' : null, context, { incidentId, limit: 20, cursor });
  const rows = state.envelope?.incidentId === incidentId ? state.data || [] : [];
  return (
    <section className="section-stack" aria-label="Correlations">
      <h2>Represented correlations</h2>
      <p className="muted">Explicit evidence links only. Correlation is not causality; no diagnosis is inferred.</p>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {!!state.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
        )}
        {rows.map((link) => (
          <div key={link.id}>
            <p>{link.relationshipLabel} · {link.sourceEntityId} → {link.targetEntityId}</p>
            <EvidencePanel title={link.evidence.label} category={{ availability: 'available', value: [link.evidence] }} />
          </div>
        ))}
        {!rows.length && <p role="status">Unavailable — no represented correlation supplied.</p>}
        {state.envelope?.page?.nextCursor && (
          <button onClick={() => setCursor(state.envelope.page.nextCursor)}>Next correlations</button>
        )}
        {cursor && <button onClick={() => setCursor(null)}>First correlations</button>}
      </DataState>
    </section>
  );
}
CorrelationView.propTypes = { incidentId: PropTypes.string.isRequired, context: PropTypes.object.isRequired };
