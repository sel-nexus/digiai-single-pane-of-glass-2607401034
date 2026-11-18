"""Exercise persona delivery HTTP contracts against lifespan-seeded file SQLite."""
import httpx
import pytest


async def test_catalog_is_approved_and_health_is_live(client: httpx.AsyncClient) -> None:
    """Return configured personas and dependency-free process liveness."""
    response = await client.get('/api/v1/personas')
    assert response.status_code == 200
    assert [item['id'] for item in response.json()['data']] == ['executive', 'operations', 'engineering', 'administrator']
    assert response.headers['cache-control'] == 'no-store'
    health = await client.get('/api/health')
    assert health.status_code == 200
    assert health.json() == {'status': 'ok'}


async def test_dashboard_preserves_precision_and_provenance(client: httpx.AsyncClient) -> None:
    """Keep supplied numeric precision unchanged on the public wire."""
    response = await client.get('/api/v1/dashboard', params={'personaId': 'executive'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['persona']['id'] == 'executive'
    assert {widget['id'] for widget in data['widgets']} == {'availability', 'sla', 'adoption'}
    metric = data['widgets'][0]['metric']
    assert metric['value'] == 99.23456
    assert metric['period'] == 'month'
    assert metric['unit'] == '%'
    assert metric['source'] == 'sample'
    assert metric['sourceRef'] == 'sample-kpi-availability'


async def test_persona_switch_read_is_isolated(client: httpx.AsyncClient) -> None:
    """Ensure engineering reads do not overwrite executive configuration."""
    engineering = await client.get('/api/v1/dashboard?personaId=engineering')
    assert engineering.status_code == 200
    assert {w['id'] for w in engineering.json()['data']['widgets']} == {'pipeline', 'test', 'critical'}
    executive = await client.get('/api/v1/dashboard?personaId=executive')
    assert executive.status_code == 200
    assert {w['id'] for w in executive.json()['data']['widgets']} == {'availability', 'sla', 'adoption'}


@pytest.mark.parametrize('query', ['', '?personaId=', '?personaId=' + 'x' * 101, '?personaId=executive&period=year'])
async def test_dashboard_invalid_queries_are_actionable(client: httpx.AsyncClient, query: str) -> None:
    """Reject missing, blank, oversized and unsupported query values."""
    response = await client.get('/api/v1/dashboard' + query)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_REQUEST'
    assert response.json()['error']['details']['issues']


@pytest.mark.parametrize('persona', ['unknown', "executive' OR 1=1--", '../../secret'])
async def test_unknown_persona_is_not_found_without_sql_or_path_expansion(client: httpx.AsyncClient, persona: str) -> None:
    """Treat malicious-looking identifiers as opaque bound values."""
    response = await client.get('/api/v1/dashboard', params={'personaId': persona})
    assert response.status_code == 404
    assert response.json()['error']['code'] == 'RESOURCE_NOT_FOUND'
    catalog = await client.get('/api/v1/personas')
    assert catalog.status_code == 200
    assert len(catalog.json()['data']) == 4


async def test_kpis_missing_period_and_missing_value_are_null(client: httpx.AsyncClient) -> None:
    """Never substitute monthly values into unsupported weekly evidence."""
    response = await client.get('/api/v1/kpis?family=enterprise&period=week')
    assert response.status_code == 200
    assert response.json()['data']
    assert all(m['value'] is None and m['availability'] == 'unavailable' and m['period'] == 'week' for m in response.json()['data'])
    month = await client.get('/api/v1/kpis?family=enterprise')
    assert month.status_code == 200
    assert next(m for m in month.json()['data'] if m['id'] == 'mttr')['value'] is None


@pytest.mark.parametrize('query', ['', '?family=invalid', '?family=qe&period=year', '?family=enterprise&personaId=unknown'])
async def test_kpi_invalid_context_is_rejected(client: httpx.AsyncClient, query: str) -> None:
    """Validate required family, exact period and optional persona context."""
    response = await client.get('/api/v1/kpis' + query)
    assert response.status_code == (404 if 'unknown' in query else 422)
    assert 'error' in response.json()


async def test_all_scope_dimensions_are_explicitly_unavailable(client: httpx.AsyncClient) -> None:
    """Preserve unsupported selected scope instead of showing unfiltered evidence."""
    dimensions = ['domain', 'portfolio', 'application', 'environment', 'criticality', 'dateRange', 'toolSource', 'incidentSeverity']
    params = [('personaId', 'executive'), ('hierarchyNodeId', 'app-0001')] + [(key, 'opaque') for key in dimensions] + [('domain', 'second')]
    response = await client.get('/api/v1/dashboard', params=params)
    assert response.status_code == 200
    assert response.json()['availability'] == 'unavailable'
    assert set(response.json()['unavailableDimensions']) == set(dimensions + ['hierarchyNodeId'])
    assert all(w['metric']['value'] is None for w in response.json()['data']['widgets'])


async def test_other_domain_apis_are_not_implemented(client: httpx.AsyncClient) -> None:
    """Keep discovery and other feature routes out of the persona slice."""
    response = await client.get('/api/v1/entities?type=application')
    assert response.status_code == 404
    assert 'error' in response.json()
