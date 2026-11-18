"""Exercise discovery HTTP contracts against real file SQLite."""
import pytest


async def test_entities_search_page_and_injection(client):
    """Verify exact IDs, pagination, provenance and literal untrusted search."""
    response = await client.get('/api/v1/entities', params={'type': 'application', 'q': 'MEMBER'})
    assert response.status_code == 200
    assert response.json()['data'][0]['id'] == 'app-0001'
    assert response.json()['data'][0]['source'] == 'sample'
    first = (await client.get('/api/v1/entities?type=application&limit=1')).json()
    second = (await client.get('/api/v1/entities', params={'type': 'application', 'limit': 1,
                                                         'cursor': first['page']['nextCursor']})).json()
    assert first['data'][0]['id'] != second['data'][0]['id']
    for q in ("' OR 1=1 --", '<img src=x onerror=alert(1)>', '%'):
        response = await client.get('/api/v1/entities', params={'q': q})
        assert response.status_code == 200 and response.json()['data'] == []


@pytest.mark.parametrize('query', ['type=bad', 'limit=0', 'limit=101', 'limit=1.5', 'cursor=-1',
                                   'cursor=01', 'cursor=abc', 'cursor=10000000', 'q=' + 'x' * 201])
async def test_invalid_queries_have_problem_envelope(client, query):
    """Reject invalid boundaries with public errors rather than storage failures."""
    response = await client.get('/api/v1/entities?' + query)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_REQUEST'


async def test_all_dimensions_scope_empty_unsupported_and_options(client):
    """Keep all eight selected dimensions, repeated OR values and unavailable status."""
    params = [('domain', 'domain-member'), ('portfolio', 'portfolio-digital'), ('application', 'app-0001'),
              ('application', 'missing'), ('environment', 'prod'), ('criticality', 'high'),
              ('toolSource', 'sample-monitor'), ('incidentSeverity', 'Sev1')]
    response = await client.get('/api/v1/entities', params=params + [('type', 'application')])
    assert [item['id'] for item in response.json()['data']] == ['app-0001']
    combined = await client.get('/api/v1/entities', params=params + [('dateRange', '2025-01/2025-02'), ('type', 'application')])
    assert [item['id'] for item in combined.json()['data']] == ['app-0001']
    response = await client.get('/api/v1/entities', params=params + [('dateRange', 'absent')])
    assert response.json()['data'] == []
    assert response.json()['unavailableDimensions'] == []
    response = await client.get('/api/v1/entities?application=missing')
    assert response.json()['availability'] == 'available' and response.json()['data'] == []
    options = (await client.get('/api/v1/filters/options', params=params)).json()
    assert len(options['data']) == 8 and options['data']['environment'][0]['id'] == 'prod'


async def test_hierarchy_exact_parent_ancestry_and_validation(client):
    """Validate represented hierarchy roots, leaves and missing parents."""
    roots = (await client.get('/api/v1/hierarchy')).json()
    assert roots['data'][0]['level'] == 'domain'
    leaf = (await client.get('/api/v1/hierarchy?parentId=env-0001')).json()
    assert leaf['data'] == [] and len(leaf['ancestry']) == 5
    assert (await client.get('/api/v1/hierarchy?parentId=missing')).status_code == 404
    assert (await client.get('/api/v1/hierarchy?parentId=')).status_code == 422
    assert (await client.get('/api/v1/hierarchy?limit=101')).status_code == 422
    assert (await client.get('/api/v1/hierarchy?cursor=bad')).status_code == 422
