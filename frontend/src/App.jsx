/** Own the application's single router and feature registration boundary. */
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from './context/SharedContextProvider';
import { AppShell } from './components/shell/AppShell';
import { PersonaSelector } from './components/shell/PersonaSelector';
import DashboardPage from './pages/dashboard/DashboardPage';
import PortfolioExplorer from './pages/portfolio/PortfolioExplorer';

/** Disclose destinations not yet registered without fetching future domain APIs. */
function UnavailableModule() {
  const { context } = useSharedContext();
  const location = useLocation();
  if (!context.personaId) return <PersonaSelector />;
  return (
    <section className="data-state">
      <p className="eyebrow">Prototype module</p>
      <h1>Module unavailable</h1>
      <p>This supplied destination is not registered in the current prototype.</p>
      <p className="muted">Context retained: {location.pathname}. No domain evidence has been fetched.</p>
      <Link to={`/dashboard${location.search}`}>Return to dashboard</Link>
    </section>
  );
}

/** Register only persona delivery; later slices add routes here. */
export default function App() {
  return (
    <BrowserRouter>
      <SharedContextProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<PersonaSelector />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/portfolio" element={<PortfolioExplorer />} />
            <Route path="*" element={<UnavailableModule />} />
          </Route>
        </Routes>
      </SharedContextProvider>
    </BrowserRouter>
  );
}
