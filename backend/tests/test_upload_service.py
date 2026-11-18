"""Verify mapped ingestion against fresh real SQLite files and safe parsers."""
import csv
import io
import json
import sqlite3
import zipfile
import pytest
from openpyxl import Workbook
from app.core.config import Settings
from app.domain.upload_service import UploadService
from app.schemas.uploads import DATASET_CLASSES, UploadActor, UploadFailure, UploadMapping

ACTOR = UploadActor(personaId='administrator')
ENTITY_MAP = UploadMapping(recordKind='entity', columns={'Key': 'id', 'Kind': 'type', 'Name': 'label', 'Data': 'attributes', 'Parent': 'parentId'})


def csv_bytes(rows):
    """Encode quoted source cells without fixed domain header requirements."""
    stream = io.StringIO()
    csv.writer(stream).writerows(rows)
    return stream.getvalue().encode('utf-8')


def entity_data(key='new-app', attrs=None, parent=''):
    """Supply dynamic entity headers and literal JSON attributes."""
    return csv_bytes([['Key', 'Kind', 'Name', 'Data', 'Parent'], [key, 'application', 'Uploaded application', json.dumps(attrs or {}), parent]])


def workbook_bytes(rows, formula=False):
    """Create a real OOXML first worksheet with an ignored second sheet."""
    book = Workbook()
    for row in rows:
        book.active.append(row)
    if formula:
        book.active['C2'] = '=1+1'
    book.create_sheet('Other').append(['ignored'])
    stream = io.BytesIO()
    book.save(stream)
    return stream.getvalue()


def counts(repository):
    """Re-query all affected tables on fresh connections."""
    return {table: repository.read(f'SELECT COUNT(*) AS n FROM {table}')[0]['n'] for table in ('entity', 'relationship', 'metric', 'dataset_version', 'audit_event')}


@pytest.mark.parametrize('dataset_class', DATASET_CLASSES)
def test_all_classes_commit_version_audit_and_preserve_attributes(repository, dataset_class):
    service = UploadService(repository, Settings())
    before = counts(repository)
    result = service.accept(dataset_class, entity_data(attrs={'health': 'source literal', 'recordType': 'major_incident', 'applicationId': 'app-0001'}), 'sample.csv', ENTITY_MAP, ACTOR)
    assert result.data.outcome == 'success'
    assert result.data.reflection.status == 'confirmed'
    stored = repository.read('SELECT * FROM entity WHERE id=?', ('new-app',))[0]
    assert stored['source_kind'] == 'uploaded'
    assert stored['source_ref'] == result.data.datasetVersion == stored['dataset_version_id']
    assert json.loads(stored['attributes_json'])['recordType'] == 'major_incident'
    version = repository.read('SELECT * FROM dataset_version WHERE id=?', (stored['source_ref'],))[0]
    assert version['dataset_class'] == dataset_class
    audit = repository.read('SELECT * FROM audit_event WHERE dataset_version_id=?', (stored['source_ref'],))[0]
    assert json.loads(audit['actor_context']) == {'personaId': 'administrator'}
    assert counts(repository)['entity'] == before['entity'] + 1


@pytest.mark.parametrize('value', ['12345678901234567890.000000000123', '0', '-1.2500', '1e-40', ''])
def test_metric_exact_numeric_or_null_and_family_unit_period(repository, value):
    mapping = UploadMapping(recordKind='metric', columns=dict(zip(['K', 'N', 'F', 'V', 'U', 'P', 'A'], ['id', 'label', 'family', 'value', 'unit', 'period', 'entityId'])))
    result = UploadService(repository, Settings()).accept('qe_metrics', csv_bytes([list(mapping.columns), ['new-metric', 'Exact source', 'qe', value, '%', '2026-Q1', 'app-0001']]), 'q.csv', mapping, ACTOR)
    row = repository.read('SELECT * FROM metric WHERE id=?', ('new-metric',))[0]
    assert result.data.outcome == 'success'
    assert row['value_text'] == (value or None) and row['value_number'] is None
    assert (row['family'], row['unit'], row['period']) == ('qe', '%', '2026-Q1')
    assert row['availability'] == ('available' if value else 'unavailable')


def test_relationship_preserves_context_and_upload_provenance(repository):
    mapping = UploadMapping(recordKind='relationship', columns={'K': 'id', 'F': 'sourceEntityId', 'T': 'targetEntityId', 'L': 'type', 'S': 'sourceRef'})
    result = UploadService(repository, Settings()).accept('journey_mapping', csv_bytes([list(mapping.columns), ['new-link', 'app-0001', 'app-0002', 'depends_on', 'source supplied link']]), 'links.csv', mapping, ACTOR)
    row = repository.read('SELECT * FROM relationship WHERE id=?', ('new-link',))[0]
    assert row['represented_context'] == 'source supplied link'
    assert row['source_ref'] == result.data.uploadId


def test_forward_parent_reference_accepted_batch_is_atomic(repository):
    data = csv_bytes([list(ENTITY_MAP.columns), ['child', 'application', 'Child', '{}', 'parent'], ['parent', 'service', 'Parent', '{}', '']])
    result = UploadService(repository, Settings()).accept('master', data, 'batch.csv', ENTITY_MAP, ACTOR)
    assert result.data.acceptedRows == 2
    assert repository.read('SELECT parent_id FROM entity WHERE id=?', ('child',))[0]['parent_id'] == 'parent'


@pytest.mark.parametrize('data,code', [
    (b'Key,Kind,Name,Data,Parent\na,invalid,Name,{},', 'ENTITY_TYPE'),
    (b'Key,Kind,Name,Data,Parent\na,application,,{},', 'REQUIRED_VALUE'),
    (b'Key,Kind,Name,Data,Parent\na,application,Name,[],', 'ATTRIBUTES_JSON'),
    (entity_data('app-0001'), 'DUPLICATE_ID'),
    (entity_data(parent='missing'), 'INVALID_REFERENCE'),
    (entity_data(attrs={'applicationId': ['app-0001']}), 'INVALID_REFERENCE'),
    (entity_data(attrs={'applicationId': 'journey-enrollment'}), 'INVALID_REFERENCE'),
])
def test_invalid_rows_reject_without_any_state_change(repository, data, code):
    before = counts(repository)
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', data, 'a.csv', ENTITY_MAP, ACTOR)
    assert error.value.status == 422
    assert code in {issue.code for issue in error.value.issues}
    assert counts(repository) == before


def test_infile_duplicate_and_cross_table_conflicts(repository):
    before = counts(repository)
    data = csv_bytes([list(ENTITY_MAP.columns), ['same', 'application', 'One', '{}', ''], ['same', 'application', 'Two', '{}', '']])
    with pytest.raises(UploadFailure, match='duplicate'):
        UploadService(repository, Settings()).accept('master', data, 'a.csv', ENTITY_MAP, ACTOR)
    metric_id = repository.read('SELECT id FROM metric LIMIT 1')[0]['id']
    with pytest.raises(UploadFailure):
        UploadService(repository, Settings()).accept('master', entity_data(metric_id), 'a.csv', ENTITY_MAP, ACTOR)
    assert counts(repository) == before


@pytest.mark.parametrize('value', ['NaN', 'Infinity', 'true', '12%', '=1+1', '1,000'])
def test_invalid_metric_types(repository, value):
    mapping = UploadMapping(recordKind='metric', columns={'K': 'id', 'N': 'label', 'F': 'family', 'V': 'value'})
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('qe_metrics', csv_bytes([list(mapping.columns), ['m', 'Metric', 'qe', value]]), 'a.csv', mapping, ACTOR)
    assert error.value.issues[0].code == 'METRIC_NUMBER'


@pytest.mark.parametrize('data', [b'Key,Kind,Name,Data,Parent\n"unterminated', b'\xff', b'', b'Key,Key\na,b', b'Key,Kind,Name,Data,Parent\na,b', b'Key,Kind,Name,Data,Parent\n\x00'])
def test_malformed_csv(repository, data):
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', data, 'a.csv', ENTITY_MAP, ACTOR)
    assert error.value.status == 422


def test_absent_mapped_column(repository):
    mapping = UploadMapping(recordKind='entity', columns={'Missing': 'id', 'Kind': 'type', 'Name': 'label'})
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', entity_data(), 'a.csv', mapping, ACTOR)
    assert error.value.issues[0].code == 'MISSING_COLUMN'


def test_xlsx_first_sheet_literals_and_precision(repository):
    mapping = UploadMapping(recordKind='metric', columns={'K': 'id', 'N': 'label', 'F': 'family', 'V': 'value'})
    data = workbook_bytes([list(mapping.columns), ['xlsx-metric', 'Literal', 'automation', '1234567890123456789.0001']])
    result = UploadService(repository, Settings()).accept('automation_metrics', data, 'a.xlsx', mapping, ACTOR)
    assert result.data.outcome == 'success'
    assert repository.read('SELECT value_text FROM metric WHERE id=?', ('xlsx-metric',))[0]['value_text'] == '1234567890123456789.0001'


def test_xlsx_formula_rejected_no_evaluation(repository):
    before = counts(repository)
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', workbook_bytes([list(ENTITY_MAP.columns), ['a', 'application', 'Name', '{}', '']], formula=True), 'a.xlsx', ENTITY_MAP, ACTOR)
    assert error.value.issues[0].code == 'FORMULA_CELL'
    assert counts(repository) == before


@pytest.mark.parametrize('limit', ['upload_max_bytes', 'upload_max_rows', 'upload_max_columns', 'xlsx_max_expanded_bytes'])
def test_configured_limits(repository, limit):
    config = Settings(**{limit: 1})
    data = workbook_bytes([list(ENTITY_MAP.columns), ['a', 'application', 'A', '{}', '']]) if limit == 'xlsx_max_expanded_bytes' else entity_data()
    if limit == 'upload_max_rows':
        data += b'b,application,B,{},\n'
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, config).accept('master', data, 'a.xlsx' if limit.startswith('xlsx') else 'a.csv', ENTITY_MAP, ACTOR)
    assert error.value.status == 413


@pytest.mark.parametrize('entry,content', [('evil.xml', b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'), ('../evil.xml', b'<x/>'), ('xl/workbook.xml', b'<broken')])
def test_unsafe_zip_xml_and_path_rejected(repository, entry, content):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(entry, content)
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', stream.getvalue(), 'a.xlsx', ENTITY_MAP, ACTOR)
    assert error.value.status == 422


def test_compressed_zip_bomb_limit(repository):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('large.xml', b'x' * 100000)
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings(xlsx_max_expanded_bytes=1000)).accept('master', stream.getvalue(), 'a.xlsx', ENTITY_MAP, ACTOR)
    assert error.value.status == 413


def test_fk_constraint_is_real_and_audit_failure_rolls_back(repository):
    with pytest.raises(sqlite3.IntegrityError):
        with repository.transaction() as connection:
            connection.execute("INSERT INTO entity (id,entity_type,label,parent_id,source_kind) VALUES ('bad','application','Bad','missing','uploaded')")
    with repository.transaction() as connection:
        connection.execute("CREATE TRIGGER fail_upload_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'blocked'); END")
    before = counts(repository)
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', entity_data(), 'a.csv', ENTITY_MAP, ACTOR)
    assert error.value.status == 503
    assert counts(repository) == before


@pytest.mark.parametrize('commit_first', [False, True])
def test_unknown_commit_branch_never_claims_rollback(repository, monkeypatch, commit_first):
    service = UploadService(repository, Settings())
    def uncertain(connection):
        if commit_first:
            connection.commit()
        raise sqlite3.OperationalError('lost confirmation')
    monkeypatch.setattr(service, '_commit', uncertain)
    result = service.accept('master', entity_data(), 'a.csv', ENTITY_MAP, ACTOR)
    assert result.data.outcome == 'unconfirmed'
    assert result.data.acceptedRows is None and result.data.reflection.views == []
    assert bool(repository.read('SELECT id FROM entity WHERE id=?', ('new-app',))) == commit_first
