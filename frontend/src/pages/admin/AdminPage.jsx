/** Compose explicit demo configuration and disclose unresolved capabilities. */
import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { useApi } from '../../hooks/useApi';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { DataState } from '../../components/shared/DataState';
import KpiConfig, { ConfigField, SaveFeedback, useConfigSave } from './KpiConfig';
import ScenarioConfig from './ScenarioConfig';
import WidgetConfig from './WidgetConfig';
import AuditLog from './AuditLog';

/** Require exact existing journey/entity IDs for a supported relationship edit. */
export function RelationshipConfig({
  catalog,
  onSaved
}) {
  const [draft, setDraft] = useState({
    relationshipId: '',
    sourceEntityId: '',
    targetEntityId: '',
    type: 'depends_on'
  });
  const state = useConfigSave(onSaved);
  return <section
    className="section-stack"
    aria-label="Relationship mapping configuration"
  >
    <h2>
      Explicit journey mapping
    </h2>
    <p>
      Edit an existing dependency or impact relationship using existing journey and application/API IDs. No inferred
      portfolio or journey links.
    </p>
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        state.save('/admin/mappings', draft);
      }}
    >
      <fieldset
        disabled={state.pending || state.unconfirmed}
      >
        <ConfigField
          id="relationshipId"
          label="Existing relationship"
          value={draft.relationshipId}
          error={state.error}
          options={catalog.relationships.map(item => ({
            value: item.relationshipId,
            label: `${item.sourceEntityId} → ${item.targetEntityId} · ${item.type}`
          }))}
          onChange={relationshipId => {
            const item = catalog.relationships.find(row => row.relationshipId === relationshipId);
            setDraft(item || {
              relationshipId: '',
              sourceEntityId: '',
              targetEntityId: '',
              type: 'depends_on'
            });
          }}
        />
        <ConfigField
          id="sourceEntityId"
          label="Existing journey ID"
          value={draft.sourceEntityId}
          error={state.error}
          onChange={sourceEntityId => setDraft({
            ...draft,
            sourceEntityId
          })}
        />
        <ConfigField
          id="targetEntityId"
          label="Existing application or API ID"
          value={draft.targetEntityId}
          error={state.error}
          onChange={targetEntityId => setDraft({
            ...draft,
            targetEntityId
          })}
        />
        <ConfigField
          id="type"
          label="Represented relationship type"
          value={draft.type}
          error={state.error}
          options={['depends_on', 'impact'].map(value => ({
            value,
            label: value
          }))}
          onChange={type => setDraft({
            ...draft,
            type
          })}
        />
        <button
          type="submit"
        >
          Save explicit mapping
        </button>
      </fieldset>
    </form>
    <SaveFeedback
      state={state}
      label="Mapping"
    />
  </section>;
}

/** Offer supported forms, real uploads navigation and read-only audit review. */
export default function AdminPage() {
  const {
    context
  } = useSharedContext();
  const location = useLocation();
  const catalog = useApi(context.personaId ? '/admin/config' : null);
  const [confirmedCatalog, setConfirmedCatalog] = useState(null);
  useEffect(() => {
    if (catalog.data) setConfirmedCatalog(catalog.data);
  }, [catalog.data]);
  if (!context.personaId) return <PersonaSelector />;
  return <div
    className="admin-page"
  >
    <p
      className="eyebrow"
    >
      Local prototype stewardship
    </p>
    <h1>
      Administration
    </h1>
    <p
      className="intro"
    >
      Explicit configuration with atomic local audit. Mock actor:
      {' '}
      {context.personaId}
      . Deployed container-local data remains disposable.
    </p>
    <Link
      to={`/admin/uploads${location.search}`}
    >
      Open dataset uploads and column mapping
    </Link>
    <DataState
      loading={catalog.loading && !confirmedCatalog}
      error={catalog.error}
      onRetry={catalog.refetch}
    >
      {confirmedCatalog && <>
        <WidgetConfig
          catalog={confirmedCatalog}
          onSaved={catalog.refetch}
        />
        <KpiConfig
          catalog={confirmedCatalog}
          onSaved={catalog.refetch}
        />
        <ScenarioConfig
          catalog={confirmedCatalog}
          onSaved={catalog.refetch}
        />
        <RelationshipConfig
          catalog={confirmedCatalog}
          onSaved={catalog.refetch}
        />
      </>}
    </DataState>
    <AuditLog />
    <section
      className="section-stack"
      aria-label="Unavailable capabilities"
    >
      <h2>
        Awaiting product definition
      </h2>
      <button
        disabled
      >
        Snapshot export unavailable
      </button>
      <button
        disabled
      >
        Annotations unavailable
      </button>
      <p>
        Snapshot target, contents and format, and annotation/comment behavior need owner approval. Annotation audit
        tracking does not enable annotation UX.
      </p>
    </section>
  </div>;
}
RelationshipConfig.propTypes = {
  catalog: PropTypes.object.isRequired,
  onSaved: PropTypes.func.isRequired
};
