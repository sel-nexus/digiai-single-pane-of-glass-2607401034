"""Exercise every administrator endpoint against lifespan-initialized real SQLite."""
import sqlite3
import pytest
from app.api.admin import get_config_service
from app.schemas.admin import AdminFailure

ACTOR = {'personaId': 'administrator'}
WRITES = [
    ('post', '/admin/kpis', {'metricId': 'availability', 'label': 'Supplied uptime', 'title': 'Uptime', 'actor': ACTOR}),
    ('post', '/admin/scenarios', {'scenarioId': 'enrollment', 'label': 'Ops review', 'description': 'Supplied', 'destination': '/operations', 'actor': ACTOR}),
    ('post', '/admin/mappings', {'relationshipId': 'rel-0', 'sourceEntityId': 'journey-renewal', 'targetEntityId': 'app-0002', 'type': 'impact', 'actor': ACTOR}),
    ('put', '/admin/personas/executive/widgets/availability', {'visible': False, 'actor': ACTOR}),
]


@pytest.mark.parametrize('method,path,payload', WRITES)
async def test_every_write_confirmed_requery_and_audit(client, method, path, payload):
    """Verify returned persisted config, timestamp/mock actor and visible reads."""
    response = await getattr(client, method)('/api/v1' + path, json=payload)
    assert response.status_code == 200
    result = response.json()['data']
    assert result['saved'] and result['outcome'] == 'success'
    audit = (await client.get('/api/v1/admin/audit', params={'target': result['configId'], 'persona': 'administrator'})).json()
    assert audit['total'] == 1 and audit['data'][0]['id'] == result['auditId']
    assert audit['data'][0]['occurredAt'] and audit['data'][0]['actor']['userId'] == 'demo-operator'
    catalog = (await client.get('/api/v1/admin/config')).json()['data']
    dashboard = (await client.get('/api/v1/dashboard', params={'personaId': 'executive'})).json()['data']
    if '/kpis' in path:
        assert dashboard['widgets'][0]['title'] == 'Uptime'
        assert dashboard['widgets'][0]['metric']['value'] == 99.23456
    elif '/widgets/' in path:
        assert 'availability' not in [w['id'] for w in dashboard['widgets']]
        other = (await client.get('/api/v1/dashboard', params={'personaId': 'operations'})).json()['data']
        assert 'availability' in [w['id'] for w in other['widgets']]
    elif '/scenarios' in path:
        assert dashboard['scenarios'][0]['label'] == 'Ops review'
    else:
        assert next(r for r in catalog['relationships'] if r['relationshipId'] == 'rel-0')['targetEntityId'] == 'app-0002'


@pytest.mark.parametrize('method,path,payload', WRITES)
@pytest.mark.parametrize('mutation', ['extra', 'missing', 'wrong_type'])
async def test_every_write_rejects_invalid_shapes_without_audit(client, method, path, payload, mutation):
    """Reject unsupported fields and invalid required types before writes."""
    body = dict(payload)
    if mutation == 'extra':
        body['formula'] = 'DROP TABLE metric'
    elif mutation == 'missing':
        body.pop('actor')
    else:
        body['actor'] = 7
    response = await getattr(client, method)('/api/v1' + path, json=body)
    assert response.status_code == 422 and response.json()['error']['details']['issues']
    assert (await client.get('/api/v1/admin/audit')).json()['total'] == 0


@pytest.mark.parametrize('destination', ['https://evil.example', '//evil.example', '/operations/../admin', '/operations?redirect=https://evil.example', '/journeys/unknown', '/%2e%2e/admin', "';DROP TABLE entity;--"])
async def test_scenario_redirect_injection_rejected(client, destination):
    """Arbitrary/external/path destinations never become stored navigation."""
    response = await client.post('/api/v1/admin/scenarios', json={**WRITES[1][2], 'destination': destination})
    assert response.status_code == 422
    assert response.json()['error']['details']['issues'][0]['field'] == 'destination'
    assert (await client.get('/api/v1/admin/audit')).json()['total'] == 0


@pytest.mark.parametrize('method,path,payload,field', [(m,p,b,next((k for k in b if k.endswith('Id')), 'actor')) for m,p,b in WRITES[:3]])
async def test_unknown_ids_and_sql_injection(client, method, path, payload, field):
    """Unknown IDs return 404 and malformed identifiers cannot alter SQL."""
    for bad, expected in [('unknown', 404), ("x';DROP TABLE entity;--", 422), ('../admin', 422)]:
        response = await getattr(client, method)('/api/v1' + path, json={**payload, field: bad})
        assert response.status_code == expected
    assert (await client.get('/api/v1/admin/config')).status_code == 200
    assert (await client.get('/api/v1/admin/audit')).json()['total'] == 0


async def test_widget_unknown_persona_widget_and_strict_boolean(client):
    """Reject unknown isolated catalog entries and truthy non-booleans."""
    for path in ['/admin/personas/unknown/widgets/availability', '/admin/personas/engineering/widgets/availability']:
        assert (await client.put('/api/v1' + path, json=WRITES[3][2])).status_code == 404
    for visible in ['false', 0, None]:
        assert (await client.put('/api/v1' + WRITES[3][1], json={'visible': visible, 'actor': ACTOR})).status_code == 422


async def test_audit_bounds_unknown_filter_and_blocked_export(client):
    """Expose empty reads and actionable 409 without a fake artifact."""
    response = await client.get('/api/v1/admin/audit', params={'eventType': 'annotation', 'target': 'unknown', 'persona': 'executive', 'limit': 1})
    assert response.status_code == 200 and response.json()['data'] == []
    for params in [{'limit': 0}, {'limit': 101}, {'offset': -1}, {'offset': 10001}, {'eventType': 'delete'}, {'target': "';DROP TABLE audit_event;--"}]:
        assert (await client.get('/api/v1/admin/audit', params=params)).status_code == 422
    response = await client.post('/api/v1/admin/audit/export', json={})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'DEPENDENCY_UNAVAILABLE'
    assert 'approve' in response.json()['error']['message'] and 'data' not in response.json()
    assert (await client.post('/api/v1/admin/audit/export', json={'format': 'csv'})).status_code == 422


async def test_known_failure_and_unknown_commit_http_classification(client, monkeypatch):
    """Exercise real write rollback and ambiguous commit without retry."""
    app = client._transport.app
    service = app.state.config_service
    def failure(db):
        raise sqlite3.OperationalError('unavailable')
    monkeypatch.setattr(service, '_commit', failure)
    response = await client.put('/api/v1' + WRITES[3][1], json=WRITES[3][2])
    assert response.status_code == 503 and response.json()['data']['outcome'] == 'unconfirmed'
    def unavailable():
        raise sqlite3.OperationalError('cannot connect')
    monkeypatch.setattr(service, '_connect', unavailable)
    response = await client.put('/api/v1' + WRITES[3][1], json=WRITES[3][2])
    assert response.status_code == 503 and response.json()['error']['details']['commitStatus'] == 'not_committed'


@pytest.mark.parametrize('method,path,payload', WRITES)
async def test_each_write_known_storage_failure_and_commit_ambiguity(client, monkeypatch, method, path, payload):
    """Exercise each endpoint's known failure and possibly committed response."""
    service = client._transport.app.state.config_service
    original_connect = service._connect
    def unavailable():
        raise sqlite3.OperationalError('connection unavailable')
    monkeypatch.setattr(service, '_connect', unavailable)
    response = await getattr(client, method)('/api/v1' + path, json=payload)
    assert response.status_code == 503
    assert response.json()['error']['details']['commitStatus'] == 'not_committed'
    monkeypatch.setattr(service, '_connect', original_connect)
    calls = []
    def committed_but_lost(db):
        db.commit()
        calls.append(True)
        raise sqlite3.OperationalError('acknowledgement lost')
    monkeypatch.setattr(service, '_commit', committed_but_lost)
    response = await getattr(client, method)('/api/v1' + path, json=payload)
    assert response.status_code == 503 and response.json()['data']['outcome'] == 'unconfirmed'
    assert calls == [True]
    audit = (await client.get('/api/v1/admin/audit')).json()
    assert audit['total'] == 1
    assert audit['data'][0]['id'] == response.json()['data']['auditId']


async def test_audit_unknown_fields_and_read_storage_failure(client, monkeypatch):
    """Reject unsupported filter semantics and surface unavailable reads."""
    assert (await client.get('/api/v1/admin/audit', params={'format': 'csv'})).status_code == 422
    service = client._transport.app.state.audit_service
    def unavailable(*args):
        raise sqlite3.OperationalError('read unavailable')
    monkeypatch.setattr(service.repository, 'read', unavailable)
    response = await client.get('/api/v1/admin/audit')
    assert response.status_code == 503 and response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'
