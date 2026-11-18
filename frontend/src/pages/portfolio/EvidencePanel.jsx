/** Render supplied evidence as safe structured text, never raw object children. */
import PropTypes from 'prop-types';

/** Preserve nested values, including zero and false, without interpreting markup. */
function StructuredValue({ value }) {
  if (value === null || value === undefined) return <span>Unavailable</span>;
  if (Array.isArray(value)) {
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <StructuredValue value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return (
      <dl className="evidence-fields">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd><StructuredValue value={item} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}
StructuredValue.propTypes = { value: PropTypes.any };

/** Qualify each category and evidence item with source and exact association.
 * @param {object} props Category title and qualified source evidence.
 * @returns {JSX.Element} An accessible, reusable evidence section.
 */
export default function EvidencePanel({ title, category }) {
  const rows = Array.isArray(category?.value) ? category.value : [];
  const available = category?.availability === 'available' && rows.length > 0;
  return (
    <section className="evidence-panel" aria-label={title}>
      <h2>{title}</h2>
      {!available ? (
        <p role="status">Unavailable — no associated evidence supplied.</p>
      ) : (
        <ul className="entity-list">
          {rows.map((item, index) => (
            <li key={`${item.id}-${index}`}>
              <h3>{item.label}</h3>
              <StructuredValue value={item.value} />
              {item.unit && <p className="muted">Unit: {item.unit}</p>}
              {item.period && <p className="muted">Period: {item.period}</p>}
              <p className="source-ref">Source: {item.source} · {item.sourceRef || 'Reference unavailable'}</p>
              <p className="source-ref">Association: {item.association}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
EvidencePanel.propTypes = {
  title: PropTypes.string.isRequired,
  category: PropTypes.shape({
    availability: PropTypes.oneOf(['available', 'unavailable']),
    value: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      value: PropTypes.any,
      source: PropTypes.string.isRequired,
      sourceRef: PropTypes.string,
      association: PropTypes.string.isRequired,
      unit: PropTypes.string,
      period: PropTypes.string,
    })),
  }),
};
