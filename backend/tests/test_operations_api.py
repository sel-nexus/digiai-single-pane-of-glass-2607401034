"""Exercise all four operations HTTP contracts against real SQLite."""
import pytest
from app.domain.operations_service import MEASURES


@pytest.mark.asyncio
async def test_incidents_types_selection_and_context(client):
    """Return distinct records and exact source-associated context."""
    response = await client.get('/api/v1/operations/incidents')
    assert response.status_code == 200
    body = response.json()
    assert {row['recordType'] for row in body['data']} == {'incident', 'problem_rca', 'major_incident'}
    assert body['page']['total'] == 5
    assert response.headers['cache-control'] == 'no-store'
    selected = await client.get('/api/v1/operations/incidents?incidentId=ticket-1')
    assert selected.status_code == 200
    assert {item['value']['id'] for item in selected.json()['data'][0]['businessContext']['value']} == {'app-0001', 'api-enrollment', 'journey-enrollment'}
    absent = await client.get('/api/v1/operations/incidents?incidentId=ticket-2')
    assert absent.status_code == 200
    assert absent.json()['data'][0]['businessContext'] == {'availability': 'unavailable', 'value': None}
    types = await client.get('/api/v1/operations/incidents?recordType=problem_rca')
    assert types.status_code == 200
    assert len(types.json()['data']) == 2


@pytest.mark.asyncio
async def test_correlations_exact_sources_no_link_and_scope(client):
    """Expose represented links, never a diagnosis or inferred association."""
    response = await client.get('/api/v1/operations/correlations?incidentId=ticket-1&limit=1')
    assert response.status_code == 200
    body = response.json()
    assert body['incidentId'] == 'ticket-1' and body['page']['total'] == 2
    assert body['data'][0]['relationshipLabel'] == 'represented correlation'
    assert body['data'][0]['evidence']['sourceRef'] == 'sample-v1'
    assert body['data'][0]['evidence']['association'] == 'relationship:rel-3'
    absent = await client.get('/api/v1/operations/correlations?incidentId=ticket-2')
    assert absent.status_code == 200
    assert absent.json()['data'] == [] and absent.json()['availability'] == 'unavailable'
    excluded = await client.get('/api/v1/operations/correlations?incidentId=ticket-1&application=app-0002')
    assert excluded.status_code == 200
    assert excluded.json()['data'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('identifier', ['unknown', 'finding-1', 'app-0001', "' OR 1=1 --", '<script>'])
async def test_unknown_wrong_type_and_security_ids(client, identifier):
    """Keep SQL/markup injection and security findings outside incident identity."""
    for endpoint in ('incidents', 'correlations'):
        response = await client.get('/api/v1/operations/' + endpoint, params={'incidentId': identifier})
        assert response.status_code == 404
        assert response.json()['error']['code'] == 'RESOURCE_NOT_FOUND'


@pytest.mark.asyncio
async def test_metrics_exact_nine_and_unavailable_period(client):
    """Return supplied units/precision only and name all absent measures."""
    response = await client.get('/api/v1/operations/metrics')
    assert response.status_code == 200
    metrics = response.json()['data']
    assert tuple(row['label'] for row in metrics) == MEASURES
    assert metrics[0]['value'] == 99.23456 and metrics[0]['unit'] == '%'
    assert metrics[5]['value'] is None and metrics[5]['availability'] == 'unavailable'
    week = await client.get('/api/v1/operations/metrics?period=week')
    assert week.status_code == 200
    assert all(row['value'] is None and row['period'] == 'week' for row in week.json()['data'])
    scoped = await client.get('/api/v1/operations/metrics?application=app-0002')
    assert scoped.status_code == 200
    assert all(row['value'] is None for row in scoped.json()['data'])


@pytest.mark.asyncio
@pytest.mark.parametrize('value', ['87.9950000000000000001', '0'])
async def test_scoped_uploaded_metric_has_no_competing_family_placeholder(client, tmp_path, value):
    """Keep exact uploaded evidence instead of a same-label out-of-scope descriptor."""
    from app.storage.sqlite_repository import SqliteRepository

    store = SqliteRepository(str(tmp_path / 'api.db'))
    with store.transaction() as db:
        db.execute('INSERT INTO metric (id,name,family,value_text,unit,period,entity_id,availability,dataset_version_id,source_kind,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                   ('uploaded-availability', 'Availability %', 'reliability', value, '%', 'month',
                    'app-0002', 'available', 'sample-v1', 'uploaded', 'uploaded-metrics.csv'))
    for scope in ({'application': 'app-0002'}, {'hierarchyNodeId': 'app-0002'}):
        response = await client.get('/api/v1/operations/metrics', params=scope)
        assert response.status_code == 200
        body = response.json()
        rows = [row for row in body['data'] if row['label'] == 'Availability %']
        assert len(rows) == 1
        assert rows[0] == {'id': 'uploaded-availability', 'label': 'Availability %', 'family': 'reliability',
                           'value': value, 'unit': '%', 'period': 'month', 'availability': 'available',
                           'source': 'uploaded', 'sourceRef': 'uploaded-metrics.csv'}
        assert body['availability'] == 'available'
        assert body['page']['total'] == len(MEASURES)
        first = await client.get('/api/v1/operations/metrics', params=scope | {'limit': 1})
        assert first.status_code == 200
        assert first.json()['data'] == rows
    for query in ({'application': 'app-0001'}, {'application': 'app-0002', 'period': 'week'}):
        response = await client.get('/api/v1/operations/metrics', params=query)
        assert response.status_code == 200
        assert all(row['sourceRef'] != 'uploaded-metrics.csv' for row in response.json()['data'])
    assert store.read('SELECT value_text FROM metric WHERE id=?', ('uploaded-availability',))[0]['value_text'] == value


@pytest.mark.asyncio
async def test_observability_summary_context_and_no_association(client):
    """Return only supplied signals with explicit app/service references."""
    response = await client.get('/api/v1/operations/observability?limit=1')
    assert response.status_code == 200
    assert response.json()['page']['total'] == 2
    row = response.json()['data'][0]
    assert row['evidence']['value'][0]['sourceRef'] == 'sample-v1'
    assert {item['value']['id'] for item in row['businessContext']['value']} == {'app-0001', 'service-enrollment'}
    missing = await client.get('/api/v1/operations/observability?application=app-0002')
    assert missing.status_code == 200
    assert missing.json()['data'] == [] and missing.json()['availability'] == 'unavailable'


@pytest.mark.asyncio
@pytest.mark.parametrize('params,location,message', [
    ({'limit': 0}, 'limit', 'Input should be greater than or equal to 1'),
    ({'limit': 101}, 'limit', 'Input should be less than or equal to 100'),
    ({'cursor': '01'}, 'cursor', "String should match pattern '^(0|[1-9][0-9]{0,6})$'"),
])
async def test_observability_rejects_invalid_pagination(client, params, location, message):
    """Validate observability pagination at its real HTTP boundary."""
    response = await client.get('/api/v1/operations/observability', params=params)
    assert response.status_code == 422
    assert response.json() == {'error': {'code': 'INVALID_REQUEST',
                                       'message': 'Check the supplied query parameters.',
                                       'details': {'issues': [{'location': ['query', location], 'message': message}]}}}


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', ['incidents', 'correlations?incidentId=ticket-1', 'metrics', 'observability'])
async def test_unsupported_filters_are_unavailable(client, endpoint):
    """Never ignore an unsupported selected dimension."""
    separator = '&' if '?' in endpoint else '?'
    response = await client.get('/api/v1/operations/' + endpoint + separator + 'unsupported=x')
    assert response.status_code == 200
    body = response.json()
    assert body['availability'] == 'unavailable' and body['unavailableDimensions'] == ['unsupported']
    assert not body['data'] or all(row['value'] is None for row in body['data'])


@pytest.mark.asyncio
@pytest.mark.parametrize('query', ['limit=0', 'limit=101', 'cursor=01', 'cursor=-1', 'recordType=security_finding', 'personaId='])
async def test_invalid_list_inputs(client, query):
    """Reject malformed bounds, types and context through public validation."""
    response = await client.get('/api/v1/operations/incidents?' + query)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_REQUEST'


@pytest.mark.asyncio
async def test_required_incident_and_invalid_period(client):
    """Reject absent correlation identity and unsupported reporting periods."""
    correlations = await client.get('/api/v1/operations/correlations')
    assert correlations.status_code == 422
    period = await client.get('/api/v1/operations/metrics?period=year')
    assert period.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', ['/api/v1/kpis', '/api/v1/operations/metrics'])
async def test_twoapps_exact_sources_scope_hierarchy_and_period(client, tmp_path, endpoint):
    """Exercise duplicate labels through both real public reliability read contracts."""
    from app.storage.sqlite_repository import SqliteRepository
    from tests.test_kpi_scope import seed_twoapps
    store = SqliteRepository(str(tmp_path / 'api.db'))
    seed_twoapps(store)
    base = {'family': 'reliability'} if endpoint.endswith('/kpis') else {}
    expected = {'a-month': ('99.2345600000000000001', 'uploaded', 'csv-source-a'),
                'b-month': ('87.9950000000000000001', 'local', 'xlsx-source-b')}
    for query, ids in [({}, set(expected)), ({'application': 'app-0001'}, {'a-month'}),
                       ({'application': 'app-0002'}, {'b-month'}),
                       ({'hierarchyNodeId': 'app-0001'}, {'a-month'}),
                       ({'hierarchyNodeId': 'app-0002'}, {'b-month'}),
                       ({'hierarchyNodeId': 'service-enrollment'}, set(expected)),
                       ({'application': 'missing'}, set())]:
        response = await client.get(endpoint, params=base | query)
        assert response.status_code == 200
        body = response.json()
        rows = [row for row in body['data'] if row['availability'] == 'available']
        assert {row['id'] for row in rows} == ids
        assert all((row['value'], row['source'], row['sourceRef']) == expected[row['id']] for row in rows)
        assert body['availability'] == ('available' if ids or endpoint.endswith('/kpis') else 'unavailable')
    week = await client.get(endpoint, params=base | {'application': 'app-0002', 'period': 'week'})
    assert week.status_code == 200
    assert week.json()['availability'] == 'unavailable'
    assert all(row['value'] is None and row['sourceRef'] is None and row['period'] == 'week' for row in week.json()['data'])
    supplied_week = await client.get(endpoint, params=base | {'application': 'app-0001', 'period': 'week'})
    assert supplied_week.status_code == 200
    available = [row for row in supplied_week.json()['data'] if row['availability'] == 'available']
    assert len(available) == 1 and available[0]['value'] == '91.125'
    assert available[0]['sourceRef'] == 'csv-week-a'
    assert store.read("SELECT value_text FROM metric WHERE id='a-month'")[0]['value_text'] == expected['a-month'][0]
