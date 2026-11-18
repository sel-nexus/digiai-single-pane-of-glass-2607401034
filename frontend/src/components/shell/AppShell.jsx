/** Compose a restrained responsive command-center shell. */
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { ThemeToggle } from './ThemeToggle';
import { PersonaSwitcher } from './PersonaSwitcher';
import { StatusBadge } from './StatusBadge';
import { Breadcrumbs } from './Breadcrumbs';
import { GlobalSearch } from './GlobalSearch';
import { GlobalFilters } from './GlobalFilters';

/** Expose only implemented dashboard navigation plus labeled future destinations. */
export function AppShell() {
  const { context } = useSharedContext();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <Link className="brand" to={`/${location.search}`}>
          <span>DigiAI</span>
          <span className="muted"> / Single pane of glass</span>
        </Link>
        <div className="header-actions">
          <StatusBadge>Sample prototype</StatusBadge>
          {context.personaId && <PersonaSwitcher />}
          <ThemeToggle />
        </div>
      </header>
      {context.personaId && (
        <div className="nav-bar">
          <button className="nav-toggle" aria-expanded={expanded} aria-controls="primary-navigation"
            onClick={() => setExpanded(!expanded)}>Navigation</button>
          <nav id="primary-navigation" aria-label="Primary" className={expanded ? 'expanded' : ''}>
            <Link to={`/dashboard${location.search}`} aria-current={location.pathname === '/dashboard' ? 'page' : undefined}>Dashboard</Link>
            <Link to={`/portfolio${location.search}`} onClick={() => setExpanded(false)}
              aria-current={location.pathname === '/portfolio' ? 'page' : undefined}>Portfolio</Link>
            <Link to={`/journeys${location.search}`} onClick={() => setExpanded(false)}
              aria-current={location.pathname.startsWith('/journeys') ? 'page' : undefined}>Journeys</Link>
            <Link to={`/operations${location.search}`} onClick={() => setExpanded(false)}
              aria-current={location.pathname === '/operations' ? 'page' : undefined}>Operations</Link>
            <Link to={`/operations/reliability${location.search}`} onClick={() => setExpanded(false)}
              aria-current={location.pathname === '/operations/reliability' ? 'page' : undefined}>Reliability</Link>
            <Link to={`/readiness${location.search}`} onClick={() => setExpanded(false)}
              aria-current={location.pathname.startsWith('/readiness') ? 'page' : undefined}>Readiness</Link>
            <Link to={`/insights${location.search}`} onClick={() => setExpanded(false)}
              aria-current={location.pathname.startsWith('/insights') ? 'page' : undefined}>Insights</Link>
            {['Administration'].map((label) => (
              <Link key={label} to={`/${label.toLowerCase()}${location.search}`} onClick={() => setExpanded(false)}>
                {label}
                <small>Unavailable</small>
              </Link>
            ))}
          </nav>
        </div>
      )}
      <main id="main-content" tabIndex="-1">
        {context.personaId && <Breadcrumbs />}
        {context.personaId && <GlobalSearch />}
        {context.personaId && <GlobalFilters />}
        <Outlet />
      </main>
      <footer>Read-only synthetic evidence · No production controls · Mock persona is display context only</footer>
    </div>
  );
}
