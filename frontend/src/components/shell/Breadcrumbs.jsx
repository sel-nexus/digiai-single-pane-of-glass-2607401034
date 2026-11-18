/** Preserve shared scope in the dashboard return link. */
import { Link, useLocation } from 'react-router-dom';

/** Render only represented route context, never invented entity ancestry. */
export function Breadcrumbs() {
  const location = useLocation();
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <Link to={`/dashboard${location.search}`}>Command center</Link>
      {location.pathname !== '/dashboard' && <span> / Module unavailable</span>}
    </nav>
  );
}
