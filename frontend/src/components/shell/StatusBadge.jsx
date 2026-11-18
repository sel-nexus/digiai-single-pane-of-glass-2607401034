/** Identify sample provenance and availability through visible text. */
import PropTypes from 'prop-types';

/** Render a quiet status label without implying production health. */
export function StatusBadge({ children }) {
  return <span className="status-badge" role="status">{children}</span>;
}
StatusBadge.propTypes = { children: PropTypes.node.isRequired };
