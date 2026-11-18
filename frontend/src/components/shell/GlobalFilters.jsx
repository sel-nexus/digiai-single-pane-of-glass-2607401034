/** Present eight shareable source-backed multiselect dimensions. */
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../shared/DataState';

export const filterLabels = {
  domain: 'Domain', portfolio: 'Portfolio', application: 'Application', environment: 'Environment',
  criticality: 'Criticality', dateRange: 'Date range', toolSource: 'Tool source', incidentSeverity: 'Incident severity',
};

/** Keep selected values visible even when the available facets become empty. */
export function GlobalFilters() {
  const { context, setScope } = useSharedContext();
  const state = useApi('/filters/options', context);
  /** Replace one dimension while retaining all other scope. */
  const change = (key, values) => {
    const filters = { ...context.filters };
    if (values.length) filters[key] = values;
    else delete filters[key];
    setScope({ ...context, filters });
  };
  return (
    <details className="global-filters">
      <summary>Shared filters ({Object.values(context.filters).flat().length} selected)</summary>
      <p className="muted">AND across dimensions; OR within a dimension. Source associations only.</p>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        <div className="filter-grid">
          {Object.entries(filterLabels).map(([key, label]) => {
            const selected = context.filters[key] || [];
            const options = state.data?.[key] || [];
            const missing = selected.filter((id) => !options.some((option) => option.id === id));
            return (
              <div key={key}>
                <label htmlFor={`filter-${key}`}>{label}</label>
                <select id={`filter-${key}`} multiple value={selected}
                  onChange={(event) => change(key, Array.from(event.target.selectedOptions, (option) => option.value))}>
                  {missing.map((id) => <option key={id} value={id}>{id} (selected; not in current options)</option>)}
                  {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                {!options.length && <p className="muted">No represented options</p>}
                <button disabled={!selected.length} onClick={() => change(key, [])}>Clear {label}</button>
              </div>
            );
          })}
        </div>
      </DataState>
      {!!state.envelope?.unavailableDimensions?.length && (
        <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
      )}
      <button disabled={!Object.keys(context.filters).length}
        onClick={() => setScope({ ...context, filters: {} })}>Clear all filters</button>
    </details>
  );
}
