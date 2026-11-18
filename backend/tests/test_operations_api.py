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
    assert {item['value']['id'] for item in selected.json()['data'][0]['businessContext']['value']} == {'app-0001', 'api-enrollment', 'journey-enrollment'}
    absent = await client.get('/api/v1/operations/incidents?incidentId=ticket-2')
    assert absent.json()['data'][0]['businessContext'] == {'availability': 'unavailable', 'value': None}
    types = await client.get('/api/v1/operations/incidents?recordType=problem_rca')
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
    assert absent.json()['data'] == [] and absent.json()['availability'] == 'unavailable'
    excluded = await client.get('/api/v1/operations/correlations?incidentId=ticket-1&application=app-0002')
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
    assert all(row['value'] is None and row['period'] == 'week' for row in week.json()['data'])
    scoped = await client.get('/api/v1/operations/metrics?application=app-0002')
    assert all(row['value'] is None for row in scoped.json()['data'])


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
    assert missing.json()['data'] == [] and missing.json()['availability'] == 'unavailable'


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
    assert response.status_code == 422 and response.json()['error']['code'] == 'INVALID_REQUEST'


@pytest.mark.asyncio
async def test_required_incident_and_invalid_period(client):
    """Reject absent correlation identity and unsupported reporting periods."""
    assert (await client.get('/api/v1/operations/correlations')).status_code == 422
    assert (await client.get('/api/v1/operations/metrics?period=year')).status_code == 422
