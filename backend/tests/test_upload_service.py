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


# Parser branch table: parameter IDs name the first rejected branch; each case
# verifies the complete persisted state, not only counts or exception existence.
XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
SAFE_WORKBOOK_MESSAGE = 'XLSX must be a valid safe workbook with an internal first worksheet.'


def storage_snapshot(repository):
    """Detach every application row through fresh real database connections."""
    return {table: repository.read(f'SELECT * FROM {table} ORDER BY id') for table in
            ('entity', 'relationship', 'metric', 'dataset_version', 'audit_event', 'app_config')}


def literal_sheet():
    """Provide mapped headers and a valid row that would write if accepted."""
    return ('<row r="1"><c r="A1" t="inlineStr"><is><t>Key</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>Kind</t></is></c>'
            '<c r="C1" t="inlineStr"><is><t>Name</t></is></c></row>'
            '<row r="2"><c r="A2" t="inlineStr"><is><t>branch-entity</t></is></c>'
            '<c r="B2" t="inlineStr"><is><t>application</t></is></c>'
            '<c r="C2" t="inlineStr"><is><t>Literal</t></is></c></row>')


def raw_workbook(sheet=None, workbook=None, relationship=None, strings=None, omit=(), extras=()):
    """Build actual OOXML bytes with independently controllable parser inputs."""
    entries = {
        'xl/workbook.xml': workbook if workbook is not None else
            f'<workbook xmlns="{XML_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet r:id="first"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships>' + (relationship if relationship is not None else
            '<Relationship Id="first" Target="worksheets/sheet1.xml"/>') + '</Relationships>',
        'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{XML_NS}"><sheetData>{literal_sheet() if sheet is None else sheet}</sheetData></worksheet>',
    }
    if strings is not None:
        entries['xl/sharedStrings.xml'] = f'<sst xmlns="{XML_NS}">{strings}</sst>'
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in list(entries.items()) + list(extras):
            if name not in omit:
                archive.writestr(name, content)
    return stream.getvalue()


XLSX_REJECTION_BRANCHES = [
    pytest.param({'workbook': f'<workbook xmlns="{XML_NS}"/>'}, 'XLSX has no first worksheet.', id='missing-sheets'),
    pytest.param({'workbook': f'<workbook xmlns="{XML_NS}"><sheets/></workbook>'}, 'XLSX has no first worksheet.', id='empty-sheets'),
    pytest.param({'omit': ('xl/workbook.xml',)}, SAFE_WORKBOOK_MESSAGE, id='missing-workbook'),
    pytest.param({'omit': ('xl/_rels/workbook.xml.rels',)}, SAFE_WORKBOOK_MESSAGE, id='missing-relationships'),
    pytest.param({'omit': ('xl/worksheets/sheet1.xml',)}, SAFE_WORKBOOK_MESSAGE, id='missing-first-sheet-part'),
    pytest.param({'relationship': '<Relationship Id="other" Target="worksheets/sheet1.xml"/>'}, SAFE_WORKBOOK_MESSAGE, id='missing-first-sheet-link'),
    pytest.param({'relationship': '<Relationship Id="first" TargetMode="External" Target="https://example.invalid/sheet.xml"/>'}, 'External worksheets are not accepted.', id='external-first-sheet'),
    pytest.param({'relationship': '<Relationship Id="first" Target="../outside.xml"/>'}, 'First sheet must be an internal worksheet.', id='non-worksheet-target'),
    pytest.param({'relationship': '<Relationship Id="first"/>'}, 'First sheet must be an internal worksheet.', id='missing-target'),
    pytest.param({'sheet': literal_sheet().replace('r="2"><c', 'r="NaN"><c')}, SAFE_WORKBOOK_MESSAGE, id='nonnumeric-row'),
    *[pytest.param({'sheet': literal_sheet().replace('<row r="2">', f'<row r="{number}">')}, 'Worksheet rows must be contiguous from the header.', id=f'row-identity-{number}') for number in ('0', '-1', '1', '3')],
    pytest.param({'sheet': literal_sheet().replace('<row r="1">', '<row r="2">')}, 'Worksheet rows must be contiguous from the header.', id='sparse-header-row'),
    *[pytest.param({'sheet': literal_sheet().replace('r="A2"', f'r="{reference}"')}, 'Invalid worksheet cell reference.', id=f'cell-reference-{reference or "missing"}') for reference in ('', 'a2', '2A', 'A0', 'A1', 'A-2', '$A$2')],
    pytest.param({'sheet': literal_sheet().replace('<c r="C2"', '<c r="A2"')}, 'Duplicate worksheet cell reference.', id='duplicate-cell'),
    *[pytest.param({'sheet': literal_sheet().replace('r="C2" t="inlineStr"', f'r="C2" t="{kind}"')}, 'Use text or numeric literal cells, not boolean/error/date cells.', id=f'unsupported-cell-{kind}') for kind in ('b', 'e', 'd', 'unknown')],
    *[pytest.param({'sheet': literal_sheet().replace('<c r="C2" t="inlineStr"><is><t>Literal</t></is></c>', f'<c r="C2" t="s"><v>{index}</v></c>'), 'strings': '<si><t>Literal</t></si>'}, 'Shared string indexes must reference an existing nonnegative entry.', id=f'shared-index-{index or "empty"}') for index in ('-1', '1', 'not-an-index', '')],
    pytest.param({'sheet': literal_sheet().replace('<c r="C2" t="inlineStr"><is><t>Literal</t></is></c>', '<c r="C2" t="s"><v>0</v></c>')}, 'Shared string indexes must reference an existing nonnegative entry.', id='shared-table-missing'),
    pytest.param({'sheet': literal_sheet().replace('r="C2"', 'r="D2"')}, 'Data cells extend beyond the header.', id='data-beyond-header'),
    pytest.param({'sheet': ''}, 'Supply a header row with nonempty column names.', id='empty-sheet'),
    pytest.param({'sheet': literal_sheet().split('<row r="2">')[0]}, 'Supply at least one data row.', id='header-only'),
    pytest.param({'sheet': literal_sheet().replace('<t>Kind</t>', '<t>Key</t>')}, 'Header names must be unique.', id='duplicate-header'),
    pytest.param({'sheet': literal_sheet().replace('<t>Kind</t>', '<t/>')}, 'Supply a header row with nonempty column names.', id='blank-header'),
]


@pytest.mark.parametrize('parts,message', XLSX_REJECTION_BRANCHES)
def test_xlsx_rejection_branch_preserves_full_database(repository, parts, message):
    before = storage_snapshot(repository)
    mapping = UploadMapping(recordKind='entity', columns={'Key': 'id', 'Kind': 'type', 'Name': 'label'})
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', raw_workbook(**parts), 'branch.xlsx', mapping, ACTOR)
    assert error.value.status == 422
    assert error.value.code == 'UPLOAD_REJECTED'
    assert str(error.value) == message
    assert [(issue.code, issue.message) for issue in error.value.issues] == [('PARSE_ERROR', message)]
    assert storage_snapshot(repository) == before
    assert repository.read('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('kind,value,strings', [
    pytest.param('s', '<v>0</v>', '<si><r><t>Lit</t></r><r><t>eral</t></r></si>', id='shared-rich-text'),
    pytest.param('inlineStr', '<is><r><t>Lit</t></r><r><t>eral</t></r></is>', None, id='inline-rich-text'),
    pytest.param('str', '<v>Literal</v>', None, id='string-literal'),
    pytest.param('n', '<v>0</v>', None, id='numeric-zero'),
    pytest.param(None, '<v>12.50</v>', None, id='default-numeric'),
])
def test_xlsx_literal_cell_branches_commit_exact_source(repository, kind, value, strings):
    cell = '<c r="C2"' + (f' t="{kind}"' if kind else '') + '>' + value + '</c>'
    sheet = literal_sheet().replace('<c r="C2" t="inlineStr"><is><t>Literal</t></is></c>', cell).replace('<row r="2">', '<row>')
    mapping = UploadMapping(recordKind='entity', columns={'Key': 'id', 'Kind': 'type', 'Name': 'label'})
    before = counts(repository)
    result = UploadService(repository, Settings()).accept('master', raw_workbook(sheet=sheet, strings=strings, relationship='<Relationship Id="first" Target="/xl/worksheets/sheet1.xml"/>'), 'literal.xlsx', mapping, ACTOR)
    assert result.data.acceptedRows == 1
    row = repository.read('SELECT * FROM entity WHERE id=?', ('branch-entity',))[0]
    assert row['label'] == ('0' if kind == 'n' else '12.50' if kind is None else 'Literal')
    assert row['dataset_version_id'] == result.data.datasetVersion
    assert counts(repository) == {**before, 'entity': before['entity'] + 1, 'dataset_version': before['dataset_version'] + 1, 'audit_event': before['audit_event'] + 1}
    assert repository.read('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('settings,sheet,message', [
    pytest.param({'upload_max_rows': 1}, literal_sheet() + '<row r="3"/>', 'Worksheet row limit exceeded.', id='xlsx-row-limit'),
    pytest.param({'upload_max_columns': 2}, literal_sheet(), 'Worksheet column limit exceeded.', id='xlsx-column-limit'),
    pytest.param({'xlsx_max_expanded_bytes': 1}, literal_sheet(), 'XLSX expanded archive limit exceeded.', id='xlsx-expanded-limit'),
])
def test_xlsx_limit_branches_preserve_full_database(repository, settings, sheet, message):
    before = storage_snapshot(repository)
    with pytest.raises(UploadFailure, match=message) as error:
        UploadService(repository, Settings(**settings)).accept('master', raw_workbook(sheet=sheet), 'limit.xlsx', ENTITY_MAP, ACTOR)
    assert (error.value.status, error.value.code) == (413, 'UPLOAD_LIMIT')
    assert storage_snapshot(repository) == before


@pytest.mark.parametrize('name', ['/absolute.xml', 'folder\\evil.xml', '../evil.xml', 'xl/workbook.xml'])
def test_xlsx_unsafe_archive_branches_preserve_database(repository, name):
    before = storage_snapshot(repository)
    if name == 'xl/workbook.xml':
        with pytest.warns(UserWarning, match='Duplicate name'):
            data = raw_workbook(extras=((name, '<x/>'),))
    else:
        data = raw_workbook(extras=((name, '<x/>'),))
    with pytest.raises(UploadFailure, match='XLSX contains unsafe or duplicate archive entries.') as error:
        UploadService(repository, Settings()).accept('master', data, 'unsafe.xlsx', ENTITY_MAP, ACTOR)
    assert error.value.issues[0].code == 'PARSE_ERROR'
    assert storage_snapshot(repository) == before


@pytest.mark.parametrize('case,status,code,message', [
    pytest.param('too-many-entries', 413, 'UPLOAD_LIMIT', 'XLSX expanded archive limit exceeded.', id='archive-entry-count'),
    pytest.param('encrypted', 422, 'PARSE_ERROR', 'XLSX contains unsafe or duplicate archive entries.', id='encrypted-archive-entry'),
    pytest.param('malformed-xml', 422, 'PARSE_ERROR', SAFE_WORKBOOK_MESSAGE, id='malformed-xml'),
    pytest.param('dtd', 422, 'PARSE_ERROR', SAFE_WORKBOOK_MESSAGE, id='dtd-forbidden'),
    pytest.param('formula-other-sheet', 422, 'FORMULA_CELL', 'Formula cells are not accepted; supply literal values.', id='formula-outside-first-sheet'),
    pytest.param('broken-zip', 422, 'PARSE_ERROR', SAFE_WORKBOOK_MESSAGE, id='bad-zip'),
])
def test_xlsx_container_branches_preserve_database(repository, case, status, code, message):
    if case == 'too-many-entries':
        data = raw_workbook(extras=tuple((f'extra-{n}', '') for n in range(998)))
    elif case == 'encrypted':
        # Set the encryption bit in both real ZIP headers; no archive/DB mocks.
        data = bytearray(raw_workbook())
        local = data.index(b'PK\x03\x04')
        central = data.index(b'PK\x01\x02')
        data[local + 6] |= 1
        data[central + 8] |= 1
        data = bytes(data)
    elif case == 'malformed-xml':
        data = raw_workbook(workbook='<broken')
    elif case == 'dtd':
        data = raw_workbook(extras=(('evil.xml', '<!DOCTYPE x [<!ENTITY e "blocked">]><x>&e;</x>'),))
    elif case == 'formula-other-sheet':
        data = raw_workbook(extras=(('xl/worksheets/sheet2.xml', f'<worksheet xmlns="{XML_NS}"><c><f>1+1</f></c></worksheet>'),))
    else:
        data = b'PKnot-a-zip'
    before = storage_snapshot(repository)
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', data, 'container.xlsx', ENTITY_MAP, ACTOR)
    assert error.value.status == status
    assert str(error.value) == message
    assert error.value.code == ('UPLOAD_LIMIT' if status == 413 else 'UPLOAD_REJECTED')
    assert [(issue.code, issue.message) for issue in error.value.issues] == ([] if status == 413 else [(code, message)])
    assert storage_snapshot(repository) == before
    assert repository.read('PRAGMA foreign_key_check') == []


def test_xlsx_sparse_cells_are_blank_not_shifted(repository):
    sheet = literal_sheet().replace('<c r="B2" t="inlineStr"><is><t>application</t></is></c>', '')
    before = storage_snapshot(repository)
    mapping = UploadMapping(recordKind='entity', columns={'Key': 'id', 'Kind': 'type', 'Name': 'label'})
    with pytest.raises(UploadFailure) as error:
        UploadService(repository, Settings()).accept('master', raw_workbook(sheet=sheet), 'sparse.xlsx', mapping, ACTOR)
    assert [(issue.code, issue.row, issue.field) for issue in error.value.issues] == [
        ('REQUIRED_VALUE', 2, 'type'), ('ENTITY_TYPE', 2, 'type')]
    assert storage_snapshot(repository) == before
