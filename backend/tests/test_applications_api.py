"""Exercise the exact Application 360 HTTP contract with real SQLite."""
from urllib.parse import quote
import pytest


@pytest.mark.asyncio
async def test_profile_returns_eleven_categories_and_exact_source(client):
    """Return supplied profile data at the canonical versioned route."""
    response = await client.get('/api/v1/applications/app-0001')
    assert response.status_code == 200
    body = response.json()
    assert body['data']['id'] == 'app-0001'
    assert len(body['data']['categories']) == 11
    assert body['data']['categories']['health']['value'][0]['value'] == 'Warning (sample)'
    assert body['data']['categories']['defects']['value'][0]['association'] == 'entity:defect-1.applicationId'
    assert response.headers['cache-control'] == 'no-store'


@pytest.mark.asyncio
async def test_partial_application_returns_null_not_another_app(client):
    """Keep sibling health and security evidence absent."""
    response = await client.get('/api/v1/applications/app-0002')
    assert response.status_code == 200
    body = response.json()['data']
    assert body['id'] == 'app-0002'
    assert body['categories']['health'] == {'availability': 'unavailable', 'value': None}
    assert body['categories']['securityPosture']['value'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('identifier', ['missing', 'release-1', "' OR 1=1 --", '<img onerror=alert(1)>'])
async def test_unknown_wrong_type_and_unsafe_ids_return_404(client, identifier):
    """Expose public not-found errors without interpreting opaque identities."""
    response = await client.get('/api/v1/applications/' + quote(identifier, safe=''))
    assert response.status_code == 404
    assert response.json()['error']['code'] == 'RESOURCE_NOT_FOUND'
    assert 'sqlite' not in response.text.lower()


@pytest.mark.asyncio
async def test_scope_mismatch_and_unsupported_dimension_are_null(client):
    """Preserve selected scope rather than returning an unfiltered profile."""
    response = await client.get('/api/v1/applications/app-0001?application=app-0002')
    assert response.status_code == 200
    assert response.json()['data'] is None
    response = await client.get('/api/v1/applications/app-0002?dateRange=missing')
    assert response.status_code == 200
    assert response.json() == {'data': None, 'availability': 'unavailable', 'unavailableDimensions': ['dateRange']}


@pytest.mark.asyncio
async def test_invalid_context_returns_422(client):
    """Use common validation errors for malformed context values."""
    response = await client.get('/api/v1/applications/app-0001?personaId=')
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_REQUEST'
