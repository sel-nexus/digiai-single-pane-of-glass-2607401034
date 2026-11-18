/** Display supplied release governance measures using the common metric presentation. */
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { MetricCard } from '../dashboard/KpiBoard';
import { ReadinessNavigation } from './ReleaseEvidence';

/** Fetch one explicit family and exact period, preserving shared scope in every route. */
export function ReadinessMetrics({ family, title }) {
  const { context } = useSharedContext();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const period = query.get('period') || 'month';
  const applicationId = query.get('applicationId');
  const conflict = applicationId && context.filters.application?.length && !context.filters.application.includes(applicationId);
  const scoped = applicationId ? { ...context, filters: { ...context.filters, application: [applicationId] } } : context;
  const state = useApi(context.personaId && !conflict ? '/readiness/metrics' : null, scoped, { family, period, limit: 20 });
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="section-stack">
      <header className="application-heading">
        <p className="eyebrow">Named source measures</p>
        <h1>{title}</h1>
        <p className="muted">No invented formulas, inferred trends, release gates or compliance certification.</p>
        <ReadinessNavigation />
      </header>
      <div className="readiness-period">
        <label htmlFor="readiness-period">Reporting period</label>
        <select id="readiness-period" value={period} onChange={(event) => {
          const next = new URLSearchParams(location.search);
          next.set('period', event.target.value);
          next.delete('cursor');
          navigate({ search: next.toString() });
        }}>
          {['day', 'week', 'month', 'quarter'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        {!!state.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
        )}
        {!state.data?.length && <p role="status">No measures in this scope. Selected filters are retained.</p>}
        <div className="metric-grid">
          {(state.data || []).map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      </DataState>
    </div>
  );
}
ReadinessMetrics.propTypes = {
  family: PropTypes.oneOf(['release', 'qe', 'security']).isRequired,
  title: PropTypes.string.isRequired,
};

/** Show the five named supplied release governance measures. */
export default function DevSecOpsMetrics() {
  return <ReadinessMetrics family="release" title="DevSecOps release metrics" />;
}
