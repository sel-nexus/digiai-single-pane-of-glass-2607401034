"""Exercise shipped SQLite constraints and referential actions with fresh reads."""
import sqlite3
import pytest
from app.storage.sqlite_repository import SqliteRepository


@pytest.fixture
def constraint_store(tmp_path) -> SqliteRepository:
    """Create a real migrated file and small graph with explicit provenance."""
    store = SqliteRepository(str(tmp_path / 'constraints.db'))
    store.migrate()
    with store.transaction() as db:
        db.execute("INSERT INTO dataset_version (id,dataset_class,source_kind,outcome,reflection_status) VALUES ('dataset','master','uploaded','success','confirmed')")
        db.executemany('INSERT INTO entity (id,entity_type,label,parent_id,source_kind) VALUES (?,?,?,?,?)', [
            ('parent', 'service', 'Parent', None, 'local'),
            ('child', 'application', 'Child', 'parent', 'local'),
            ('other', 'application', 'Other', None, 'local')])
        db.executemany('INSERT INTO relationship (id,source_entity_id,target_entity_id,relationship_type,dataset_version_id,source_kind) VALUES (?,?,?,?,?,?)', [
            ('outgoing', 'parent', 'other', 'depends_on', 'dataset', 'uploaded'),
            ('incoming', 'other', 'parent', 'depends_on', 'dataset', 'uploaded'),
            ('unrelated', 'child', 'other', 'depends_on', 'dataset', 'uploaded')])
        db.execute("INSERT INTO metric (id,name,family,value_number,entity_id,availability,source_kind) VALUES ('metric','Metric','qe',0,'parent','available','local')")
    return store


def constraint_snapshot(store: SqliteRepository) -> dict:
    """Read complete rows so rejected writes cannot silently modify other data."""
    return {table: store.read(f'SELECT * FROM {table} ORDER BY id') for table in
            ('entity', 'relationship', 'metric', 'dataset_version', 'app_config', 'audit_event')}


# Constraint branch table: every NOT NULL and CHECK column in the shipped schema
# is mutated independently; valid fixture values prove the positive branches.
NOT_NULL_COLUMNS = {
    'dataset_version': ('dataset_class', 'source_kind', 'outcome', 'reflection_status', 'issues_json'),
    'entity': ('entity_type', 'label', 'attributes_json', 'source_kind'),
    'relationship': ('source_entity_id', 'target_entity_id', 'relationship_type', 'source_kind'),
    'metric': ('name', 'family', 'availability', 'source_kind'),
    'app_config': ('config_kind', 'payload_json', 'updated_at'),
    'audit_event': ('event_type', 'occurred_at', 'target_type', 'summary', 'details_json'),
}
CHECK_COLUMNS = {
    'dataset_version': ('source_kind', 'outcome', 'reflection_status'),
    'entity': ('source_kind',),
    'relationship': ('source_kind',),
    'metric': ('availability', 'source_kind'),
    'audit_event': ('event_type',),
}


@pytest.mark.parametrize('table,column,value,error', [
    *[pytest.param(table, column, None, f'NOT NULL constraint failed: {table}.{column}', id=f'notnull-{table}-{column}') for table, columns in NOT_NULL_COLUMNS.items() for column in columns],
    *[pytest.param(table, column, 'unsupported', 'CHECK constraint failed', id=f'check-{table}-{column}') for table, columns in CHECK_COLUMNS.items() for column in columns],
])
def test_schema_notnull_and_check_rejections_are_atomic(constraint_store, table, column, value, error):
    with constraint_store.transaction() as db:
        db.execute("INSERT INTO app_config (id,config_kind,payload_json,updated_at) VALUES ('config','persona','{}','2026-01-01')")
        db.execute("INSERT INTO audit_event (id,event_type,occurred_at,target_type,summary) VALUES ('audit','edit','2026-01-01','entity','Source edit')")
    before = constraint_snapshot(constraint_store)
    with pytest.raises(sqlite3.IntegrityError, match=error):
        with constraint_store.transaction() as db:
            db.execute("UPDATE entity SET label='Must roll back' WHERE id='child'")
            db.execute(f'UPDATE {table} SET {column}=?', (value,))
    fresh = SqliteRepository(str(constraint_store.path))
    assert constraint_snapshot(fresh) == before
    assert fresh.read('PRAGMA foreign_key_check') == []


def test_nonnull_dataset_relationship_tuple_is_unique(constraint_store):
    before = constraint_snapshot(constraint_store)
    with pytest.raises(sqlite3.IntegrityError, match='UNIQUE constraint failed: relationship.source_entity_id, relationship.target_entity_id, relationship.relationship_type, relationship.dataset_version_id'):
        with constraint_store.transaction() as db:
            db.execute("INSERT INTO relationship (id,source_entity_id,target_entity_id,relationship_type,dataset_version_id,source_kind) VALUES ('duplicate','parent','other','depends_on','dataset','uploaded')")
    assert constraint_snapshot(constraint_store) == before
    # SQLite allows repeated tuples with NULL dataset provenance; the nonnull
    # case above is essential to actually exercise the shipped UNIQUE clause.
    with constraint_store.transaction() as db:
        db.executemany('INSERT INTO relationship (id,source_entity_id,target_entity_id,relationship_type,source_kind) VALUES (?,?,?,?,?)', [
            ('null-one', 'parent', 'other', 'depends_on', 'local'),
            ('null-two', 'parent', 'other', 'depends_on', 'local')])
    assert constraint_store.read("SELECT id,dataset_version_id FROM relationship WHERE id LIKE 'null-%' ORDER BY id") == [
        {'id': 'null-one', 'dataset_version_id': None}, {'id': 'null-two', 'dataset_version_id': None}]
    assert constraint_store.read('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('text,number', [('0', 0), ('exact literal', 12.5)])
def test_metric_dual_text_and_number_is_rejected(constraint_store, text, number):
    before = constraint_snapshot(constraint_store)
    with pytest.raises(sqlite3.IntegrityError, match='CHECK constraint failed: value_text IS NULL OR value_number IS NULL'):
        with constraint_store.transaction() as db:
            db.execute('UPDATE metric SET value_text=?,value_number=? WHERE id=?', (text, number, 'metric'))
    assert constraint_snapshot(constraint_store) == before
    assert constraint_store.read('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('text,number', [('12.5000', None), (None, 0), (None, None)])
def test_metric_single_or_missing_value_is_preserved(constraint_store, text, number):
    with constraint_store.transaction() as db:
        db.execute('UPDATE metric SET value_text=?,value_number=? WHERE id=?', (text, number, 'metric'))
    fresh = SqliteRepository(str(constraint_store.path))
    assert fresh.read('SELECT value_text,value_number FROM metric WHERE id=?', ('metric',)) == [{'value_text': text, 'value_number': number}]
    assert fresh.read('PRAGMA foreign_key_check') == []


def test_delete_cascades_both_relationship_ends_and_sets_nullable_refs(constraint_store):
    before_child = constraint_store.read("SELECT * FROM entity WHERE id='child'")[0]
    before_metric = constraint_store.read("SELECT * FROM metric WHERE id='metric'")[0]
    before_unrelated = constraint_store.read("SELECT * FROM relationship WHERE id='unrelated'")
    before_dataset = constraint_store.read('SELECT * FROM dataset_version')
    assert before_child['parent_id'] == before_metric['entity_id'] == 'parent'
    assert {row['id'] for row in constraint_store.read('SELECT id FROM relationship')} == {'outgoing', 'incoming', 'unrelated'}
    with constraint_store.transaction() as db:
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert db.execute("DELETE FROM entity WHERE id='parent'").rowcount == 1
    fresh = SqliteRepository(str(constraint_store.path))
    assert fresh.read("SELECT * FROM entity WHERE id='parent'") == []
    assert fresh.read("SELECT * FROM entity WHERE id='child'") == [{**before_child, 'parent_id': None}]
    assert fresh.read("SELECT * FROM metric WHERE id='metric'") == [{**before_metric, 'entity_id': None}]
    assert fresh.read('SELECT * FROM relationship') == before_unrelated
    assert fresh.read('SELECT * FROM dataset_version') == before_dataset
    assert fresh.read('PRAGMA foreign_key_check') == []
