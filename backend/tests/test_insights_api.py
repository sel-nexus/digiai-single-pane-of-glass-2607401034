"""Exercise typed insights HTTP contracts and negative branches against actual SQLite."""
import httpx
import pytest
from app.api.insights import get_service
from app.core.config import Settings
from app.main import create_app
from app.domain.insights_service import InsightsService
from app.domain.entity_service import EntityService
from app.domain.kpi_service import KpiService
from test_insights_service import attributes


@pytest.mark.parametrize('path,count', [('recommendations', 3), ('transformation', 2)])
async def test_bounded_real_data_context_and_no_cache(client, path, count):
    response = await client.get(f'/api/v1/{path}', params={'personaId': 'executive', 'application': 'app-0001', 'limit': 1})
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    body = response.json()
    assert body['page'] == {'limit': 1, 'total': count, 'nextCursor': '1'}
    assert body['context']['filters'] == {'application': ['app-0001']}
    assert body['data'][0]['source'] == 'sample'
    assert {link['entityType'] for link in body['data'][0]['associations']} == {'journey', 'application'}


@pytest.mark.parametrize('path', ['recommendations', 'transformation'])
@pytest.mark.parametrize('params,status', [({'limit': 0}, 422), ({'limit': 101}, 422), ({'cursor': '01'}, 422),
    ({'cursor': '-1'}, 422), ({'cursor': '10000000'}, 422), ({'applicationId': ''}, 422),
    ({'applicationId': "app-0001' OR 1=1 --"}, 404), ({'applicationId': '../app-0001'}, 404),
    ({'personaId': 'bad'}, 404)])
async def test_validation_and_security_boundaries(client, path, params, status):
    response = await client.get(f'/api/v1/{path}', params=params)
    assert response.status_code == status
    assert set(response.json()) == {'error'}
    assert 'SELECT' not in response.json()['error']['message']


@pytest.mark.parametrize('path', ['recommendations', 'transformation'])
async def test_unknown_selected_scope_and_no_app_fallback(client, path):
    response = await client.get(f'/api/v1/{path}?unsupported=x')
    assert response.status_code == 200
    body = response.json()
    assert body['data'] == [] and body['availability'] == 'unavailable'
    assert body['unavailableDimensions'] == ['unsupported'] and body['context']['filters'] == {'unsupported': ['x']}
    assert (await client.get(f'/api/v1/{path}?applicationId=app-0002')).json()['data'] == []
    assert (await client.get(f'/api/v1/{path}?application=missing')).json()['data'] == []
    assert (await client.post(f'/api/v1/{path}', json={})).status_code == 405


async def test_reason_missing_and_single_period_source_contract(client):
    recommendations = (await client.get('/api/v1/recommendations')).json()['data']
    assert recommendations[2]['reason'] is None and recommendations[2]['complete'] is False
    assert recommendations[2]['availability'] == 'unavailable'
    transformation = (await client.get('/api/v1/transformation?period=2025-01')).json()['data'][0]
    assert all(metric['value'] is None for metric in transformation['measures'])
    assert len(transformation['series'][0]['points']) == 1
    assert transformation['series'][0]['availability'] == 'unavailable'
    assert (await client.get('/api/v1/transformation?period=%20')).status_code == 422


async def test_di_real_uploaded_evidence_missing_links_and_absent_fields(repository, tmp_path):
    attributes(repository, 'recommendation-1', {'reason': '<script>unsafe</script>'})
    attributes(repository, 'transformation-1', {'measures': {'adoption': {'value': 5}}, 'series': []})
    with repository.transaction() as db:
        db.execute('DELETE FROM relationship WHERE source_entity_id IN (?,?)', ('recommendation-1', 'transformation-1'))
        db.execute('UPDATE entity SET source_kind=?,source_ref=? WHERE id=?', ('uploaded', 'file-1', 'recommendation-1'))
    app = create_app(Settings(database_path=str(tmp_path / 'other.db')))
    app.dependency_overrides[get_service] = lambda: InsightsService(repository, EntityService(repository), KpiService(repository))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as session:
        item = (await session.get('/api/v1/recommendations')).json()['data'][0]
        assert item['reason'] == '<script>unsafe</script>' and item['confidence'] is None
        assert item['source'] == 'uploaded' and item['sourceRef'] == 'file-1' and item['associations'] == []
        item = (await session.get('/api/v1/transformation')).json()['data'][0]
        assert item['series'] == [] and item['associations'] == []
        assert all(metric['value'] is None for metric in item['measures'])
    app.dependency_overrides.clear()
