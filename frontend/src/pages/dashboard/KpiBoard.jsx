/** Render source-qualified KPI values with presentation-only percentage rounding. */
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useSharedContext } from '../../context/SharedContextProvider';
import { DataState } from '../../components/shared/DataState';

/** Preserve zero and raw non-percent units; absent evidence is never healthy. */
export function formatMetric(metric) {
  if (metric.availability !== 'available' || metric.value === null) return 'Unavailable';
  if (metric.unit === '%' && typeof metric.value === 'number') return `${metric.value.toFixed(2)}%`;
  return `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
}

/** Render one supplied metric and its provenance in a flat card. */
export function MetricCard({ metric, title }) {
  return (
    <article className="metric-card" aria-label={title || metric.label}>
      <h3>{title || metric.label}</h3>
      <p className="metric-value">{formatMetric(metric)}</p>
      <p className="muted">{metric.period || 'Period unavailable'} · {metric.source}</p>
      <p className="source-ref">Source: {metric.sourceRef || 'Association unavailable'}</p>
    </article>
  );
}
MetricCard.propTypes = { metric: PropTypes.object.isRequired, title: PropTypes.string };

/** Select exact family and reporting period without synthesizing measures. */
export function KpiBoard() {
  const { context } = useSharedContext();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const family = query.get('family') || 'enterprise';
  const period = query.get('period') || 'month';
  const metrics = useApi('/kpis', context, { family, period });
  const change = (key, value) => {
    const next = new URLSearchParams(location.search);
    next.set(key, value);
    navigate({ search: next.toString() });
  };
  return (
    <section className="section-stack" aria-labelledby="kpi-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Supplied measures</p>
          <h2 id="kpi-title">KPI evidence</h2>
        </div>
        <div className="controls">
          <div>
            <label htmlFor="family">Metric family</label>
            <select id="family" value={family} onChange={(event) => change('family', event.target.value)}>
              {['enterprise', 'reliability', 'release', 'qe', 'security', 'transformation'].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="period">Reporting period</label>
            <select id="period" value={period} onChange={(event) => change('period', event.target.value)}>
              {['day', 'week', 'month', 'quarter'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>
      </div>
      <p className="muted">Source-provided values only. Missing periods remain unavailable; no formulas, inferred trends or live refresh.</p>
      <DataState loading={metrics.loading} error={metrics.error} empty={!metrics.data?.length} onRetry={metrics.refetch}>
        <div className="metric-grid">
          {metrics.data?.map((metric) => <MetricCard key={metric.id} metric={metric} />)}
        </div>
      </DataState>
    </section>
  );
}
