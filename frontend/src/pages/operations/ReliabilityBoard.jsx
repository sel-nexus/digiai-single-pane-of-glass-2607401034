/** Show exact-period supplied reliability metrics and summary evidence separately. */
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { serializeContext } from '../../services/apiClient';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { MetricCard } from '../dashboard/KpiBoard';
import EvidencePanel from '../portfolio/EvidencePanel';

/** Preserve supplied units, source refs and unavailable measures without calculation. */
export default function ReliabilityBoard() {
  const { context } = useSharedContext();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const period = query.get('period') || 'month';
  const cursor = query.get('signalCursor');
  const metrics = useApi(context.personaId ? '/operations/metrics' : null, context, { period, limit: 9 });
  const signals = useApi(context.personaId ? '/operations/observability' : null, context, { cursor, limit: 20 });
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="section-stack">
      <header>
        <p className="eyebrow">Supplied measures and signals</p>
        <h1>Reliability evidence</h1>
        <p className="muted">No calculated metrics, live telemetry, inferred freshness or causal diagnosis.</p>
        <Link to={`/operations?${serializeContext(context)}`}>Return to incidents</Link>
      </header>
      <div>
        <label htmlFor="reliability-period">Reporting period</label>
        <select id="reliability-period" value={period} onChange={(event) => {
          const next = new URLSearchParams(location.search);
          next.set('period', event.target.value);
          navigate({ search: next.toString() });
        }}>
          {['day', 'week', 'month', 'quarter'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <DataState loading={metrics.loading} error={metrics.error} onRetry={metrics.refetch}>
        {!!metrics.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {metrics.envelope.unavailableDimensions.join(', ')}</p>
        )}
        <div className="metric-grid">
          {(metrics.data || []).map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      </DataState>
      <section className="section-stack" aria-label="Observability summaries">
        <h2>Observability summaries</h2>
        <DataState loading={signals.loading} error={signals.error} onRetry={signals.refetch}>
          {!!signals.envelope?.unavailableDimensions?.length && (
            <p role="status">Unavailable dimensions: {signals.envelope.unavailableDimensions.join(', ')}</p>
          )}
          {!signals.data?.length && <p role="status">Unavailable — no summary signals supplied.</p>}
          {(signals.data || []).map((signal) => (
            <div key={signal.id}>
              <EvidencePanel title={signal.label} category={signal.evidence} />
              <EvidencePanel title={`Application / service context · ${signal.label}`} category={signal.businessContext} />
            </div>
          ))}
          {signals.envelope?.page?.nextCursor && (
            <Link to={{ search: serializeContext(context, { period, signalCursor: signals.envelope.page.nextCursor }) }}>Next summaries</Link>
          )}
          {cursor && <Link to={{ search: serializeContext(context, { period }) }}>First summaries</Link>}
        </DataState>
      </section>
    </div>
  );
}
