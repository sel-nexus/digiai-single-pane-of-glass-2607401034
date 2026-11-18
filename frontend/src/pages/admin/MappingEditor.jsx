/** Edit precise dynamic source-column assignments without imposing file headers. */
import PropTypes from 'prop-types';

export const MAPPING_FIELDS = {
  entity: ['id', 'type', 'label', 'parentId', 'criticality', 'attributes'],
  relationship: ['id', 'sourceEntityId', 'targetEntityId', 'type', 'sourceRef'],
  metric: ['id', 'label', 'family', 'value', 'unit', 'period', 'entityId'],
};
export const REQUIRED_FIELDS = {
  entity: ['id', 'type', 'label'],
  relationship: ['id', 'sourceEntityId', 'targetEntityId', 'type'],
  metric: ['id', 'label', 'family'],
};

/** Build a mapping only when required assignments are unique and nonempty. */
export function buildMapping(kind, assignments) {
  const entries = Object.entries(assignments).filter(([, source]) => source !== '');
  if (REQUIRED_FIELDS[kind].some((field) => !assignments[field])) throw new Error('Assign every required field to its exact source column name.');
  if (new Set(entries.map(([, source]) => source)).size !== entries.length) throw new Error('Use a different source column for each assigned field.');
  return { recordKind: kind, columns: Object.fromEntries(entries.map(([field, source]) => [source, field])) };
}

/** Label every assignment and retain the source names exactly as entered. */
export default function MappingEditor({ kind, assignments, onChange, disabled, invalid }) {
  return (
    <fieldset disabled={disabled} className="upload-mapping">
      <legend>Map source columns</legend>
      <p className="muted" id="mapping-help">Enter exact file header names, not cell values. Unmapped columns are ignored. Required fields are marked *. For example: Identifier → id, Name → label, Kind → type. Attributes is one column containing a JSON object.</p>
      <div className="filter-grid">
        {MAPPING_FIELDS[kind].map((field) => (
          <div key={field}>
            <label htmlFor={`mapping-${field}`}>Source column for {field}{REQUIRED_FIELDS[kind].includes(field) ? ' *' : ''}</label>
            <input id={`mapping-${field}`} value={assignments[field] || ''}
              aria-required={REQUIRED_FIELDS[kind].includes(field)} aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'upload-error mapping-help' : 'mapping-help'}
              onChange={(event) => onChange({ ...assignments, [field]: event.target.value })} />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
MappingEditor.propTypes = {
  kind: PropTypes.oneOf(['entity', 'relationship', 'metric']).isRequired,
  assignments: PropTypes.objectOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  invalid: PropTypes.bool,
};
