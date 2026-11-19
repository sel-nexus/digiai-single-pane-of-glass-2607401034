/** Present explicit source periods in supplied order, without interpolation. */
import PropTypes from 'prop-types';
import { useId } from 'react';
import { formatMetric } from '../dashboard/KpiBoard';

/** Format supplied primitives and units, with two decimals only for percentages. */
export function insightValue(metric) {
  if (metric?.availability !== 'available' || metric.value === null || metric.value === undefined
    || !metric.period || !metric.sourceRef || !['string', 'number'].includes(typeof metric.value)) return 'Unavailable';
  if (typeof metric.value === 'number' && !Number.isFinite(metric.value)) return 'Unavailable';
  return formatMetric(metric);
}

/** Qualify every point without coercing categories or converting supplied units.
 * Args:
 *   item: A supplied series with individually qualified evidence points.
 * Returns:
 *   Whether the complete series supports a same-unit numeric comparison.
 */
function canCompare(item) {
  const points = item.points;
  return item.availability === 'available' && Array.isArray(points) && points.length >= 2
    && points.every((point) => point?.availability === 'available'
      && [point.period, point.source, point.sourceRef, point.unit]
        .every((value) => typeof value === 'string' && value.trim())
      && point.unit === points[0].unit
      && (typeof point.value === 'number' || (typeof point.value === 'string'
        && /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(point.value)))
      && Number.isFinite(Number(point.value)));
}

/** Compare signed magnitudes against zero in source order, never as chronology.
 * Args:
 *   item: An already qualified same-unit numeric series.
 * Notes:
 *   Normalize before subtracting to avoid overflow at finite numeric extremes.
 */
function ComparisonChart({ item }) {
  const id = useId();
  const values = item.points.map((point) => Number(point.value));
  const magnitude = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0) || 1;
  const normalized = values.map((value) => value / magnitude);
  const minimum = normalized.reduce((lowest, value) => Math.min(lowest, value), 0);
  const maximum = normalized.reduce((highest, value) => Math.max(highest, value), 0);
  const span = maximum - minimum || 1;
  const position = (value) => 80 + ((value - minimum) / span) * 480;
  const baseline = position(0);
  const height = item.points.length * 40 + 40;
  const exact = item.points.map((point, index) =>
    `${index + 1}. ${point.period}: ${String(point.value)} (unit: ${point.unit}); Source: ${point.source} · ${point.sourceRef}`).join(' | ');
  return (
    <figure className="transformation-comparison">
      <figcaption>{item.label} · source-ordered comparison · Unit: {item.points[0].unit}</figcaption>
      <p className="source-ref">Bar labels are source-order positions, not dates. Zero baseline; no inferred trend or interpolation.</p>
      <div className="transformation-comparison-scroll">
        <svg viewBox={`0 0 640 ${height}`} role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
          <title id={`${id}-title`}>{item.label}: source-ordered comparison ({item.points[0].unit})</title>
          <desc id={`${id}-description`}>{exact}</desc>
          <line className="transformation-zero" x1={baseline} x2={baseline} y1="16" y2={height - 24} />
          <text x={baseline} y={height - 6} textAnchor="middle" aria-hidden="true">0</text>
          {normalized.map((value, index) => (
            <g key={`${item.points[index].id}-${index}`} aria-hidden="true">
              <text x="24" y={index * 40 + 34}>{index + 1}</text>
              <rect
                className="transformation-bar" x={Math.min(baseline, position(value))}
                y={index * 40 + 16} width={Math.abs(position(value) - baseline)} height="24"
              />
              {value === 0 && <circle className="transformation-bar" cx={baseline} cy={index * 40 + 28} r="3" />}
            </g>
          ))}
        </svg>
      </div>
      <p className="source-ref">Exact supplied values: {exact}</p>
    </figure>
  );
}
ComparisonChart.propTypes = { item: PropTypes.object.isRequired };

/** Preserve textual evidence and add only qualified source-ordered comparisons. */
export default function TransformationTrends({ series = [] }) {
  if (!series.length) return <p role="status">Trend unavailable. No explicit-period series supplied.</p>;
  return (
    <div className="section-stack">
      {series.map((item, index) => {
        const points = Array.isArray(item.points) ? item.points : [];
        const available = item.availability === 'available' && points.length > 1
          && points.every((point) => insightValue(point) !== 'Unavailable');
        return (
          <section key={`${item.label}-${index}`} aria-label={`${item.label} series`}>
            <h3>{item.label} · supplied series</h3>
            {!available && <p role="status">Trend unavailable. A single point or missing period does not establish a trend.</p>}
            {canCompare(item) ? <ComparisonChart item={item} /> : (
              <p className="source-ref">
                Comparison unplotted. Requires at least two available numeric points with period, source,
                reference and the same supplied unit. Textual evidence retained.
              </p>
            )}
            <ol aria-label={`${item.label} source order`}>
              {points.map((point) => (
                <li key={point.id}>
                  <p>{point.period || 'Period unavailable'} · {insightValue(point)}</p>
                  <p className="source-ref">Source: {point.source} · {point.sourceRef || 'Reference unavailable'}</p>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
TransformationTrends.propTypes = { series: PropTypes.arrayOf(PropTypes.object) };
