/** Present consistent accessible asynchronous read states. */
import PropTypes from 'prop-types';

/** Render one loading, failure, or empty state with an optional read retry. */
export function DataState({ loading, error, empty, onRetry, children }) {
  if (loading) return (
    <div className="data-state" role="status" aria-live="polite">
      <p>Loading prototype evidence…</p>
      <div className="skeleton" aria-hidden="true" />
    </div>
  );
  if (error) return (
    <div className="data-state" role="alert">
      <h2>Evidence unavailable</h2>
      <p>{error.message}</p>
      {onRetry && <button onClick={onRetry}>Try again</button>}
    </div>
  );
  if (empty) return (
    <div className="data-state" role="status">
      <p>No configured evidence for this view.</p>
    </div>
  );
  return children;
}
DataState.propTypes = { loading: PropTypes.bool, error: PropTypes.object, empty: PropTypes.bool, onRetry: PropTypes.func, children: PropTypes.node };
