/** Navigate only current-parent children and represented ancestors. */
import { useState } from 'react';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../shared/DataState';

/** Fetch five-level source hierarchy with bounded child pages. */
export function HierarchyExplorer() {
  const { context, setScope } = useSharedContext();
  const parentId = context.hierarchyNodeId;
  const [paging, setPaging] = useState({ parentId: null, cursor: null });
  const cursor = paging.parentId === parentId ? paging.cursor : null;
  const state = useApi('/hierarchy', context, { parentId, limit: 20, cursor });
  /** Select only a child returned for the current represented parent. */
  const selectChild = (node) => {
    if ((node.parentId || null) !== (parentId || null)) return;
    setScope({ ...context, hierarchyNodeId: node.id });
  };
  return (
    <section className="hierarchy-explorer" aria-label="Represented hierarchy">
      <h2>Represented hierarchy</h2>
      <p className="muted">Domain → Portfolio → Service → Application → Environment. No missing links are inferred.</p>
      <DataState loading={state.loading} error={state.error} onRetry={state.refetch}>
        <nav aria-label="Hierarchy ancestors" className="ancestor-links">
          <button onClick={() => setScope({ ...context, hierarchyNodeId: null })}>All domains</button>
          {(state.envelope?.ancestry || []).map((node) => (
            <button key={node.id} aria-current={node.id === parentId ? 'location' : undefined}
              onClick={() => setScope({ ...context, hierarchyNodeId: node.id })}>{node.label}</button>
          ))}
        </nav>
        {!!state.envelope?.unavailableDimensions?.length && (
          <p role="status">Unavailable dimensions: {state.envelope.unavailableDimensions.join(', ')}</p>
        )}
        {!state.data?.length && <p role="status">No represented children in this scope. Filters are retained.</p>}
        <ul className="entity-list">
          {(state.data || []).map((node) => (
            <li key={node.id}>
              <button onClick={() => selectChild(node)}>{node.label}</button>
              <span className="muted"> {node.level} · {node.id} · {node.source}</span>
              {!node.hasRepresentedChildren && <span className="muted"> · No represented children</span>}
            </li>
          ))}
        </ul>
        {state.envelope?.page?.nextCursor && (
          <button onClick={() => setPaging({ parentId, cursor: state.envelope.page.nextCursor })}>Next children</button>
        )}
        {cursor && <button onClick={() => setPaging({ parentId, cursor: null })}>First children</button>}
      </DataState>
    </section>
  );
}
