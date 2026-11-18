/** Submit a demo dataset explicitly and distinguish rejection from unknown completion. */
import { useState } from 'react';
import { useSharedContext } from '../../context/SharedContextProvider';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { postUpload, ApiError } from '../../services/apiClient';
import MappingEditor, { buildMapping } from './MappingEditor';
export const DATASET_CLASSES = [
  'master',
  'journey_mapping',
  'incident',
  'problem_rca',
  'release_metrics',
  'qe_metrics',
  'automation_metrics',
  'security_findings',
  'observability_kpi',
  'transformation_maturity',
  'value_trend'
];

/** Keep drafts inert at render and freeze an ambiguous attempt until manually checked. */
export default function UploadForm() {
  const {
    context
  } = useSharedContext();
  const [datasetClass, setDatasetClass] = useState('');
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState('entity');
  const [assignments, setAssignments] = useState({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  if (!context.personaId) return <PersonaSelector />;

  /** Send only after explicit validation and preserve actionable failure details. */
  async function submit(event) {
    event.preventDefault();
    if (pending || unconfirmed) return;
    setError(null);
    setResult(null);
    try {
      if (!datasetClass || !file) throw new Error('Choose a dataset class and a CSV or XLSX file.');
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Choose a CSV or XLSX file.');
      const mapping = buildMapping(kind, assignments);
      setPending(true);
      const response = await postUpload(file, datasetClass, mapping, {
        personaId: context.personaId
      });
      if (response.data?.outcome !== 'success' || response.data?.reflection?.status !== 'confirmed') {
        throw new ApiError('Write completion is unconfirmed. Check dependent views before any retry.', 'UNCONFIRMED');
      }
      setResult(response.data);
    } catch (failure) {
      setError(failure);
      if (failure.code === 'UNCONFIRMED') setUnconfirmed(true);
    } finally {
      setPending(false);
    }
  }
  return <section
    className="upload-page"
  >
    <p
      className="eyebrow"
    >
      Demo data stewardship
    </p>
    <h1>
      Upload & mapping
    </h1>
    <p
      className="intro"
    >
      Insert new source records into the local prototype. No replacement, live integration, or production
      authorization.
    </p>
    <p
      className="muted"
    >
      CSV UTF-8 or XLSX first worksheet. Defaults: 5 MiB file, 5,000 rows, 100 columns, 50 MiB expanded XLSX.
      Server-configured limits apply. Formula cells are rejected. QE and automation remain distinct selections.
    </p>
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending}
    >
      <fieldset
        disabled={pending || unconfirmed}
      >
        <legend>
          Select dataset and file
        </legend>
        <div
          className="filter-grid"
        >
          <div>
            <label
              htmlFor="dataset-class"
            >
              Dataset class *
            </label>
            <select
              id="dataset-class"
              value={datasetClass}
              aria-required="true"
              onChange={event => setDatasetClass(event.target.value)}
            >
              <option
                value=""
              >
                Choose dataset class
              </option>
              {DATASET_CLASSES.map(item => <option
                key={item}
                value={item}
              >
                {item}
              </option>)}
            </select>
          </div>
          <div>
            <label
              htmlFor="upload-file"
            >
              CSV or XLSX file *
            </label>
            <input
              id="upload-file"
              type="file"
              accept=".csv,.xlsx"
              aria-required="true"
              onChange={event => setFile(event.target.files?.[0] || null)}
            />
            {file && <p
              className="source-ref"
            >
              Selected:
              {' '}
              {file.name}
              {' '}
              ·
              {' '}
              {file.size}
              {' '}
              bytes
            </p>}
          </div>
          <div>
            <label
              htmlFor="record-kind"
            >
              Mapped record kind
            </label>
            <select
              id="record-kind"
              value={kind}
              onChange={event => {
                setKind(event.target.value);
                setAssignments({});
              }}
            >
              <option
                value="entity"
              >
                entity
              </option>
              <option
                value="relationship"
              >
                relationship
              </option>
              <option
                value="metric"
              >
                metric
              </option>
            </select>
          </div>
        </div>
      </fieldset>
      <MappingEditor
        kind={kind}
        assignments={assignments}
        onChange={setAssignments}
        disabled={pending || unconfirmed}
        invalid={Boolean(error && !unconfirmed)}
      />
      <button
        className="primary"
        disabled={pending || unconfirmed}
        type="submit"
      >
        {pending ? 'Validating and committing…' : 'Validate and upload'}
      </button>
      {pending && <p
        role="status"
      >
        Validating the full batch. Do not resubmit while this request is pending.
      </p>}
    </form>
    {error && <div
      id="upload-error"
      role="alert"
      className="upload-feedback"
    >
      <h2>
        {unconfirmed ? 'Upload completion unconfirmed' : 'Upload not accepted'}
      </h2>
      <p>
        {error.message}
      </p>
      {error.details?.issues?.length > 0 && <ul>
        {error.details.issues.map((issue, index) => <li
          key={index}
        >
          {issue.row ? `Row ${issue.row} · ` : ''}
          {issue.field ? `${issue.field}: ` : ''}
          {issue.message}
        </li>)}
      </ul>}
      {unconfirmed && <>
        <p>
          Do not assume rollback. Inspect search and dependent views, or ask the demo operator to check the dataset
          version/audit. There is no automatic retry.
        </p>
        <button
          onClick={() => {
            setUnconfirmed(false);
            setError(null);
          }}
        >
          I checked the outcome; unlock a new attempt
        </button>
      </>}
    </div>}
    {result && <div
      role="status"
      className="upload-feedback"
    >
      <h2>
        Upload confirmed
      </h2>
      <p>
        {result.acceptedRows}
        {' '}
        rows accepted · Source: uploaded · Version:
        {' '}
        {result.datasetVersion}
      </p>
      <p>
        Confirmed query reflection:
        {' '}
        {result.reflection.views.join(', ')}
        . Navigate to a dependent view to fetch the new evidence; current filters may exclude it.
      </p>
    </div>}
    <details
      className="upload-feedback"
    >
      <summary>
        Mapping and data examples
      </summary>
      <p>
        Entity CSV: Identifier,Name,Kind,Details. Map Identifier to id, Name to label, Kind to type, Details to
        attributes. Example values: demo-app, Demo app, application,
        {' '}
        {JSON.stringify({
          health: 'source supplied'
        })}
        .
      </p>
      <p>
        Metric CSV: Key,Measure,Family,Amount,Units,Window,App. Map to id,label,family,value,unit,period,entityId. Use
        family qe for QE, automation for automation. Empty Amount stays unavailable. App must reference an existing
        application.
      </p>
      <p>
        Relationship CSV: Key,From,To,Link,Evidence. Map to id,sourceEntityId,targetEntityId,type,sourceRef. Both
        entities must exist. Supported example types: depends_on, impact, affects, releases, correlates_with.
        SourceRef prose is retained as represented context; provenance is always the upload version.
      </p>
      <p>
        Supported entity types: domain, portfolio, service, application, environment, ticket, release, journey, owner,
        api, recommendation, transformation. Operational recordType, applicationId and readiness evidence are supplied
        inside attributes JSON. Arbitrary source fields are retained, not inferred.
      </p>
    </details>
  </section>;
}
