/** Isolate visibility settings to an explicitly selected existing persona widget. */
import { useState } from 'react';
import PropTypes from 'prop-types';
import { ConfigField, SaveFeedback, useConfigSave } from './KpiConfig';

/** Clear the widget selection on persona changes; never save on render. */
export default function WidgetConfig({
  catalog,
  onSaved
}) {
  const [personaId, setPersona] = useState('');
  const [widgetId, setWidget] = useState('');
  const [visible, setVisible] = useState(true);
  const state = useConfigSave(onSaved);
  const widgets = catalog.widgets.filter(item => item.personaId === personaId);
  return <section
    className="section-stack"
    aria-label="Widget configuration"
  >
    <h2>
      Persona widgets
    </h2>
    <p>
      Visibility affects only the selected persona. Mock personas are not access control.
    </p>
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        if (!personaId || !widgetId) return state.save('/admin/personas/unknown/widgets/unknown', {
          'widget-persona': personaId,
          widgetId
        });
        state.save(`/admin/personas/${encodeURIComponent(personaId)}/widgets/${encodeURIComponent(widgetId)}`, {
          visible
        }, 'PUT');
      }}
    >
      <fieldset
        disabled={state.pending || state.unconfirmed}
      >
        <ConfigField
          id="widget-persona"
          label="Widget persona"
          value={personaId}
          error={state.error}
          options={catalog.personas.map(item => ({
            value: item.id,
            label: item.label
          }))}
          onChange={id => {
            setPersona(id);
            setWidget('');
          }}
        />
        <ConfigField
          id="widgetId"
          label="Existing widget"
          value={widgetId}
          error={state.error}
          options={widgets.map(item => ({
            value: item.id,
            label: item.title
          }))}
          onChange={id => {
            setWidget(id);
            setVisible(widgets.find(item => item.id === id)?.visible ?? true);
          }}
        />
        <label
          htmlFor="widget-visible"
        >
          Visible on selected persona dashboard
        </label>
        <input
          id="widget-visible"
          type="checkbox"
          checked={visible}
          onChange={event => setVisible(event.target.checked)}
        />
        <button
          type="submit"
        >
          Save widget visibility
        </button>
      </fieldset>
    </form>
    <SaveFeedback
      state={state}
      label="Widget visibility"
    />
  </section>;
}
WidgetConfig.propTypes = {
  catalog: PropTypes.object.isRequired,
  onSaved: PropTypes.func.isRequired
};
