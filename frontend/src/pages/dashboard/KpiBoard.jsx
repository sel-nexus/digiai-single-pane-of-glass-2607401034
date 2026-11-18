/** Render source-qualified KPI values with presentation-only percentage rounding. */
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useSharedContext } from '../../context/SharedContextProvider';
import { DataState } from '../../components/shared/DataState';

/** Round validated decimal literals half away from zero without losing text precision.
 * Bound input length, exponent and magnitude to keep BigInt work and display safe.
 * @param {number|string} value Supplied numeric value or retained upload text.
 * @returns {string|null} Two-decimal percentage, or null for unsupported input.
 */
function formatPercent(value) {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return null;
  const text = String(value);
  if (text.length > 1024) return null;
  const match = /^([+-]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) return null;
  const exponent = Number(match[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const fraction = match[3] ?? match[4] ?? '';
  const coefficient = BigInt(`${match[2] || '0'}${fraction}`);
  const shift = exponent - fraction.length + 2;
  let cents;
  if (shift >= 0) cents = coefficient * (10n ** BigInt(shift));
  else {
    const divisor = 10n ** BigInt(-shift);
    cents = coefficient / divisor + (coefficient % divisor * 2n >= divisor ? 1n : 0n);
  }
  if (cents > 900719925474099100n) return null;
  const digits = cents.toString().padStart(3, '0');
  return `${match[1] === '-' && cents !== 0n ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}%`;
}

/** Preserve zero and raw non-percent units; absent evidence is never healthy. */
export function formatMetric(metric) {
  if (metric.availability !== 'available' || metric.value == null) return 'Unavailable';
  if (metric.unit === '%') return formatPercent(metric.value) ?? 'Unavailable';
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
