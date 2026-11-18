"""Verify admin writes against real files, including transaction ambiguity."""
import json
import sqlite3
from datetime import datetime
import pytest
from app.domain.config_service import ConfigService
from app.domain.audit_service import AuditService
from app.domain.kpi_service import KpiService
from app.schemas.contracts import QueryContext
from app.schemas.admin import Actor, AdminFailure, AuditFilter, KpiConfig, MappingConfig, ScenarioConfig, WidgetConfig

ACTOR = Actor(personaId='administrator')


def test_widget_isolated_and_audit_timestamp_actor(repository):
    """Hide only one persona widget and verify a fresh persisted audit."""
    service = ConfigService(repository)
    result = service.save('widget', WidgetConfig(visible=False, actor=ACTOR), 'executive', 'availability')
    assert result.data.saved and result.data.effectiveStatus == 'confirmed'
    kpis = KpiService(repository)
    assert 'availability' not in [w.id for w in kpis.dashboard(QueryContext(personaId='executive')).data.widgets]
    assert 'availability' in [w.id for w in kpis.dashboard(QueryContext(personaId='operations')).data.widgets]
    event = AuditService(repository).list(AuditFilter(eventType='override', target=result.data.configId, persona='administrator')).data[0]
    assert event.actor == {'personaId': 'administrator', 'userId': 'demo-operator'}
    assert datetime.fromisoformat(event.occurredAt).tzinfo
    assert event.id == result.data.auditId
    assert event.details['config']['visible'] is False


def test_kpi_rename_preserves_value_and_scenario_available_destination(repository):
    """Reflect exact supplied values and configured scenario on fresh dashboard reads."""
    service = ConfigService(repository)
    before = repository.read("SELECT * FROM metric WHERE id='availability'")[0]
    service.save('kpi', KpiConfig(metricId='availability', label='Supplied uptime', title='Uptime overview', actor=ACTOR))
    after = repository.read("SELECT * FROM metric WHERE id='availability'")[0]
    assert {k:v for k,v in before.items() if k != 'name'} == {k:v for k,v in after.items() if k != 'name'}
    dashboard = KpiService(repository).dashboard(QueryContext(personaId='executive')).data
    assert dashboard.widgets[0].title == 'Uptime overview'
    assert dashboard.widgets[0].metric.label == 'Supplied uptime'
    service.save('scenario', ScenarioConfig(scenarioId='enrollment', label='Review supplied operations', description='Demo context', destination='/operations', actor=ACTOR))
    assert KpiService(repository).dashboard(QueryContext(personaId='executive')).data.scenarios[0].destination == '/operations'
    assert len(AuditService(repository).list(AuditFilter(eventType='edit')).data) == 2


def test_mapping_updates_only_explicit_relationship(repository):
    """Move an existing explicit journey link, leaving unrelated entities untouched."""
    service = ConfigService(repository)
    service.save('mapping', MappingConfig(relationshipId='rel-0', sourceEntityId='journey-renewal', targetEntityId='app-0002', type='impact', actor=ACTOR))
    row = repository.read("SELECT * FROM relationship WHERE id='rel-0'")[0]
    assert (row['source_entity_id'], row['target_entity_id'], row['relationship_type']) == ('journey-renewal', 'app-0002', 'impact')
    assert repository.read("SELECT parent_id FROM entity WHERE id='app-0002'")[0]['parent_id'] == 'service-enrollment'


@pytest.mark.parametrize('kind,payload,persona,widget,status', [
    ('kpi', KpiConfig(metricId='unknown', label='x', title='x', actor=ACTOR), None, None, 404),
    ('scenario', ScenarioConfig(scenarioId='unknown', label='x', description='', destination='/operations', actor=ACTOR), None, None, 404),
    ('scenario', ScenarioConfig(scenarioId='enrollment', label='x', description='', destination='https://evil.example', actor=ACTOR), None, None, 422),
    ('widget', WidgetConfig(visible=False, actor=ACTOR), 'unknown', 'availability', 404),
    ('widget', WidgetConfig(visible=False, actor=ACTOR), 'engineering', 'availability', 404),
    ('mapping', MappingConfig(relationshipId='unknown', sourceEntityId='journey-enrollment', targetEntityId='app-0001', type='impact', actor=ACTOR), None, None, 404),
    ('mapping', MappingConfig(relationshipId='rel-0', sourceEntityId='unknown', targetEntityId='app-0001', type='impact', actor=ACTOR), None, None, 404),
    ('mapping', MappingConfig(relationshipId='rel-0', sourceEntityId='journey-enrollment', targetEntityId='unknown', type='impact', actor=ACTOR), None, None, 404),
    ('mapping', MappingConfig(relationshipId='rel-0', sourceEntityId='app-0001', targetEntityId='owner-digital', type='impact', actor=ACTOR), None, None, 422),
    ('mapping', MappingConfig(relationshipId='rel-1', sourceEntityId='journey-enrollment', targetEntityId='app-0001', type='impact', actor=ACTOR), None, None, 422),
    ('kpi', KpiConfig(metricId='availability', label='x', title='x', actor=Actor(personaId='unknown')), None, None, 404),
])
def test_invalid_reference_rolls_back_everything(repository, kind, payload, persona, widget, status):
    """Reject unknown or unsupported references without config or audit changes."""
    before = repository.read('SELECT * FROM app_config')
    with pytest.raises(AdminFailure) as error:
        ConfigService(repository).save(kind, payload, persona, widget)
    assert error.value.status == status
    assert repository.read('SELECT * FROM app_config') == before
    assert repository.read('SELECT * FROM audit_event') == []


def test_audit_failure_rolls_back_metric_and_config(repository):
    """A real SQLite trigger failure cannot leave a partial config edit."""
    with repository.transaction() as db:
        db.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    with pytest.raises(AdminFailure) as error:
        ConfigService(repository).save('kpi', KpiConfig(metricId='availability', label='Must rollback', title='Must rollback', actor=ACTOR))
    assert error.value.details['commitStatus'] == 'not_committed'
    assert repository.read("SELECT name FROM metric WHERE id='availability'")[0]['name'] == 'Availability %'
    assert repository.read('SELECT * FROM audit_event') == []
    assert not repository.read("SELECT * FROM app_config WHERE id='kpi-availability'")


@pytest.mark.parametrize('actually_commit', [True, False])
def test_unknown_commit_never_retries_or_claims_rollback(repository, monkeypatch, actually_commit):
    """Simulate lost commit acknowledgement around real SQLite writes."""
    service = ConfigService(repository)
    calls = []
    def ambiguous(db):
        calls.append(True)
        if actually_commit:
            db.commit()
        raise sqlite3.OperationalError('lost acknowledgement')
    monkeypatch.setattr(service, '_commit', ambiguous)
    result = service.save('widget', WidgetConfig(visible=False, actor=ACTOR), 'executive', 'availability')
    assert result.data.outcome == 'unconfirmed' and not result.data.saved
    assert calls == [True]
    persisted = json.loads(repository.read("SELECT payload_json FROM app_config WHERE id='executive-availability'")[0]['payload_json'])
    assert persisted['visible'] is (not actually_commit)
    assert len(repository.read('SELECT * FROM audit_event')) == int(actually_commit)


def test_audit_filters_bounds_all_types_and_blocked_export(repository):
    """Support persisted event types, empty filters and unavailable artifacts."""
    with repository.transaction() as db:
        for number, kind in enumerate(['edit', 'override', 'annotation', 'uploaded_data_version']):
            db.execute('INSERT INTO audit_event (id,event_type,occurred_at,actor_context,target_type,target_id,summary) VALUES (?,?,?,?,?,?,?)', (str(number), kind, '2025-01-01T00:00:00+00:00', ACTOR.model_dump_json(), 'demo', 'target-1', kind))
    service = AuditService(repository)
    assert service.list(AuditFilter(limit=2)).total == 4
    assert len(service.list(AuditFilter(limit=2, offset=2)).data) == 2
    assert service.list(AuditFilter(target='unknown')).data == []
    for kind in ['edit', 'override', 'annotation', 'uploaded_data_version']:
        assert service.list(AuditFilter(eventType=kind, persona='administrator', target='target-1')).data[0].eventType == kind
    with pytest.raises(AdminFailure) as error:
        service.export(AuditFilter())
    assert error.value.status == 409 and error.value.code == 'DEPENDENCY_UNAVAILABLE'
    assert ConfigService(repository).catalog().widgets


def test_duplicate_metric_label_and_verification_failure(repository, monkeypatch):
    """Preserve metric identity and distinguish lost verification after real commit."""
    service = ConfigService(repository)
    with pytest.raises(AdminFailure) as error:
        service.save('kpi', KpiConfig(metricId='availability', label='SLA compliance %', title='Duplicate', actor=ACTOR))
    assert error.value.status == 422
    assert repository.read('SELECT * FROM audit_event') == []
    original_read = repository.read
    def lost_read(*args):
        raise sqlite3.OperationalError('verification unavailable')
    monkeypatch.setattr(repository, 'read', lost_read)
    result = service.save('kpi', KpiConfig(metricId='availability', label='Committed uptime', title='Committed uptime', actor=ACTOR))
    assert result.data.outcome == 'unconfirmed'
    assert original_read("SELECT name FROM metric WHERE id='availability'")[0]['name'] == 'Committed uptime'
    assert len(original_read('SELECT * FROM audit_event')) == 1
