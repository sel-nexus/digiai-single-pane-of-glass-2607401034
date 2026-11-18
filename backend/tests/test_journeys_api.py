"""Exercise journey HTTP contracts against lifespan-owned real SQLite."""
import pytest


async def test_list_detail_and_independent_overlays(client):
    """Verify bounded list identity, exact directed rows and source availability."""
    first = await client.get('/api/v1/journeys?limit=1')
    assert first.status_code == 200
    body = first.json()
    assert body['page'] == {'limit': 1, 'nextCursor': '1', 'total': 2}
    second = (await client.get('/api/v1/journeys?limit=1&cursor=1')).json()
    assert second['data'][0]['id'] != body['data'][0]['id']
    detail = await client.get('/api/v1/journeys/journey-enrollment')
    assert detail.status_code == 200 and detail.headers['cache-control'] == 'no-store'
    data = detail.json()['data']
    assert data['id'] == 'journey-enrollment' and data['source'] == 'sample'
    assert data['dependency']['availability'] == 'available'
    assert all(row['type'] == 'depends_on' for row in data['dependency']['value'])
    assert all(row['type'] == 'impact' for row in data['impactOverlay']['value'])
    assert data['dependency']['value'][1]['target']['entityType'] == 'api'
    assert data['dependency']['value'][1]['sourceEntityId'] == 'app-0001'
    assert data['impact'] == {'availability': 'unavailable', 'value': None}
    assert all(row['sourceRef'] == 'sample-v1' for row in data['relationships'])


@pytest.mark.parametrize('query', ['limit=0', 'limit=101', 'limit=1.5', 'cursor=-1', 'cursor=01', 'cursor=bad', 'cursor=10000000'])
async def test_invalid_page_contract(client, query):
    """Reject unbounded or noncanonical pages with public validation errors."""
    response = await client.get('/api/v1/journeys?' + query)
    assert response.status_code == 422 and response.json()['error']['code'] == 'INVALID_REQUEST'


@pytest.mark.parametrize('identifier', ['missing', 'app-0001', "' OR 1=1 --"])
async def test_unknown_or_wrong_type_is_404(client, identifier):
    """Never treat a SQL-like string or another entity class as a journey."""
    response = await client.get('/api/v1/journeys/' + identifier)
    assert response.status_code == 404 and response.json()['error']['code'] == 'RESOURCE_NOT_FOUND'


async def test_missing_relationships_and_shared_scope(client):
    """Preserve unavailable overlays, empty scopes and unsupported dimensions."""
    empty = (await client.get('/api/v1/journeys/journey-renewal')).json()['data']
    assert empty['relationships'] == [] and empty['dependency']['value'] is None
    assert empty['impactOverlay']['availability'] == 'unavailable'
    scoped = await client.get('/api/v1/journeys', params=[('application', 'app-0001'), ('application', 'missing'),
                              ('hierarchyNodeId', 'service-enrollment'), ('toolSource', 'sample-monitor')])
    assert [row['id'] for row in scoped.json()['data']] == ['journey-enrollment']
    excluded = await client.get('/api/v1/journeys/journey-enrollment?application=app-0002')
    assert excluded.status_code == 200 and excluded.json()['data'] is None
    assert (await client.get('/api/v1/journeys?application=missing')).json()['data'] == []
    unsupported = await client.get('/api/v1/journeys/journey-renewal?dateRange=missing')
    assert unsupported.json()['unavailableDimensions'] == ['dateRange']
    assert unsupported.json()['availability'] == 'unavailable'
