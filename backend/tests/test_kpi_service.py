"""Verify supplied precision, availability and persona isolation on real storage."""
import json
import sqlite3
import pytest
from app.domain.kpi_service import KpiService
from app.schemas.contracts import QueryContext
from app.storage.seed import seed_database
from app.storage.sqlite_repository import SqliteRepository


def test_catalog_and_isolated_widgets(repository: SqliteRepository) -> None:
    """Return the approved catalog and distinct configured widget sets."""
    service = KpiService(repository)
    assert [p.label for p in service.personas()] == ['Executive', 'Operations', 'Engineering', 'Administrator']
    executive = service.dashboard(QueryContext(personaId='executive')).data
    engineering = service.dashboard(QueryContext(personaId='engineering')).data
    assert {w.id for w in executive.widgets} == {'availability', 'sla', 'adoption'}
    assert {w.id for w in engineering.widgets} == {'pipeline', 'test', 'critical'}
    assert executive.widgets[0].metric.value == 99.23456
    assert executive.scenarios[0].destination == '/journeys/journey-enrollment'


@pytest.mark.parametrize('period', ['day', 'week', 'quarter'])
def test_absent_period_never_falls_back(repository: SqliteRepository, period: str) -> None:
    """Mark all unavailable periods null without substituting monthly evidence."""
    metrics = KpiService(repository).summary(QueryContext(), period).data
    assert metrics
    assert all(m.value is None and m.period == period and m.availability == 'unavailable' for m in metrics)


def test_missing_value_remains_unavailable_and_zero_is_retained(repository: SqliteRepository) -> None:
    """Keep missing MTTR distinct from an explicitly supplied zero."""
    service = KpiService(repository)
    metrics = {m.id: m for m in service.summary(QueryContext()).data}
    assert metrics['mttr'].value is None
    assert metrics['mttr'].availability == 'unavailable'
    with repository.transaction() as db:
        db.execute('UPDATE metric SET value_number=? WHERE id=?', (0, 'availability'))
    assert service.dashboard(QueryContext(personaId='executive')).data.widgets[0].metric.value == 0


def test_unknown_persona_and_invalid_family_are_rejected(repository: SqliteRepository) -> None:
    """Reject invented display contexts and unsupported families."""
    service = KpiService(repository)
    with pytest.raises(LookupError):
        service.dashboard(QueryContext(personaId='unknown'))
    with pytest.raises(LookupError):
        service.summary(QueryContext(personaId='unknown'))
    with pytest.raises(ValueError):
        service.summary(QueryContext(), family='invented')


@pytest.mark.parametrize('filters', [
    {'domain': ['domain-member']},
    {'portfolio': ['portfolio-digital']},
    {'application': ['app-0001']},
    {'environment': ['prod']},
    {'criticality': ['high']},
    {'dateRange': ['2025-01/2025-02']},
    {'toolSource': ['sample-monitor']},
    {'incidentSeverity': ['Sev1']},
    {'domain': ['absent', 'domain-member'], 'portfolio': ['portfolio-digital'],
     'application': ['app-0001'], 'environment': ['prod'], 'criticality': ['high'],
     'dateRange': ['2025-01/2025-02'], 'toolSource': ['sample-monitor'], 'incidentSeverity': ['Sev1']},
])
def test_supported_scope_preserves_source_associated_metrics(repository: SqliteRepository, filters: dict[str, list[str]]) -> None:
    """Use represented ancestry and direct evidence with OR within and AND across facets."""
    result = KpiService(repository).summary(QueryContext(filters=filters, hierarchyNodeId='app-0001'))
    assert result.unavailableDimensions == []
    assert result.availability == 'available'
    metrics = {m.id: m for m in result.data}
    assert {key: m.value for key, m in metrics.items()} == {
        'availability': 99.23456, 'sla': 98.76543, 'sev-count': 7,
        'mttd': 4.5, 'mttr': None, 'repeat': 3.12, 'noise': 18.5,
    }
    assert metrics['mttr'].availability == 'unavailable'
    assert all(m.availability == 'available' for key, m in metrics.items() if key != 'mttr')
    assert metrics['availability'].unit == '%'
    assert all(m.period == 'month' and m.source == 'sample' and m.sourceRef == f'sample-kpi-{m.id}' for m in result.data)


@pytest.mark.parametrize('context', [
    QueryContext(filters={'domain': ['domain-member'], 'application': ['app-0002']}),
    QueryContext(filters={'environment': ['absent']}),
    QueryContext(hierarchyNodeId='app-0002'),
])
def test_supported_scope_without_associated_metrics_is_null(repository: SqliteRepository, context: QueryContext) -> None:
    """Do not ignore mismatches or transfer evidence along application dependencies."""
    result = KpiService(repository).summary(context)
    assert result.unavailableDimensions == []
    assert result.availability == 'available'
    assert len(result.data) == 7
    assert all(m.value is None and m.availability == 'unavailable' for m in result.data)


@pytest.mark.parametrize('dimension', ['dateRange', 'toolSource', 'incidentSeverity'])
def test_scope_without_source_dimension_is_explicitly_unavailable(repository: SqliteRepository, dimension: str) -> None:
    """Report absent source facets instead of returning unfiltered KPI values."""
    with repository.transaction() as db:
        # Other directly associated records also supply these facets.
        keys = ('incidentSeverity', 'severity') if dimension == 'incidentSeverity' else (dimension,)
        rows = db.execute('SELECT id,attributes_json FROM entity').fetchall()
        for row in rows:
            attributes = json.loads(row['attributes_json'])
            for key in keys:
                attributes.pop(key, None)
            db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps(attributes), row['id']))
    assert all(not set(keys).intersection(json.loads(row['attributes_json']))
               for row in repository.read('SELECT attributes_json FROM entity'))
    result = KpiService(repository).summary(QueryContext(filters={dimension: ['opaque']}, hierarchyNodeId='app-0001'))
    assert result.unavailableDimensions == [dimension]
    assert result.availability == 'unavailable'
    assert len(result.data) == 7
    assert all(m.value is None and m.availability == 'unavailable' for m in result.data)


def test_unknown_hierarchy_scope_is_explicitly_unavailable(repository: SqliteRepository) -> None:
    """Keep an unknown hierarchy selection distinct from a represented no-match."""
    result = KpiService(repository).summary(QueryContext(filters={'domain': ['domain-member']}, hierarchyNodeId='absent'))
    assert result.unavailableDimensions == ['hierarchyNodeId']
    assert result.availability == 'unavailable'
    assert len(result.data) == 7
    assert all(m.value is None and m.availability == 'unavailable' for m in result.data)


def test_hidden_widget_and_seed_restart_preserve_configuration(repository: SqliteRepository) -> None:
    """Preserve persona-scoped edits through fresh connections and repeated seed."""
    with repository.transaction() as db:
        row = db.execute('SELECT payload_json FROM app_config WHERE id=?', ('executive-availability',)).fetchone()
        payload = json.loads(row[0])
        payload['visible'] = False
        db.execute('UPDATE app_config SET payload_json=? WHERE id=?', (json.dumps(payload), 'executive-availability'))
    seed_database(repository)
    fresh = SqliteRepository(str(repository.path))
    assert {w.id for w in KpiService(fresh).dashboard(QueryContext(personaId='executive')).data.widgets} == {'sla', 'adoption'}
    assert 'availability' in {w.id for w in KpiService(fresh).dashboard(QueryContext(personaId='operations')).data.widgets}
    assert fresh.read('SELECT COUNT(*) AS n FROM entity WHERE entity_type=?', ('application',))[0]['n'] == 1000
    assert fresh.read('PRAGMA foreign_key_check') == []


def test_empty_catalog_and_missing_metric_are_explicit(repository: SqliteRepository) -> None:
    """Keep absent configuration empty and absent widget evidence unavailable."""
    service = KpiService(repository)
    with repository.transaction() as db:
        db.execute('DELETE FROM metric WHERE id=?', ('availability',))
    assert service.dashboard(QueryContext(personaId='executive')).data.widgets[0].metric.value is None
    with repository.transaction() as db:
        db.execute('DELETE FROM app_config WHERE config_kind=?', ('persona',))
    assert service.personas() == []


def test_transaction_constraints_and_rollback(repository: SqliteRepository) -> None:
    """Enforce real foreign keys and rollback the entire unit of work."""
    with pytest.raises(sqlite3.IntegrityError):
        with repository.transaction() as db:
            db.execute('UPDATE entity SET label=? WHERE id=?', ('Should rollback', 'app-0001'))
            db.execute('UPDATE entity SET parent_id=? WHERE id=?', ('absent', 'app-0001'))
    assert repository.read('SELECT label FROM entity WHERE id=?', ('app-0001',))[0]['label'] == 'Member Portal'


def test_migrations_are_repeatable_and_reject_unknown_history(repository: SqliteRepository) -> None:
    """Accept unchanged migrations but reject history from a future schema."""
    repository.migrate()
    assert repository.read('SELECT version FROM schema_migration') == [{'version': 1}]
    with repository.transaction() as db:
        db.execute('INSERT INTO schema_migration VALUES (?,?,?)', (2, '002_unknown.sql', 'unknown'))
    with pytest.raises(RuntimeError, match='Unsupported schema version'):
        repository.migrate()



def migration_snapshot(repository: SqliteRepository) -> dict:
    """Read schema and all persisted rows without sharing a connection."""
    schema = repository.read("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name")
    tables = [row['name'] for row in schema if row['type'] == 'table']
    return {'schema': schema, 'rows': {name: repository.read(f'SELECT * FROM "{name}" ORDER BY rowid') for name in tables}}


# Migration branch table: known history -> skip; absent history -> apply;
# changed version/name/checksum -> reject; excess history -> reject future schema.
@pytest.mark.parametrize('column,value,message', [
    pytest.param('name', '001_renamed.sql', 'Unsupported or modified schema migration', id='changed-name'),
    pytest.param('checksum', 'corrupted', 'Unsupported or modified schema migration', id='changed-checksum'),
    pytest.param('version', 0, 'Unsupported or modified schema migration', id='zero-version'),
    pytest.param('version', 2, 'Unsupported or modified schema migration', id='noncontiguous-version'),
])
def test_corrupted_migration_history_rejected_without_drops(repository: SqliteRepository, column: str, value: object, message: str) -> None:
    """Keep real user data and corrupt history intact when startup refuses it."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET label=? WHERE id=?', ('User-maintained label', 'app-0001'))
        db.execute(f'UPDATE schema_migration SET {column}=?', (value,))
    before = migration_snapshot(repository)
    fresh = SqliteRepository(str(repository.path))
    with pytest.raises(RuntimeError, match=message):
        fresh.migrate()
    assert migration_snapshot(fresh) == before
    assert fresh.read('PRAGMA foreign_key_check') == []


def test_supported_migration_application_preserves_preexisting_data(tmp_path) -> None:
    """Apply the supported initial migration without dropping unrelated user data."""
    import hashlib
    from pathlib import Path
    import app.storage.sqlite_repository as storage_module

    store = SqliteRepository(str(tmp_path / 'migration.db'))
    with store.transaction() as db:
        db.execute('CREATE TABLE user_notes (id TEXT PRIMARY KEY, note TEXT NOT NULL)')
        db.execute('INSERT INTO user_notes VALUES (?,?)', ('note-1', 'Keep my source data'))
    store.migrate()
    sql_file = Path(storage_module.__file__).parent / 'migrations' / '001_initial.sql'
    expected = [{'version': 1, 'name': sql_file.name, 'checksum': hashlib.sha256(sql_file.read_text(encoding='utf-8').encode('utf-8')).hexdigest()}]
    assert store.read('SELECT * FROM schema_migration') == expected
    assert store.read('SELECT * FROM user_notes') == [{'id': 'note-1', 'note': 'Keep my source data'}]
    assert {row['name'] for row in store.read("SELECT name FROM sqlite_master WHERE type='table'")} == {
        'user_notes', 'schema_migration', 'dataset_version', 'entity', 'relationship', 'metric', 'app_config', 'audit_event'}
    with store.transaction() as db:
        db.execute("INSERT INTO entity (id,entity_type,label,source_kind) VALUES ('user-entity','application','Edited source','local')")
    before = migration_snapshot(store)
    fresh = SqliteRepository(str(store.path))
    fresh.migrate()
    assert migration_snapshot(fresh) == before
    assert fresh.read('PRAGMA foreign_key_check') == []


def test_future_migration_history_rejection_preserves_all_data(repository: SqliteRepository) -> None:
    """Never repair a future schema by silently dropping history or user records."""
    with repository.transaction() as db:
        db.execute('INSERT INTO schema_migration VALUES (?,?,?)', (2, '002_future.sql', 'future'))
    before = migration_snapshot(repository)
    with pytest.raises(RuntimeError, match='Unsupported schema version'):
        SqliteRepository(str(repository.path)).migrate()
    assert migration_snapshot(repository) == before
    assert repository.read('PRAGMA foreign_key_check') == []



def test_noncontiguous_migration_files_reject_without_changes(repository: SqliteRepository, tmp_path, monkeypatch) -> None:
    """Read real migration files from a test-only location, never mock storage."""
    from pathlib import Path
    import app.storage.sqlite_repository as storage_module

    migration_dir = tmp_path / 'migration-code' / 'migrations'
    migration_dir.mkdir(parents=True)
    source = Path(storage_module.__file__).parent / 'migrations' / '001_initial.sql'
    (migration_dir / '002_initial.sql').write_text(source.read_text(encoding='utf-8'), encoding='utf-8')
    monkeypatch.setattr(storage_module, '__file__', str(migration_dir.parent / 'sqlite_repository.py'))
    before = migration_snapshot(repository)
    with pytest.raises(RuntimeError, match='Migration numbering must be contiguous'):
        repository.migrate()
    assert migration_snapshot(repository) == before
    assert repository.read('PRAGMA foreign_key_check') == []
