/** Compose only the active persona's supplied dashboard widgets. */
import { useApi } from '../../hooks/useApi';
import { useSharedContext } from '../../context/SharedContextProvider';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { KpiBoard, MetricCard } from './KpiBoard';
import { ScenarioLauncher } from './ScenarioLauncher';

/** Clear previous persona data during selection changes and surface all read states. */
export default function DashboardPage() {
  const { context } = useSharedContext();
  const dashboard = useApi(context.personaId ? '/dashboard' : null, context);
  if (!context.personaId) return <PersonaSelector />;
  return (
    <div className="dashboard">
      <p className="eyebrow">Command center / {context.personaId}</p>
      <h1>{dashboard.data?.persona.label || 'Selected persona'} perspective</h1>
      <p className="intro">An evidence-led view. Supplied, not inferred.</p>
      <DataState loading={dashboard.loading} error={dashboard.error} onRetry={dashboard.refetch}>
        <section aria-label="Persona widgets">
          <h2 className="section-title">Your configured overview</h2>
          {dashboard.envelope?.unavailableDimensions?.length > 0 && (
            <p role="status">Selected scope unavailable for supplied KPIs: {dashboard.envelope.unavailableDimensions.join(', ')}</p>
          )}
          {!dashboard.data?.widgets.length && <p role="status">No visible widgets configured for this persona.</p>}
          <div className="metric-grid overview">
            {dashboard.data?.widgets.map((widget) => <MetricCard key={widget.id} metric={widget.metric} title={widget.title} />)}
          </div>
        </section>
        <KpiBoard />
        <ScenarioLauncher scenarios={dashboard.data?.scenarios || []} />
      </DataState>
    </div>
  );
}
