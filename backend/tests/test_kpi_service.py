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
        row = db.execute('SELECT attributes_json FROM entity WHERE id=?', ('ticket-1',)).fetchone()
        attributes = json.loads(row[0])
        attributes.pop('severity' if dimension == 'incidentSeverity' else dimension)
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps(attributes), 'ticket-1'))
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
