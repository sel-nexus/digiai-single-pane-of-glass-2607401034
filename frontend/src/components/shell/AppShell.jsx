/** Compose a branded responsive shell while preserving shared evidence context. */
import { useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { ThemeToggle } from './ThemeToggle';
import { PersonaSwitcher } from './PersonaSwitcher';
import { StatusBadge } from './StatusBadge';
import { Breadcrumbs } from './Breadcrumbs';
import { GlobalSearch } from './GlobalSearch';
import { GlobalFilters } from './GlobalFilters';

/** Expose implemented destinations with context-preserving navigation. */
export function AppShell() {
  const { context } = useSharedContext();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const navToggle = useRef(null);
  const main = useRef(null);
  /** Close the disclosure and move focus to the destination for ordinary navigation. */
  const closeNavigation = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setExpanded(false);
    main.current?.focus();
  };
  return (
    <div className={`app-shell${context.personaId ? ' has-navigation' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <Link className="brand" to={`/${location.search}`}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy">
            <span>DigiAI</span>
            <span className="muted"> / Single pane of glass</span>
          </span>
        </Link>
        <div className="header-actions">
          <StatusBadge>Sample prototype</StatusBadge>
          {context.personaId && <PersonaSwitcher />}
          <ThemeToggle />
        </div>
      </header>
      {context.personaId && (
        <div className="nav-bar">
          <button ref={navToggle} className="nav-toggle" aria-expanded={expanded} aria-controls="primary-navigation"
            onClick={() => setExpanded((value) => !value)}>Navigation</button>
          <nav id="primary-navigation" aria-label="Primary" className={expanded ? 'expanded' : ''}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && expanded) {
                setExpanded(false);
                navToggle.current?.focus();
              }
            }}>
            <Link to={`/dashboard${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname === '/dashboard' ? 'page' : undefined}>Dashboard</Link>
            <Link to={`/portfolio${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname === '/portfolio' ? 'page' : undefined}>Portfolio</Link>
            <Link to={`/journeys${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname.startsWith('/journeys') ? 'page' : undefined}>Journeys</Link>
            <Link to={`/operations${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname === '/operations' ? 'page' : undefined}>Operations</Link>
            <Link to={`/operations/reliability${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname === '/operations/reliability' ? 'page' : undefined}>Reliability</Link>
            <Link to={`/readiness${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname.startsWith('/readiness') ? 'page' : undefined}>Readiness</Link>
            <Link to={`/insights${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname.startsWith('/insights') ? 'page' : undefined}>Insights</Link>
            <Link to={`/admin${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname === '/admin' ? 'page' : undefined}>Administration</Link>
            <Link to={`/admin/uploads${location.search}`} onClick={closeNavigation}
              aria-current={location.pathname === '/admin/uploads' ? 'page' : undefined}>Uploads</Link>
          </nav>
        </div>
      )}
      <main ref={main} id="main-content" tabIndex="-1">
        {context.personaId && <Breadcrumbs />}
        {context.personaId && <GlobalSearch />}
        {context.personaId && <GlobalFilters />}
        <Outlet />
      </main>
      <footer>Read-only synthetic evidence · No production controls · Mock persona is display context only</footer>
    </div>
  );
}
