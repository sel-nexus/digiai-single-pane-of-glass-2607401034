/** Present directed relationship evidence without suggesting causal links. */
import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';

/** Link exact application profiles and disclose represented API assets inline. */
export default function RelationshipOverlay({ overlay, kind }) {
  const { context } = useSharedContext();
  const location = useLocation();
  const rows = (Array.isArray(overlay?.value) ? overlay.value : []).filter((row) => row.type === kind);
  const title = kind === 'depends_on' ? 'Dependency' : 'Impact';
  return (
    <section className="relationship-overlay" aria-label={`${title} relationships`}>
      <h2>{title} overlay</h2>
      <p className="muted">Explicit represented associations only. Not causal; no inferred transitive links.</p>
      {overlay?.availability !== 'available' || !rows.length ? (
        <p role="status">{title} relationships unavailable. No associated evidence supplied in this scope.</p>
      ) : (
        <figure className="relationship-diagram">
          <figcaption>
            Arrows follow the supplied source-to-target direction. Each pair is one relationship; repeated nodes do not add links.
          </figcaption>
          <ul className="relationship-edges" aria-label={`${title} directed relationships`}>
            {rows.map((row) => (
              <li key={row.id} data-relationship-id={row.id}>
                <div className="relationship-pair" role="group"
                  aria-label={`${row.sourceLabel} (${row.sourceEntityId}) → ${row.target.label} (${row.target.entityId}): ${row.type}`}>
                  <div className="relationship-node" data-entity-id={row.sourceEntityId}>
                    <p className="eyebrow">Source node</p>
                    <strong className="relationship-node-label">{row.sourceLabel}</strong>
                    <p className="relationship-identity">{row.sourceEntityId}</p>
                  </div>
                  <div className="relationship-connector">
                    <span className="relationship-edge-label">{row.type}</span>
                    <span className="relationship-arrow" aria-hidden="true" />
                    <span className="relationship-identity">{row.id}</span>
                  </div>
                  <div className="relationship-node" data-entity-id={row.target.entityId}>
                    <p className="eyebrow">Target node · {row.target.entityType}</p>
                    <strong className="relationship-node-label">{row.target.label}</strong>
                    <p className="relationship-identity">{row.target.entityId}</p>
                    <p className="source-ref">Asset source: {row.target.source} · {row.target.sourceRef || 'Reference unavailable'}</p>
                  </div>
                </div>
                <p>{row.sourceLabel} → {row.target.label}</p>
                <p className="muted">Represented {title.toLowerCase()} · {row.sourceEntityId} → {row.target.entityId}</p>
                <p className="source-ref">Relationship source: {row.source} · {row.sourceRef || 'Reference unavailable'}</p>
                {row.representedContext && <p>{row.representedContext}</p>}
                {row.target.entityType === 'application' ? (
                  <Link
                    to={`/applications/${encodeURIComponent(row.target.entityId)}?${serializeContext(context, {
                      returnTo: `${location.pathname}${location.search}`,
                    })}`}
                    state={{ origin: `${location.pathname}${location.search}` }}
                  >
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
        </figure>
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
