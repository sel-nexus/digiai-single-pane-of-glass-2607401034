"""Verify data stewardship flows across actual domain routers and file storage."""
import json
import pytest

ACTOR = {'personaId': 'administrator'}


async def upload(client, dataset_class, kind, columns, csv):
    """Submit explicit mapped source records through the real multipart boundary."""
    return await client.post('/api/v1/admin/uploads', data={
        'datasetClass': dataset_class,
        'mapping': json.dumps({'recordKind': kind, 'columns': columns}),
        'actor': json.dumps(ACTOR),
    }, files={'file': ('integration.csv', csv.encode('utf-8'), 'text/csv')})


async def test_upload_application_search_profile_audit_and_restart_reads(client):
    """Keep uploaded identity and provenance coherent through four feature reads."""
    result = await upload(client, 'master', 'entity', {'ID': 'id', 'Type': 'type', 'Name': 'label'},
                          'ID,Type,Name\nintegration-app,application,Integration application\n')
    assert result.status_code == 201
    version = result.json()['data']['datasetVersion']
    search = await client.get('/api/v1/entities', params={'type': 'application', 'q': 'integration-app'})
    assert search.status_code == 200
    assert search.json()['data'][0]['sourceRef'] == version
    profile = await client.get('/api/v1/applications/integration-app')
    assert profile.status_code == 200
    assert profile.json()['data']['source'] == 'uploaded'
    assert profile.json()['data']['categories']['health']['value'] is None
    audit = await client.get('/api/v1/admin/audit', params={'eventType': 'uploaded_data_version'})
    assert audit.status_code == 200
    assert any(row['datasetVersionId'] == version for row in audit.json()['data'])
    repository = client._transport.app.state.repository
    from app.storage.sqlite_repository import SqliteRepository
    fresh = SqliteRepository(str(repository.path))
    assert fresh.read('SELECT source_kind FROM entity WHERE id=?', ('integration-app',))[0]['source_kind'] == 'uploaded'
    assert fresh.read('PRAGMA foreign_key_check') == []


async def test_configuration_dashboard_kpis_audit_and_other_persona_consistency(client):
    """Reflect explicit edits without altering values or another persona visibility."""
    saved = await client.post('/api/v1/admin/kpis', json={
        'metricId': 'availability', 'label': 'Integration uptime', 'title': 'Integration uptime', 'actor': ACTOR})
    assert saved.status_code == 200
    hidden = await client.put('/api/v1/admin/personas/executive/widgets/availability',
                              json={'visible': False, 'actor': ACTOR})
    assert hidden.status_code == 200
    dashboard = await client.get('/api/v1/dashboard?personaId=executive')
    assert dashboard.status_code == 200
    assert 'availability' not in [row['id'] for row in dashboard.json()['data']['widgets']]
    other = await client.get('/api/v1/dashboard?personaId=operations')
    assert other.status_code == 200
    metric = next(row for row in other.json()['data']['widgets'] if row['id'] == 'availability')['metric']
    assert metric['label'] == 'Integration uptime' and metric['value'] == 99.23456
    kpis = await client.get('/api/v1/kpis?family=enterprise')
    assert kpis.status_code == 200
    assert next(row for row in kpis.json()['data'] if row['id'] == 'availability')['value'] == 99.23456
    audit = await client.get('/api/v1/admin/audit?persona=administrator')
    assert audit.status_code == 200 and audit.json()['total'] == 2
    assert {row['eventType'] for row in audit.json()['data']} == {'edit', 'override'}


async def test_mapping_journey_profile_and_empty_shared_scope(client):
    """Use saved explicit links in journeys while keeping excluded profiles empty."""
    saved = await client.post('/api/v1/admin/mappings', json={
        'relationshipId': 'rel-0', 'sourceEntityId': 'journey-renewal',
        'targetEntityId': 'app-0002', 'type': 'impact', 'actor': ACTOR})
    assert saved.status_code == 200
    journey = await client.get('/api/v1/journeys/journey-renewal')
    assert journey.status_code == 200
    assert any(row['target']['entityId'] == 'app-0002' for row in journey.json()['data']['relationships'])
    profile = await client.get('/api/v1/applications/app-0002')
    assert profile.status_code == 200 and profile.json()['data']['id'] == 'app-0002'
    excluded = await client.get('/api/v1/applications/app-0002?application=app-0001')
    assert excluded.status_code == 200 and excluded.json()['data'] is None
    audit = await client.get('/api/v1/admin/audit')
    assert audit.status_code == 200 and audit.json()['total'] == 1


async def test_invalid_upstream_upload_preserves_downstream_evidence_and_audit(client):
    """Reject conflicting data without changing profile, journey or audit state."""
    initial = await client.get('/api/v1/applications/app-0001')
    assert initial.status_code == 200
    before = initial.json()
    result = await upload(client, 'master', 'entity', {'ID': 'id', 'Type': 'type', 'Name': 'label'},
                          'ID,Type,Name\napp-0001,application,Wrong replacement\n')
    assert result.status_code == 422
    after = await client.get('/api/v1/applications/app-0001')
    assert after.status_code == 200 and after.json() == before
    journey = await client.get('/api/v1/journeys/journey-enrollment')
    assert journey.status_code == 200
    assert any(row['target']['entityId'] == 'app-0001' for row in journey.json()['data']['relationships'])
    audit = await client.get('/api/v1/admin/audit')
    assert audit.status_code == 200 and audit.json()['total'] == 0


@pytest.mark.parametrize('dataset_class,record_type,endpoint', [
    ('incident', 'incident', '/api/v1/operations/incidents'),
    ('release_metrics', 'release', '/api/v1/readiness/evidence'),
])
async def test_uploaded_associated_evidence_reaches_domain_and_profile(client, dataset_class, record_type, endpoint):
    """Preserve uploaded evidence across operations/readiness and Application 360."""
    import csv
    import io
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Type', 'Name', 'Fields'])
    attrs = {'applicationId': 'app-0001', 'recordType': record_type, 'build': 'Source build',
             'test': 'Source test', 'security': 'Source review', 'change': 'Source change', 'environment': 'Source environment', 'period': 'month'}
    if record_type == 'incident':
        attrs = {'applicationId': 'app-0001', 'recordType': 'incident'}
    writer.writerow(['integration-' + record_type, 'release' if record_type == 'release' else 'ticket',
                     'Integration evidence', json.dumps(attrs)])
    result = await upload(client, dataset_class, 'entity',
                          {'ID': 'id', 'Type': 'type', 'Name': 'label', 'Fields': 'attributes'}, output.getvalue())
    assert result.status_code == 201
    domain = await client.get(endpoint, params={'application': 'app-0001'})
    assert domain.status_code == 200
    assert 'integration-' + record_type in domain.text
    if record_type == 'release':
        evidence = next(row for row in domain.json()['data'] if row['id'] == 'integration-release')
        assert evidence['categories']['build']['availability'] == 'available'
        for category in ('build', 'test', 'security', 'change', 'environment'):
            entry = evidence['categories'][category]
            assert entry['availability'] == 'available'
            assert entry['value'][0]['value']['status'] == attrs[category]
            assert entry['value'][0]['period'] == 'month'
            assert entry['value'][0]['sourceRef'] == result.json()['data']['datasetVersion']
    profile = await client.get('/api/v1/applications/app-0001')
    assert profile.status_code == 200 and 'integration-' + record_type in profile.text
    assert client._transport.app.state.repository.read('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('family,endpoint,label', [
    ('enterprise', '/api/v1/kpis', 'Availability %'),
    ('reliability', '/api/v1/operations/metrics', 'Availability %'),
    ('qe', '/api/v1/readiness/metrics', 'automation coverage %'),
    ('security', '/api/v1/readiness/metrics', 'secure SDLC compliance %'),
])
async def test_uploaded_metric_reflection_preserves_exact_value_period_and_source(client, family, endpoint, label):
    """Follow mapped evidence into scoped family readers without rounding storage."""
    response = await upload(client, 'observability_kpi', 'metric',
        {'ID': 'id', 'Name': 'label', 'Family': 'family', 'Value': 'value', 'Unit': 'unit',
         'Period': 'period', 'App': 'entityId'},
        f'ID,Name,Family,Value,Unit,Period,App\nflow-{family},{label},{family},99.23456,%,month,app-0002\n')
    assert response.status_code == 201
    version = response.json()['data']['datasetVersion']
    family_query = {'family': family} if endpoint != '/api/v1/operations/metrics' else {}
    result = await client.get(endpoint, params=family_query | {'period': 'month', 'application': 'app-0002'})
    assert result.status_code == 200
    metric = next(row for row in result.json()['data'] if row['id'] == 'flow-' + family)
    assert metric['value'] == '99.23456' and metric['sourceRef'] == version
    assert metric['availability'] == 'available' and metric['period'] == 'month'
    profile = await client.get('/api/v1/applications/app-0001')
    assert profile.status_code == 200
    stored = client._transport.app.state.repository.read('SELECT value_text, period, source_ref FROM metric WHERE id=?', ('flow-' + family,))[0]
    assert stored == {'value_text': '99.23456', 'period': 'month', 'source_ref': version}
    absent = await client.get(endpoint, params=family_query | {'period': 'week', 'application': 'app-0002'})
    assert absent.status_code == 200 and '99.23456' not in absent.text
    excluded = await client.get(endpoint, params=family_query | {'period': 'month', 'application': 'app-0001'})
    assert excluded.status_code == 200
    assert version not in excluded.text
    assert all(row['id'] != 'flow-' + family or row['availability'] == 'unavailable'
               for row in excluded.json()['data'])


async def test_uploaded_correlation_relationship_reaches_incident_reader(client):
    """Use the documented correlation vocabulary with uploaded provenance."""
    response = await upload(client, 'incident', 'relationship',
        {'ID': 'id', 'From': 'sourceEntityId', 'To': 'targetEntityId', 'Kind': 'type'},
        'ID,From,To,Kind\nflow-correlation,ticket-1,app-0001,correlates_with\n')
    assert response.status_code == 201
    version = response.json()['data']['datasetVersion']
    result = await client.get('/api/v1/operations/correlations?incidentId=ticket-1')
    assert result.status_code == 200
    assert 'flow-correlation' in result.text and version in result.text
    assert 'represented correlation' in result.text


@pytest.mark.parametrize('kind,endpoint', [('recommendation', '/api/v1/recommendations'),
                                          ('transformation', '/api/v1/transformation')])
async def test_uploaded_insight_and_context_relationship_reach_insight_reader(client, kind, endpoint):
    """Associate uploaded explanations/value evidence with exact existing profiles."""
    import csv
    import io
    attrs = {'reason': 'Uploaded reason', 'confidence': 'Source confidence', 'applicationId': 'app-0001'}
    if kind == 'transformation':
        attrs = {'applicationId': 'app-0001', 'measures': {'adoption': {
            'value': '12.3456', 'unit': '%', 'period': 'month', 'sourceRef': 'supplied-flow-value'}},
            'series': [{'label': 'Source adoption', 'points': [
                {'value': 1, 'period': 'week', 'sourceRef': 'point-one'},
                {'value': 2, 'period': 'month', 'sourceRef': 'point-two'}]}]}
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(['ID', 'Type', 'Name', 'Attrs'])
    writer.writerow(['flow-' + kind, kind, 'Uploaded insight', json.dumps(attrs)])
    created = await upload(client, 'transformation_maturity', 'entity',
        {'ID': 'id', 'Type': 'type', 'Name': 'label', 'Attrs': 'attributes'}, stream.getvalue())
    assert created.status_code == 201
    linked = await upload(client, 'journey_mapping', 'relationship',
        {'ID': 'id', 'From': 'sourceEntityId', 'To': 'targetEntityId', 'Kind': 'type'},
        f'ID,From,To,Kind\ncontext-{kind},flow-{kind},app-0001,context\n')
    assert linked.status_code == 201
    response = await client.get(endpoint, params={'applicationId': 'app-0001'})
    assert response.status_code == 200
    item = next(row for row in response.json()['data'] if row['id'] == 'flow-' + kind)
    assert item['source'] == 'uploaded' and item['availability'] == 'available'
    assert item['associations'][0]['entityId'] == 'app-0001'
    if kind == 'recommendation':
        assert item['reason'] == 'Uploaded reason' and item['confidence'] == 'Source confidence'
    else:
        assert item['measures'][0]['value'] == '12.3456'
        assert [point['period'] for point in item['series'][0]['points']] == ['week', 'month']
    profile = await client.get('/api/v1/applications/app-0001')
    assert profile.status_code == 200 and profile.json()['data']['id'] == 'app-0001'
    assert client._transport.app.state.repository.read('PRAGMA foreign_key_check') == []
