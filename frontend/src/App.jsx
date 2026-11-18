/** Own the application's single router and feature registration boundary. */
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { SharedContextProvider, useSharedContext } from './context/SharedContextProvider';
import { AppShell } from './components/shell/AppShell';
import { PersonaSelector } from './components/shell/PersonaSelector';
import DashboardPage from './pages/dashboard/DashboardPage';
import PortfolioExplorer from './pages/portfolio/PortfolioExplorer';
import JourneyList from './pages/journeys/JourneyList';
import JourneyMap from './pages/journeys/JourneyMap';
import ApplicationProfile from './pages/portfolio/ApplicationProfile';
import IncidentBoard from './pages/operations/IncidentBoard';
import ReliabilityBoard from './pages/operations/ReliabilityBoard';

import ReleaseEvidence from './pages/readiness/ReleaseEvidence';
import DevSecOpsMetrics from './pages/readiness/DevSecOpsMetrics';
import QeEnvironmentMetrics from './pages/readiness/QeEnvironmentMetrics';
import SecurityPosture from './pages/readiness/SecurityPosture';
import RecommendationList from './pages/insights/RecommendationList';
import TransformationBoard from './pages/insights/TransformationBoard';
import UploadForm from './pages/admin/UploadForm';
import AdminPage from './pages/admin/AdminPage';

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
            <Route path="/applications/:applicationId" element={<ApplicationProfile />} />
            <Route path="/journeys" element={<JourneyList />} />
            <Route path="/journeys/:journeyId" element={<JourneyMap />} />
            <Route path="/operations" element={<IncidentBoard />} />
            <Route path="/operations/reliability" element={<ReliabilityBoard />} />
            <Route path="/readiness" element={<ReleaseEvidence />} />
            <Route path="/readiness/release" element={<DevSecOpsMetrics />} />
            <Route path="/readiness/qe" element={<QeEnvironmentMetrics />} />
            <Route path="/readiness/security" element={<SecurityPosture />} />
            <Route path="/insights" element={<RecommendationList />} />
            <Route path="/insights/transformation" element={<TransformationBoard />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/uploads" element={<UploadForm />} />
            <Route path="*" element={<UnavailableModule />} />
          </Route>
        </Routes>
      </SharedContextProvider>
    </BrowserRouter>
  );
}
