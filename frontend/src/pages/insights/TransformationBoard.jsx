/** Display independently supplied adoption, maturity, value and effort evidence. */
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSharedContext } from '../../context/SharedContextProvider';
import { serializeContext } from '../../services/apiClient';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../../components/shared/DataState';
import { PersonaSelector } from '../../components/shell/PersonaSelector';
import { InsightLinks } from './RecommendationList';
import TransformationTrends, { insightValue } from './TransformationTrends';

/** Keep exact source-period selection and bounded pagination navigable. */
export default function TransformationBoard() {
  const {
    context
  } = useSharedContext();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const period = query.get('period') || '';
  const applicationId = query.get('applicationId');
  const cursor = query.get('cursor');
  const state = useApi(context.personaId ? '/transformation' : null, context, {
    applicationId,
    period,
    cursor,
    limit: 20
  });
  if (!context.personaId) return <PersonaSelector />;
  const items = Array.isArray(state.data) ? state.data : [];
  const periods = [...new Set(
    items.flatMap(item => [
      ...(item.measures || []).map(metric => metric.period),
      ...(item.series || []).flatMap(series =>
        (series.points || []).map(point => point.period)
      )
    ]).filter(Boolean)
  )];
  return <section
    className="section-stack"
  >
    <header>
      <h1>
        Transformation adoption and value
      </h1>
      <p
        className="muted"
      >
        Supplied measures and explicit periods only. No formulas, interpolation, or inferred trend.
      </p>
      <Link
        to={`/insights?${serializeContext(context)}`}
      >
        Mock recommendations
      </Link>
    </header>
    <div>
      <label
        htmlFor="transformation-period"
      >
        Source reporting period
      </label>
      <select
        id="transformation-period"
        value={period}
        onChange={event => navigate({
          search: serializeContext(context, {
            applicationId,
            period: event.target.value
          })
        })}
      >
        <option
          value=""
        >
          All supplied periods
        </option>
        {[...new Set([...periods, ...(period ? [period] : [])])].map(value => <option
          key={value}
          value={value}
        >
          {value}
        </option>)}
      </select>
    </div>
    <DataState
      loading={state.loading}
      error={state.error}
      onRetry={state.refetch}
    >
      {!!state.envelope?.unavailableDimensions?.length && <p
        role="status"
      >
        Unavailable dimensions:
        {' '}
        {state.envelope.unavailableDimensions.join(', ')}
      </p>}
      {!items.length && <p
        role="status"
      >
        No transformation evidence in this scope. Filters are retained.
      </p>}
      <ul
        className="entity-list"
        aria-label="Transformation records"
      >
        {items.map(item => <li
          key={item.id}
        >
          <article
            aria-label={item.label}
          >
            <h2>
              {item.label}
            </h2>
            <p
              className="source-ref"
            >
              {item.id}
              {' '}
              · Source:
              {' '}
              {item.source}
              {' '}
              ·
              {' '}
              {item.sourceRef || 'Reference unavailable'}
            </p>
            <dl>
              {(item.measures || []).map(metric => <div
                key={metric.id}
              >
                <dt>
                  {metric.label}
                </dt>
                <dd>
                  {insightValue(metric)}
                </dd>
                <dd
                  className="source-ref"
                >
                  Period:
                  {' '}
                  {metric.period || 'Unavailable'}
                  {' '}
                  ·
                  {' '}
                  {metric.source}
                  {' '}
                  ·
                  {' '}
                  {metric.sourceRef || 'Reference unavailable'}
                </dd>
              </div>)}
            </dl>
            <TransformationTrends
              series={item.series}
            />
            <InsightLinks
              associations={item.associations}
            />
          </article>
        </li>)}
      </ul>
      {state.envelope?.page?.nextCursor && <Link
        to={{
          search: serializeContext(context, {
            applicationId,
            period,
            cursor: state.envelope.page.nextCursor
          })
        }}
      >
        Next transformation records
      </Link>}
      {cursor && <Link
        to={{
          search: serializeContext(context, {
            applicationId,
            period
          })
        }}
      >
        First transformation records
      </Link>}
    </DataState>
  </section>;
}
