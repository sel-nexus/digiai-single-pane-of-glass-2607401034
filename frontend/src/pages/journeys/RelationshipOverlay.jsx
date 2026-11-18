/** Present directed relationship evidence without suggesting causal links. */
import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';

/** Link exact application profiles and disclose represented API assets inline. */
export default function RelationshipOverlay({ overlay, kind }) {
  const { context } = useSharedContext();
  const location = useLocation();
  const rows = (overlay?.value || []).filter((row) => row.type === kind);
  const title = kind === 'depends_on' ? 'Dependency' : 'Impact';
  return (
    <section className="relationship-overlay" aria-label={`${title} relationships`}>
      <h2>{title} overlay</h2>
      <p className="muted">Explicit represented associations only. Not causal; no inferred transitive links.</p>
      {overlay?.availability !== 'available' || !rows.length ? (
        <p role="status">{title} relationships unavailable. No associated evidence supplied in this scope.</p>
      ) : (
        <ul className="entity-list">
          {rows.map((row) => (
            <li key={row.id}>
              <p>{row.sourceLabel} → {row.target.label}</p>
              <p className="muted">Represented {title.toLowerCase()} · {row.sourceEntityId} → {row.target.entityId}</p>
              <p className="source-ref">Relationship source: {row.source} · {row.sourceRef}</p>
              {row.representedContext && <p>{row.representedContext}</p>}
              {row.target.entityType === 'application' ? (
                <Link to={`/applications/${encodeURIComponent(row.target.entityId)}?${serializeContext(context, { returnTo: `${location.pathname}${location.search}` })}`}
                  state={{ origin: `${location.pathname}${location.search}` }}>
                  Open application · {row.target.label}
                </Link>
              ) : (
                <details>
                  <summary>Inspect API asset · {row.target.label}</summary>
                  <p>Represented API asset: {row.target.entityId}. No live API connection or endpoint invocation.</p>
                  <p className="source-ref">Asset source: {row.target.source} · {row.target.sourceRef || 'Reference unavailable'}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
RelationshipOverlay.propTypes = {
  kind: PropTypes.oneOf(['depends_on', 'impact']).isRequired,
  overlay: PropTypes.shape({ availability: PropTypes.string, value: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired, type: PropTypes.string.isRequired, sourceEntityId: PropTypes.string.isRequired,
    sourceLabel: PropTypes.string.isRequired, source: PropTypes.string.isRequired, sourceRef: PropTypes.string,
    representedContext: PropTypes.string, target: PropTypes.shape({
      entityType: PropTypes.oneOf(['application', 'api']).isRequired, entityId: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired, source: PropTypes.string.isRequired, sourceRef: PropTypes.string,
    }).isRequired,
  })) }),
};
