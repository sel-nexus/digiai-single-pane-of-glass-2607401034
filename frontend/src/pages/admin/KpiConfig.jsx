/** Edit supplied labels and share explicit, field-aware save behavior. */
import { useState } from 'react';
import PropTypes from 'prop-types';
import { postJson, putJson, ApiError } from '../../services/apiClient';
import { useSharedContext } from '../../context/SharedContextProvider';

/** Keep saves inert until submission, and freeze ambiguous completion. */
export function useConfigSave(onSaved) {
  const {
    context,
    invalidateConfig
  } = useSharedContext();
  const [state, setState] = useState({
    pending: false,
    error: null,
    success: false,
    unconfirmed: false
  });
  async function save(path, payload, method = 'POST') {
    if (state.pending || state.unconfirmed) return;
    const issues = Object.entries(payload)
      .filter(([key, value]) =>
        key !== 'description' && (value === '' || typeof value === 'string' && !value.trim())
      )
      .map(([field]) => ({
        field,
        message: 'Choose or enter a value.'
      }));
    if (issues.length) {
      setState({
        ...state,
        success: false,
        error: new ApiError('Check the highlighted fields.', 'INVALID_CONFIG', {
          issues
        })
      });
      return;
    }
    setState({
      pending: true,
      error: null,
      success: false,
      unconfirmed: false
    });
    try {
      const response = await (method === 'PUT' ? putJson : postJson)(path, {
        ...payload,
        actor: {
          personaId: context.personaId
        }
      });
      if (
        response.data?.outcome !== 'success' ||
        response.data?.effectiveStatus !== 'confirmed' ||
        response.data?.saved !== true
      ) throw new ApiError(
        'Completion unconfirmed. Check configuration and audit before retrying.',
        'UNCONFIRMED'
      );
      setState({
        pending: false,
        success: true,
        error: null,
        unconfirmed: false
      });
      invalidateConfig();
      onSaved();
    } catch (error) {
      setState({
        pending: false,
        success: false,
        error,
        unconfirmed: error.code === 'UNCONFIRMED'
      });
    }
  }
  return {
    ...state,
    save
  };
}

/** Associate individual server or client validation issues with a labeled field. */
export function ConfigField({
  id,
  label,
  value,
  onChange,
  options,
  error,
  field = id,
  required = true
}) {
  const issue = error?.details?.issues?.find(item => item.field === field || item.location?.at(-1) === field);
  const props = {
    id,
    value,
    onChange: event => onChange(event.target.value),
    'aria-required': required,
    'aria-invalid': Boolean(issue),
    'aria-describedby': issue ? `${id}-error` : undefined
  };
  return <div>
    <label
      htmlFor={id}
    >
      {label}
    </label>
    {options ? <select
      {...props}
    >
      <option
        value=""
      >
        Choose
        {' '}
        {label.toLowerCase()}
      </option>
      {options.map(item => <option
        key={item.value}
        value={item.value}
      >
        {item.label}
      </option>)}
    </select> : <input
      {...props}
      maxLength={id === 'description' ? 500 : 120}
    />}
    {issue && <p
      id={`${id}-error`}
      role="alert"
    >
      {issue.message}
    </p>}
  </div>;
}
ConfigField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.array,
  error: PropTypes.object,
  field: PropTypes.string,
  required: PropTypes.bool
};

/** Describe success, rejection or ambiguous completion without inventing rollback. */
export function SaveFeedback({
  state,
  label
}) {
  return <div
    className="upload-feedback"
  >
    {state.pending && <p
      role="status"
    >
      Saving
      {' '}
      {label}
      …
    </p>}
    {state.success && <p
      role="status"
    >
      {label}
      {' '}
      saved and confirmed.
    </p>}
    {state.error && <p
      role="alert"
    >
      {state.unconfirmed ? 'Completion unconfirmed. Do not assume rollback. Check configuration and audit before any new attempt. ' : ''}
      {state.error.message}
    </p>}
  </div>;
}
SaveFeedback.propTypes = {
  state: PropTypes.object.isRequired,
  label: PropTypes.string.isRequired
};

/** Rename only existing metric labels and associated overview titles. */
export default function KpiConfig({
  catalog,
  onSaved
}) {
  const [draft, setDraft] = useState({
    metricId: '',
    label: '',
    title: ''
  });
  const state = useConfigSave(onSaved);
  return <section
    className="section-stack"
    aria-label="KPI configuration"
  >
    <h2>
      KPI definitions
    </h2>
    <p>
      Display labels only. Supplied values, units and periods are unchanged; formulas are not supported.
    </p>
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        state.save('/admin/kpis', draft);
      }}
    >
      <fieldset
        disabled={state.pending || state.unconfirmed}
      >
        <ConfigField
          id="metricId"
          label="Supplied metric"
          value={draft.metricId}
          error={state.error}
          options={catalog.metrics.map(item => ({
            value: item.metricId,
            label: `${item.label} · ${item.metricId}`
          }))}
          onChange={metricId => setDraft({
            ...draft,
            metricId
          })}
        />
        <ConfigField
          id="label"
          label="Metric display label"
          value={draft.label}
          error={state.error}
          onChange={label => setDraft({
            ...draft,
            label
          })}
        />
        <ConfigField
          id="title"
          label="Overview display title"
          value={draft.title}
          error={state.error}
          onChange={title => setDraft({
            ...draft,
            title
          })}
        />
        <button
          type="submit"
        >
          Save KPI definition
        </button>
      </fieldset>
    </form>
    <SaveFeedback
      state={state}
      label="KPI definition"
    />
  </section>;
}
KpiConfig.propTypes = {
  catalog: PropTypes.object.isRequired,
  onSaved: PropTypes.func.isRequired
};
