"""Exercise readiness HTTP contracts against lifespan-owned real SQLite."""
import pytest


async def test_evidence_contract_provenance_and_exact_scope(client):
    """Return five typed source categories and reject mismatched identities."""
    response = await client.get('/api/v1/readiness/evidence', params={'applicationId': 'app-0001', 'releaseId': 'release-1', 'personaId': 'engineering'})
    assert response.status_code == 200
    record = response.json()['data'][0]
    assert record['application']['id'] == 'app-0001'
    assert set(record['categories']) == {'build', 'test', 'security', 'change', 'environment'}
    assert record['categories']['build']['value'][0]['sourceRef'] == 'sample-v1'
    assert record['categories']['build']['value'][0]['value'] == {'status': 'Passed (sample)'}
    assert 'gate' not in record and 'score' not in record
    for params in ({'applicationId': 'app-0002', 'releaseId': 'release-1'}, {'releaseId': "' OR 1=1--"}, {'applicationId': 'unknown'}, {'personaId': 'unknown'}):
        failed = await client.get('/api/v1/readiness/evidence', params=params)
        assert failed.status_code == 404 and failed.json()['error']['code'] == 'RESOURCE_NOT_FOUND'
    empty = await client.get('/api/v1/readiness/evidence', params={'applicationId': 'app-0002'})
    assert empty.json()['data'] == [] and empty.json()['page']['total'] == 0


@pytest.mark.parametrize('family,count', [('release', 5), ('qe', 5), ('security', 4)])
async def test_metrics_family_period_and_page(client, family, count):
    """Keep named counts, source precision and exact period without fallback."""
    response = await client.get('/api/v1/readiness/metrics', params={'family': family})
    assert response.status_code == 200
    body = response.json()
    assert len(body['data']) == count and body['page']['total'] == count
    assert all(item['family'] == family and item['period'] == 'month' for item in body['data'])
    if family == 'release':
        assert next(item for item in body['data'] if item['id'] == 'pipeline')['value'] == 97.1234
    week = (await client.get('/api/v1/readiness/metrics', params={'family': family, 'period': 'week'})).json()
    assert len(week['data']) == count
    assert all(item['value'] is None and item['sourceRef'] is None and item['period'] == 'week' for item in week['data'])
    first = (await client.get('/api/v1/readiness/metrics', params={'family': family, 'limit': 2})).json()
    assert first['page']['nextCursor'] == '2'
    second = (await client.get('/api/v1/readiness/metrics', params={'family': family, 'limit': 2, 'cursor': '2'})).json()
    assert not {item['id'] for item in first['data']} & {item['id'] for item in second['data']}


@pytest.mark.parametrize('path,params', [('/evidence', {'period': 'year'}), ('/evidence', {'limit': 101}), ('/evidence', {'cursor': '01'}), ('/evidence', {'cursor': '0;DROP TABLE entity'}), ('/evidence', {'applicationId': ''}), ('/metrics', {}), ('/metrics', {'family': 'enterprise'}), ('/metrics', {'family': 'security', 'period': 'year'})])
async def test_invalid_inputs_use_envelope(client, path, params):
    """Reject malformed controls without accepting SQL-like cursor syntax."""
    response = await client.get('/api/v1/readiness' + path, params=params)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_REQUEST'


@pytest.mark.parametrize('path,extra', [('/evidence', {}), ('/metrics', {'family': 'release'})])
async def test_shared_filters_unsupported_and_injection_empty(client, path, extra):
    """Retain unsupported dimension disclosure and never widen empty scope."""
    for params in ({'domain': "' OR 1=1--"}, {'application': 'app-0002'}):
        response = await client.get('/api/v1/readiness' + path, params=extra | params)
        assert response.status_code == 200 and response.json()['data'] == []
    unsupported = (await client.get('/api/v1/readiness' + path, params=extra | {'undefinedDimension': 'x'})).json()
    assert unsupported['data'] == [] and unsupported['unavailableDimensions'] == ['undefinedDimension']
    scoped = await client.get('/api/v1/readiness' + path, params=list(extra.items()) + [('application', 'app-0002'), ('application', 'app-0001'), ('domain', 'domain-member'), ('hierarchyNodeId', 'service-enrollment')])
    assert scoped.status_code == 200 and scoped.json()['data']
