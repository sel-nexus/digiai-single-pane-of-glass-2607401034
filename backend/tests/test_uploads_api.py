"""Exercise multipart status, safety, rejection and persistence on the actual API."""
import json
import httpx
import pytest
from app.core.config import Settings
from app.main import create_app
from app.domain.upload_service import UploadService
from app.schemas.uploads import UploadFailure
from test_upload_service import ENTITY_MAP, entity_data, workbook_bytes


def fields(**changes):
    """Supply the explicit typed multipart text envelope."""
    return {'datasetClass': 'master', 'mapping': ENTITY_MAP.model_dump_json(), 'actor': json.dumps({'personaId': 'administrator'}), **changes}


async def test_confirmed_csv_reflects_profile_and_persists_restart(tmp_path):
    config = Settings(database_path=str(tmp_path / 'persist.db'))
    app = create_app(config)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('../../unsafe.csv', entity_data(attrs={'health': 'uploaded health'}), 'text/csv')})
            assert response.status_code == 201
            body = response.json()['data']
            assert body['outcome'] == 'success' and body['reflection']['status'] == 'confirmed'
            profile = (await client.get('/api/v1/applications/new-app')).json()['data']
            assert profile['source'] == 'uploaded' and profile['sourceRef'] == body['datasetVersion']
            assert profile['categories']['health']['value'][0]['value'] == 'uploaded health'
            assert app.state.repository.read('SELECT source_filename FROM dataset_version WHERE id=?', (body['uploadId'],))[0]['source_filename'] == 'unsafe.csv'
    restarted = create_app(config)
    async with restarted.router.lifespan_context(restarted):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted), base_url='http://test') as client:
            assert (await client.get('/api/v1/applications/new-app')).json()['data']['source'] == 'uploaded'


@pytest.mark.parametrize('changes', [{'datasetClass': 'not-real'}, {'mapping': '{'}, {'mapping': '[]'}, {'mapping': '{"recordKind":"entity","columns":{"K":"id"}}'}, {'mapping': '{"recordKind":"entity","columns":{"K":"id","N":"label","T":"type"},"extra":1}'}, {'actor': '{"personaId":"administrator","admin":true}'}, {'actor': '{}'}])
async def test_invalid_envelope_status_400(client, changes):
    response = await client.post('/api/v1/admin/uploads', data=fields(**changes), files={'file': ('a.csv', entity_data(), 'text/csv')})
    assert response.status_code == 400
    assert set(response.json()) == {'error'}


async def test_missing_file_and_json_not_multipart(client):
    assert (await client.post('/api/v1/admin/uploads', json=fields())).status_code == 400
    assert (await client.post('/api/v1/admin/uploads', data=fields(), files={'other': ('a.csv', b'x', 'text/csv')})).status_code == 400


@pytest.mark.parametrize('name,data', [('a.xls', b'anything'), ('a.xlsx', b'not zip'), ('a.csv', b'PKbinary'), ('script.exe', b'Key')])
async def test_unsupported_type_415(client, name, data):
    response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': (name, data, 'text/csv')})
    assert response.status_code == 415
    assert response.json()['error']['code'] == 'UNSUPPORTED_FILE'


async def test_rejected_duplicate_and_reference_422_leave_state(client):
    for data in (entity_data('app-0001'), entity_data(parent='missing')):
        response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.csv', data, 'text/csv')})
        assert response.status_code == 422
        assert response.json()['error']['details']['issues'][0]['row'] == 2
    assert (await client.get('/api/v1/entities', params={'q': 'new-app'})).json()['data'] == []


async def test_actual_xlsx_and_formula_status(client):
    rows = [list(ENTITY_MAP.columns), ['xlsx-app', 'application', 'XLSX app', '{}', '']]
    response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.xlsx', workbook_bytes(rows), 'application/octet-stream')})
    assert response.status_code == 201
    assert (await client.get('/api/v1/applications/xlsx-app')).json()['data']['label'] == 'XLSX app'
    response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.xlsx', workbook_bytes(rows, True), 'application/octet-stream')})
    assert response.status_code == 422
    assert response.json()['error']['details']['issues'][0]['code'] == 'FORMULA_CELL'


async def test_configured_byte_limit_413(tmp_path):
    app = create_app(Settings(database_path=str(tmp_path / 'limit.db'), upload_max_bytes=32))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.csv', entity_data(), 'text/csv')})
            assert response.status_code == 413
            assert response.json()['error']['code'] == 'UPLOAD_LIMIT'


async def test_mock_actor_not_auth_and_injection_is_bound_literal(client):
    key = "safe'; DROP TABLE entity;--"
    response = await client.post('/api/v1/admin/uploads', data=fields(actor='{"personaId":"executive"}'), files={'file': ('C:\\evil\\data.csv', entity_data(key), 'text/csv')})
    assert response.status_code == 201  # Mock display context deliberately grants no authorization.
    found = (await client.get('/api/v1/entities', params={'q': key})).json()['data']
    assert found[0]['id'] == key and found[0]['source'] == 'uploaded'
    assert (await client.get('/api/v1/applications/app-0001')).status_code == 200


async def test_storage_known_failure_503_is_not_ambiguous(client, monkeypatch):
    def blocked(self, *args):
        raise UploadFailure(503, 'STORAGE_UNAVAILABLE', 'Upload was not committed.')
    monkeypatch.setattr(UploadService, 'accept', blocked)
    response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.csv', entity_data(), 'text/csv')})
    assert response.status_code == 503
    assert response.json()['error']['details']['commitStatus'] == 'not_committed'


async def test_unknown_commit_503_returns_unconfirmed_envelope(client, monkeypatch):
    def uncertain(self, connection):
        connection.commit()
        import sqlite3
        raise sqlite3.OperationalError('confirmation lost')
    monkeypatch.setattr(UploadService, '_commit', uncertain)
    response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.csv', entity_data(), 'text/csv')})
    assert response.status_code == 503
    assert response.json()['data']['outcome'] == 'unconfirmed'
    assert response.json()['availability'] == 'unavailable'
    assert (await client.get('/api/v1/applications/new-app')).status_code == 200


async def test_cors_allows_post_for_configured_origin(client):
    response = await client.options('/api/v1/admin/uploads', headers={'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'POST'})
    assert response.status_code == 200
    assert 'POST' in response.headers['access-control-allow-methods']


async def test_wire_body_limit_rejects_before_multipart_spooling(tmp_path):
    app = create_app(Settings(database_path=str(tmp_path / 'wire.db'), upload_max_bytes=32))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/admin/uploads', data=fields(), files={'file': ('a.csv', b'x' * 300000, 'text/csv')})
            assert response.status_code == 413
            assert response.json()['error']['code'] == 'UPLOAD_LIMIT'
            assert app.state.repository.read("SELECT id FROM dataset_version WHERE source_kind='uploaded'") == []


async def test_duplicate_multipart_parts_rejected(client):
    parts = [('file', ('a.csv', entity_data(), 'text/csv')),
             ('datasetClass', (None, 'master')), ('mapping', (None, ENTITY_MAP.model_dump_json())),
             ('actor', (None, '{"personaId":"administrator"}')), ('actor', (None, '{"personaId":"executive"}'))]
    response = await client.post('/api/v1/admin/uploads', files=parts)
    assert response.status_code == 400
    assert 'error' in response.json()


async def test_release_environment_source_evidence_is_not_imposed_id(client):
    from test_upload_service import csv_bytes
    attrs = {'applicationId': 'app-0001', 'build': 'Supplied passing', 'test': 'Source tested',
             'security': 'Source reviewed', 'change': 'Source approved', 'environment': {'status': 'Source ready'}}
    data = csv_bytes([list(ENTITY_MAP.columns), ['uploaded-release', 'release', 'Uploaded release', json.dumps(attrs), '']])
    response = await client.post('/api/v1/admin/uploads', data=fields(datasetClass='release_metrics'), files={'file': ('release.csv', data, 'text/csv')})
    assert response.status_code == 201
    stored = (await client.get('/api/v1/applications/app-0001')).json()['data']['categories']['releaseHistory']['value']
    uploaded = next(row for row in stored if row['id'] == 'uploaded-release')
    assert uploaded['value']['environment'] == {'status': 'Source ready'}
