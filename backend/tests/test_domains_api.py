"""Exercise discovery HTTP contracts against real file SQLite."""
import sqlite3
import pytest


async def test_entities_search_page_and_injection(client):
    """Verify exact IDs, pagination, provenance and literal untrusted search."""
    response = await client.get('/api/v1/entities', params={'type': 'application', 'q': 'MEMBER'})
    assert response.status_code == 200
    assert response.json()['data'][0]['id'] == 'app-0001'
    assert response.json()['data'][0]['source'] == 'sample'
    read_response = await client.get('/api/v1/entities?type=application&limit=1')
    assert read_response.status_code == 200
    first = read_response.json()
    read_response = await client.get('/api/v1/entities', params={'type': 'application', 'limit': 1,
                                                         'cursor': first['page']['nextCursor']})
    assert read_response.status_code == 200
    second = read_response.json()
    assert first['data'][0]['id'] != second['data'][0]['id']
    for q in ("' OR 1=1 --", '<img src=x onerror=alert(1)>', '%'):
        response = await client.get('/api/v1/entities', params={'q': q})
        assert response.status_code == 200
        assert response.json()['data'] == []


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
    assert response.status_code == 200
    assert [item['id'] for item in response.json()['data']] == ['app-0001']
    combined = await client.get('/api/v1/entities', params=params + [('dateRange', '2025-01/2025-02'), ('type', 'application')])
    assert combined.status_code == 200
    assert [item['id'] for item in combined.json()['data']] == ['app-0001']
    response = await client.get('/api/v1/entities', params=params + [('dateRange', 'absent')])
    assert response.status_code == 200
    assert response.json()['data'] == []
    assert response.json()['unavailableDimensions'] == []
    response = await client.get('/api/v1/entities?application=missing')
    assert response.status_code == 200
    assert response.json()['availability'] == 'available' and response.json()['data'] == []
    read_response = await client.get('/api/v1/filters/options', params=params)
    assert read_response.status_code == 200
    options = read_response.json()
    assert len(options['data']) == 8 and options['data']['environment'][0]['id'] == 'prod'


async def test_hierarchy_exact_parent_ancestry_and_validation(client):
    """Validate represented hierarchy roots, leaves and missing parents."""
    read_response = await client.get('/api/v1/hierarchy')
    assert read_response.status_code == 200
    roots = read_response.json()
    assert roots['data'][0]['level'] == 'domain'
    read_response = await client.get('/api/v1/hierarchy?parentId=env-0001')
    assert read_response.status_code == 200
    leaf = read_response.json()
    assert leaf['data'] == [] and len(leaf['ancestry']) == 5
    response = await client.get('/api/v1/hierarchy?parentId=missing')
    assert response.status_code == 404
    response = await client.get('/api/v1/hierarchy?parentId=')
    assert response.status_code == 422
    response = await client.get('/api/v1/hierarchy?limit=101')
    assert response.status_code == 422
    response = await client.get('/api/v1/hierarchy?cursor=bad')
    assert response.status_code == 422


@pytest.mark.parametrize('failure_boundary', ['read', 'options'])
async def test_filter_options_read_failure_preserves_real_database(client, monkeypatch, failure_boundary):
    """Do not return ordinary fixture options when the read boundary fails."""
    state = client._transport.app.state
    repository = state.repository
    tables = ('entity', 'relationship', 'app_config', 'audit_event')
    before = {table: repository.read(f'SELECT * FROM {table} ORDER BY id') for table in tables}
    assert before['entity'] and before['app_config'] and before['audit_event'] == []
    def unavailable(*args, **kwargs):
        raise sqlite3.OperationalError('filter read unavailable')
    with monkeypatch.context() as patch:
        boundary = repository if failure_boundary == 'read' else state.entity_service
        patch.setattr(boundary, failure_boundary, unavailable)
        response = await client.get('/api/v1/filters/options', params={'application': 'app-0001'})
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'
        assert 'data' not in response.json()
    assert {table: repository.read(f'SELECT * FROM {table} ORDER BY id') for table in tables} == before
    response = await client.get('/api/v1/filters/options')
    assert response.status_code == 200
    assert len(response.json()['data']) == 8
