/** Present explicit source periods in supplied order, without interpolation. */
import PropTypes from 'prop-types';

/** Format supplied primitives and units, with two decimals only for percentages. */
export function insightValue(metric) {
  if (metric?.availability !== 'available' || metric.value === null || metric.value === undefined
    || !metric.period || !metric.sourceRef || !['string', 'number'].includes(typeof metric.value)) return 'Unavailable';
  if (typeof metric.value === 'number' && !Number.isFinite(metric.value)) return 'Unavailable';
  return metric.unit === '%' && typeof metric.value === 'number' ? `${metric.value.toFixed(2)}%`
    : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
}

/** Require at least two qualified explicit-period points before labeling a series as a trend. */
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
