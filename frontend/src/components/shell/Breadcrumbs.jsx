/** Preserve shared scope in the dashboard return link. */
import { Link, useLocation } from 'react-router-dom';

/** Render only represented route context, never invented entity ancestry. */
export function Breadcrumbs() {
  const location = useLocation();
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <Link to={`/dashboard${location.search}`}>Command center</Link>
      {location.pathname.startsWith('/journeys') && <span> / Journeys</span>}
      {location.pathname === '/portfolio' && <span> / Portfolio</span>}
      {location.pathname.startsWith('/applications/') && <span aria-current="page"> / Application 360</span>}
      {location.pathname === '/operations' && <span aria-current="page"> / Operations</span>}
      {location.pathname === '/operations/reliability' && <span aria-current="page"> / Reliability</span>}
      {!['/dashboard', '/portfolio', '/operations', '/operations/reliability'].includes(location.pathname) && !location.pathname.startsWith('/journeys') && !location.pathname.startsWith('/applications/') && (
        <span> / Module unavailable</span>
      )}
    </nav>
  );
}
