/** Configure only existing scenarios and approved available internal contexts. */
import { useState } from 'react';
import PropTypes from 'prop-types';
import { ConfigField, SaveFeedback, useConfigSave } from './KpiConfig';

/** Require explicit selection and submission without arbitrary redirect text. */
export default function ScenarioConfig({
  catalog,
  onSaved
}) {
  const [draft, setDraft] = useState({
    scenarioId: '',
    label: '',
    description: '',
    destination: ''
  });
  const state = useConfigSave(onSaved);
  return <section
    className="section-stack"
    aria-label="Scenario configuration"
  >
    <h2>
      Scenario configuration
    </h2>
    <p>
      Choose an existing scenario and an available internal destination. No external redirects.
    </p>
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        state.save('/admin/scenarios', draft);
      }}
    >
      <fieldset
        disabled={state.pending || state.unconfirmed}
      >
        <ConfigField
          id="scenarioId"
          label="Existing scenario"
          value={draft.scenarioId}
          error={state.error}
          options={catalog.scenarios.map(item => ({
            value: item.id,
            label: item.label
          }))}
          onChange={scenarioId => {
            const item = catalog.scenarios.find(row => row.id === scenarioId);
            setDraft(item ? {
              scenarioId,
              label: item.label,
              description: item.description,
              destination: item.destination
            } : {
              scenarioId: '',
              label: '',
              description: '',
              destination: ''
            });
          }}
        />
        <ConfigField
          id="scenario-label"
          field="label"
          label="Scenario display label"
          value={draft.label}
          error={state.error}
          onChange={label => setDraft({
            ...draft,
            label
          })}
        />
        <ConfigField
          id="description"
          required={false}
          label="Scenario description"
          value={draft.description}
          error={state.error}
          onChange={description => setDraft({
            ...draft,
            description
          })}
        />
        <ConfigField
          id="destination"
          label="Available destination"
          value={draft.destination}
          error={state.error}
          options={catalog.destinations.map(value => ({
            value,
            label: value
          }))}
          onChange={destination => setDraft({
            ...draft,
            destination
          })}
        />
        <button
          type="submit"
        >
          Save scenario
        </button>
      </fieldset>
    </form>
    <SaveFeedback
      state={state}
      label="Scenario"
    />
  </section>;
}
ScenarioConfig.propTypes = {
  catalog: PropTypes.object.isRequired,
  onSaved: PropTypes.func.isRequired
};
