"""Exercise every administrator endpoint against lifespan-initialized real SQLite."""
from copy import deepcopy
import sqlite3
import pytest

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
    read_response = await client.get('/api/v1/admin/audit', params={'target': result['configId'], 'persona': 'administrator'})
    assert read_response.status_code == 200
    audit = read_response.json()
    assert audit['total'] == 1 and audit['data'][0]['id'] == result['auditId']
    assert audit['data'][0]['occurredAt'] and audit['data'][0]['actor']['userId'] == 'demo-operator'
    read_response = await client.get('/api/v1/admin/config')
    assert read_response.status_code == 200
    catalog = read_response.json()['data']
    read_response = await client.get('/api/v1/dashboard', params={'personaId': 'executive'})
    assert read_response.status_code == 200
    dashboard = read_response.json()['data']
    if '/kpis' in path:
        assert dashboard['widgets'][0]['title'] == 'Uptime'
        assert dashboard['widgets'][0]['metric']['value'] == 99.23456
    elif '/widgets/' in path:
        assert 'availability' not in [w['id'] for w in dashboard['widgets']]
        read_response = await client.get('/api/v1/dashboard', params={'personaId': 'operations'})
        assert read_response.status_code == 200
        other = read_response.json()['data']
        assert 'availability' in [w['id'] for w in other['widgets']]
    elif '/scenarios' in path:
        assert dashboard['scenarios'][0]['label'] == 'Ops review'
    else:
        assert next(r for r in catalog['relationships'] if r['relationshipId'] == 'rel-0')['targetEntityId'] == 'app-0002'


# Required fields and schema limits, independently mutated on an otherwise valid body.
FIELD_RULES = [
    {'metricId': 100, 'label': 120, 'title': 120, 'actor': None},
    {'scenarioId': 100, 'label': 120, 'description': 500, 'destination': 200, 'actor': None},
    {'relationshipId': 100, 'sourceEntityId': 100, 'targetEntityId': 100, 'type': None, 'actor': None},
    {'visible': None, 'actor': None},
]
INVALID_FIELDS = []
for write, rules in zip(WRITES, FIELD_RULES):
    for field, maximum in rules.items():
        mutations = [('missing', None), ('wrong_type', 7)]
        if field not in ('actor', 'visible', 'description'):
            mutations += [('blank', '')]
            if field != 'destination':
                mutations += [('whitespace', '   ')]
        if maximum is not None:
            mutations += [('overlimit', 'x' * (maximum + 1))]
        for mutation, value in mutations:
            INVALID_FIELDS.append(pytest.param(*write, field, mutation, value,
                                               id=f'{write[1]}-{field}-{mutation}'))
    for mutation, value in [('missing', None), ('wrong_type', 7), ('blank', ''),
                            ('whitespace', '   '), ('overlimit', 'x' * 101)]:
        INVALID_FIELDS.append(pytest.param(*write, 'actor.personaId', mutation, value,
                                           id=f'{write[1]}-actor.personaId-{mutation}'))
    for mutation, value in [('wrong_type', 7), ('blank', ''), ('unsupported', 'real-user')]:
        INVALID_FIELDS.append(pytest.param(*write, 'actor.userId', mutation, value,
                                           id=f'{write[1]}-actor.userId-{mutation}'))
    for field in ('formula', 'actor.role'):
        INVALID_FIELDS.append(pytest.param(*write, field, 'extra', 'unsupported',
                                           id=f'{write[1]}-{field}-extra'))


def config_state(repository) -> dict:
    """Read actual SQLite rows, including non-config side effects of admin edits."""
    return {table: repository.read(f'SELECT * FROM {table} ORDER BY id')
            for table in ('app_config', 'audit_event', 'metric', 'relationship', 'entity')}


@pytest.mark.parametrize('method,path,payload,field,mutation,value', INVALID_FIELDS)
async def test_every_required_field_rejected_without_state_changes(client, method, path, payload, field, mutation, value):
    """Report the independently invalid field and leave persisted rows unchanged."""
    repository = client._transport.app.state.repository
    before = config_state(repository)
    body = deepcopy(payload)
    keys = field.split('.')
    container = body['actor'] if len(keys) == 2 else body
    if mutation == 'missing':
        container.pop(keys[-1])
    else:
        container[keys[-1]] = value
    response = await getattr(client, method)('/api/v1' + path, json=body)
    assert response.status_code == 422
    problem = response.json()['error']
    assert problem['code'] == 'INVALID_REQUEST'
    issues = problem['details']['issues']
    assert [issue['location'] for issue in issues] == [['body', *keys]]
    assert all(issue['message'] for issue in issues)
    assert config_state(repository) == before
    audit_response = await client.get('/api/v1/admin/audit')
    assert audit_response.status_code == 200
    assert audit_response.json()['total'] == 0


@pytest.mark.parametrize('destination', ['   ', 'https://evil.example', '//evil.example', '/operations/../admin', '/operations?redirect=https://evil.example', '/journeys/unknown', '/%2e%2e/admin', "';DROP TABLE entity;--"])
async def test_scenario_redirect_injection_rejected(client, destination):
    """Arbitrary/external/path destinations never become stored navigation."""
    repository = client._transport.app.state.repository
    before = config_state(repository)
    response = await client.post('/api/v1/admin/scenarios', json={**WRITES[1][2], 'destination': destination})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_CONFIG'
    assert response.json()['error']['details']['issues'][0]['field'] == 'destination'
    assert config_state(repository) == before
    response = await client.get('/api/v1/admin/audit')
    assert response.status_code == 200
    assert response.json()['total'] == 0


@pytest.mark.parametrize('method,path,payload,field', [(m,p,b,next((k for k in b if k.endswith('Id')), 'actor')) for m,p,b in WRITES[:3]])
async def test_unknown_ids_and_sql_injection(client, method, path, payload, field):
    """Unknown IDs return 404 and malformed identifiers cannot alter SQL."""
    for bad, expected in [('unknown', 404), ("x';DROP TABLE entity;--", 422), ('../admin', 422)]:
        response = await getattr(client, method)('/api/v1' + path, json={**payload, field: bad})
        assert response.status_code == expected
    response = await client.get('/api/v1/admin/config')
    assert response.status_code == 200
    response = await client.get('/api/v1/admin/audit')
    assert response.status_code == 200
    assert response.json()['total'] == 0


async def test_widget_unknown_persona_widget_and_strict_boolean(client):
    """Reject unknown isolated catalog entries and truthy non-booleans."""
    for path in ['/admin/personas/unknown/widgets/availability', '/admin/personas/engineering/widgets/availability']:
        response = await client.put('/api/v1' + path, json=WRITES[3][2])
        assert response.status_code == 404
    for visible in ['false', 0, None]:
        response = await client.put('/api/v1' + WRITES[3][1], json={'visible': visible, 'actor': ACTOR})
        assert response.status_code == 422


async def test_audit_bounds_unknown_filter_and_blocked_export(client):
    """Expose empty reads and actionable 409 without a fake artifact."""
    response = await client.get('/api/v1/admin/audit', params={'eventType': 'annotation', 'target': 'unknown', 'persona': 'executive', 'limit': 1})
    assert response.status_code == 200
    assert response.json()['data'] == []
    for params in [{'limit': 0}, {'limit': 101}, {'offset': -1}, {'offset': 10001}, {'eventType': 'delete'}, {'target': "';DROP TABLE audit_event;--"}]:
        response = await client.get('/api/v1/admin/audit', params=params)
        assert response.status_code == 422
    response = await client.post('/api/v1/admin/audit/export', json={})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'DEPENDENCY_UNAVAILABLE'
    assert 'approve' in response.json()['error']['message'] and 'data' not in response.json()
    response = await client.post('/api/v1/admin/audit/export', json={'format': 'csv'})
    assert response.status_code == 422


async def test_known_failure_and_unknown_commit_http_classification(client, monkeypatch):
    """Exercise real write rollback and ambiguous commit without retry."""
    app = client._transport.app
    service = app.state.config_service
    def failure(db):
        raise sqlite3.OperationalError('unavailable')
    monkeypatch.setattr(service, '_commit', failure)
    response = await client.put('/api/v1' + WRITES[3][1], json=WRITES[3][2])
    assert response.status_code == 503
    assert response.json()['data']['outcome'] == 'unconfirmed'
    def unavailable():
        raise sqlite3.OperationalError('cannot connect')
    monkeypatch.setattr(service, '_connect', unavailable)
    response = await client.put('/api/v1' + WRITES[3][1], json=WRITES[3][2])
    assert response.status_code == 503
    assert response.json()['error']['details']['commitStatus'] == 'not_committed'


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
    assert response.status_code == 503
    assert response.json()['data']['outcome'] == 'unconfirmed'
    assert calls == [True]
    read_response = await client.get('/api/v1/admin/audit')
    assert read_response.status_code == 200
    audit = read_response.json()
    assert audit['total'] == 1
    assert audit['data'][0]['id'] == response.json()['data']['auditId']


async def test_audit_unknown_fields_and_read_storage_failure(client, monkeypatch):
    """Reject unsupported filter semantics and surface unavailable reads."""
    response = await client.get('/api/v1/admin/audit', params={'format': 'csv'})
    assert response.status_code == 422
    service = client._transport.app.state.audit_service
    def unavailable(*args):
        raise sqlite3.OperationalError('read unavailable')
    monkeypatch.setattr(service.repository, 'read', unavailable)
    response = await client.get('/api/v1/admin/audit')
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'


@pytest.mark.parametrize('failure_boundary', ['catalog', '_destinations'])
async def test_config_catalog_storage_failure_keeps_real_fixtures(client, monkeypatch, failure_boundary):
    """Surface service or in-transaction read failures without stale catalog data."""
    state = client._transport.app.state
    before = config_state(state.repository)
    assert before['app_config'] and before['metric'] and before['audit_event'] == []
    def unavailable(*args, **kwargs):
        raise sqlite3.OperationalError('catalog read unavailable')
    with monkeypatch.context() as patch:
        patch.setattr(state.config_service, failure_boundary, unavailable)
        response = await client.get('/api/v1/admin/config')
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'
        assert 'data' not in response.json()
    assert config_state(state.repository) == before
    response = await client.get('/api/v1/admin/config')
    assert response.status_code == 200
    assert response.json()['data']['personas']
