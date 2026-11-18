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
      {location.pathname.startsWith('/readiness') && <span aria-current="page"> / Readiness</span>}
      {location.pathname.startsWith('/insights') && <span aria-current="page"> / Insights</span>}
      {location.pathname === '/admin' && <span aria-current="page"> / Administration</span>}
      {location.pathname === '/admin/uploads' && <span aria-current="page"> / Uploads</span>}
      {!['/dashboard', '/portfolio', '/operations', '/operations/reliability', '/admin/uploads', '/admin'].includes(location.pathname) && !location.pathname.startsWith('/insights') && !location.pathname.startsWith('/readiness') && !location.pathname.startsWith('/journeys') && !location.pathname.startsWith('/applications/') && (
        <span> / Module unavailable</span>
      )}
    </nav>
  );
}
